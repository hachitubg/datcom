const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('../src/database');
const file = path.join(__dirname, '.monthly-leaderboard.db');
const call = (db, method, ...args) => new Promise((resolve, reject) => db[method](...args, (error, data) => error ? reject(error) : resolve(data)));
const sql = (db, query, params = []) => new Promise((resolve, reject) => db.run(query, params, (error) => error ? reject(error) : resolve()));
(async () => {
  fs.rmSync(file, { force: true });
  const db = new Database(file, { seedAdmin: false });
  try {
    await new Promise((resolve) => setTimeout(resolve, 250));
    await sql(db.db, `INSERT INTO days (date) VALUES ('2026-09-01'), ('2026-09-02')`);
    await sql(db.db, `INSERT INTO orders (day_id, name, quantity)
      SELECT id, 'Trung Đường', 3 FROM days WHERE date IN ('2026-09-01', '2026-09-02')`);
    await sql(db.db, `INSERT INTO orders (day_id, name, quantity)
      SELECT id, 'Khách B', 5 FROM days WHERE date = '2026-09-01'`);
    const september = await call(db, 'getMonthlyLeaderboard', '2026-09');
    assert.equal(september.leaders.length, 2);
    assert.deepEqual(september.leaders[0], { rank: 1, name: 'Trung Đường', days: 2, percentage: 100 });
    assert.equal(september.leaders[1].days, 1);
    const empty = await call(db, 'getMonthlyLeaderboard', '2026-10');
    assert.deepEqual(empty.leaders, []);
    assert.deepEqual(empty.availableMonths, ['2026-09']);
    console.log('monthly leaderboard tests: OK (distinct days and available months)');
  } finally {
    await new Promise((resolve) => db.db.close(resolve));
    fs.rmSync(file, { force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
