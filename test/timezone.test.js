const assert = require('assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

if (!process.argv.includes('--worker')) {
  for (const TZ of ['UTC', 'America/New_York', 'Asia/Tokyo', 'Asia/Ho_Chi_Minh']) {
    const result = spawnSync(process.execPath, [__filename, '--worker'], { env: { ...process.env, TZ }, encoding: 'utf8' });
    assert.equal(result.status, 0, `${TZ}: ${result.stderr || result.stdout}`);
  }
  console.log('timezone tests: OK (Vietnam cutoff, midnight and UTC timestamps across 4 host timezones)');
  const { consensus } = require('../scripts/sync-system-clock.cjs');
  assert.throws(() => consensus([{ source: 'one', time: 10000, receivedAt: 0 }], 0), /two independent/);
  assert.throws(() => consensus([{ source: 'one', time: 10000, receivedAt: 0 }, { source: 'two', time: 20000, receivedAt: 0 }], 0), /two independent/);
  assert.equal(consensus([{ source: 'one', time: 10000, receivedAt: 0 }, { source: 'two', time: 11000, receivedAt: 0 }, { source: 'three', time: 40000, receivedAt: 0 }], 1000).time, 11500);
} else {
  const { vietnamDate, getOrderCutoffInfo } = require('../src/time');
  const Database = require('../src/database');
  const beforeMidnight = new Date('2026-10-27T16:59:59Z');
  const afterMidnight = new Date('2026-10-27T17:00:00Z');
  assert.equal(vietnamDate(beforeMidnight), '2026-10-27');
  assert.equal(vietnamDate(afterMidnight), '2026-10-28');
  assert.equal(Database.prototype.getDateString(afterMidnight), '2026-10-28');
  const before = getOrderCutoffInfo('10:45', new Date('2026-10-28T03:44:59Z'));
  assert.deepEqual(before, { cutoffTime: '10:45', cutoffAt: '2026-10-28T03:45:00.000Z', isOrderClosed: false, remainingSeconds: 1 });
  assert.equal(getOrderCutoffInfo('10:45', new Date('2026-10-28T03:45:00Z')).isOrderClosed, true);
  assert.equal(getOrderCutoffInfo('bad', afterMidnight).cutoffTime, '10:45');
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/assets/js/common.js'), 'utf8'), { window, Intl, Date });
  assert.equal(window.AppUtils.getVietnamDate(afterMidnight), '2026-10-28');
  const plainUtc = window.AppUtils.formatDateTime('2026-10-28 01:15:00');
  assert(plainUtc.includes('08:15:00'), plainUtc);
  assert.equal(plainUtc, window.AppUtils.formatDateTime('2026-10-28T08:15:00+07:00'));
}
