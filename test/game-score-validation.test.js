const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const net = require('net');
const { fork } = require('child_process');
const Database = require('../src/database');
const dbPath = path.join(__dirname, '.game-score-validation.db');

if (process.argv.includes('--server')) {
  class TestDatabase extends Database {
    constructor() { super(dbPath, { seedAdmin: false }); }
  }
  require.cache[require.resolve('../src/database')].exports = TestDatabase;
  require('../src/server');
} else {
  (async () => {
    let child;
    const cases = [];
    fs.rmSync(dbPath, { force: true });
    try {
      const port = await new Promise((resolve, reject) => {
        const server = net.createServer();
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
          const value = server.address().port;
          server.close(() => resolve(value));
        });
      });
      child = fork(__filename, ['--server'], {
        env: { ...process.env, PORT: String(port), NODE_ENV: 'test',
          SESSION_SECRET: 'game-score-test-session-secret', COOKIE_SECURE: '0',
          PAYOS_CLIENT_ID: '', PAYOS_API_KEY: '', PAYOS_CHECKSUM_KEY: '' },
        stdio: ['ignore', 'ignore', 'inherit', 'ipc']
      });
      const base = `http://127.0.0.1:${port}`;
      let ready = false;
      for (let i = 0; i < 100; i++) {
        try { ready = (await fetch(`${base}/api/game/leaderboard`)).ok; } catch {}
        if (ready) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert(ready, 'Isolated server failed to start');
      const post = (body, cookie = '') => fetch(`${base}/api/game/score`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body)
      });
      const anonymous = await post({ score: 100, level: 1, caught: 1 });
      cases.push({ id: 'anonymous', expected: 401, actual: anonymous.status });
      const signup = await fetch(`${base}/api/auth/register`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: 'ABH-game-fixture', name: 'ABH game fixture', password: 'fixture-password-only' })
      });
      assert.equal(signup.status, 200);
      const cookie = signup.headers.get('set-cookie').split(';')[0];
      const valid = { score: 100, level: 2, caught: 3 };
      for (const body of [{ score: 0, level: 1, caught: 0 }, valid, { score: 50, level: 10, caught: 1 }]) {
        const response = await post(body, cookie);
        cases.push({ id: `valid-${body.score}-${body.level}`, expected: 200, actual: response.status });
      }
      const before = await (await fetch(`${base}/api/game/leaderboard`)).json();
      const invalid = [
        ['missing', {}], ['null', { score: null }], ['text', { score: '9999junk' }],
        ['numeric-string', { score: '9999' }], ['fractional-score', { score: 9999.5 }],
        ['negative-score', { score: -1 }], ['unsafe-score', { score: Number.MAX_SAFE_INTEGER + 1 }],
        ['boolean', { caught: true }], ['array', { caught: [9] }], ['object', { caught: {} }],
        ['fractional-caught', { caught: 1.5 }], ['negative-caught', { caught: -1 }],
        ['zero-level', { level: 0 }], ['fractional-level', { level: 2.5 }],
        ['text-level', { level: '2bad' }], ['high-level', { level: 11 }]
      ];
      for (const [id, patch] of invalid) {
        const body = id === 'missing' ? {} : { ...valid, ...patch };
        const response = await post(body, cookie);
        cases.push({ id, expected: 400, actual: response.status });
      }
      const after = await (await fetch(`${base}/api/game/leaderboard`)).json();
      cases.push({ id: 'invalid-input-does-not-mutate-leaderboard', expected: true,
        actual: JSON.stringify(before) === JSON.stringify(after) });
      const failed = cases.filter((item) => item.actual !== item.expected);
      const report = { source_sha: process.env.SOURCE_SHA || null, engine: 'real-http-and-sqlite',
        checked_at: new Date().toISOString(), cases, passed: cases.length - failed.length,
        failed: failed.length, outcome: failed.length ? 'FAIL' : 'PASS' };
      if (process.env.REPORT_PATH) fs.writeFileSync(process.env.REPORT_PATH, JSON.stringify(report, null, 2));
      console.log(JSON.stringify(report, null, 2));
      assert.equal(failed.length, 0, `Failed: ${failed.map((item) => item.id).join(', ')}`);
    } finally {
      if (child && child.exitCode === null) {
        const stopped = new Promise((resolve) => child.once('exit', resolve));
        child.kill();
        await stopped;
      }
      fs.rmSync(dbPath, { force: true });
    }
  })().catch((error) => { console.error(error); process.exitCode = 1; });
}
