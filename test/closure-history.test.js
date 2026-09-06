const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Database = require('../src/database');

const tempDbPath = path.join(__dirname, '.closure-history.db');

function dbCall(database, method, ...args) {
  return new Promise((resolve, reject) => {
    database[method](...args, (err, result) => (err ? reject(err) : resolve(result)));
  });
}

(async () => {
  fs.rmSync(tempDbPath, { force: true });
  const database = new Database(tempDbPath, { seedAdmin: false });
  try {
    await new Promise((resolve) => setTimeout(resolve, 300));
    const inserted = await dbCall(database, 'upsertShopClosureRange', '2026-01-05', '2026-01-07', 'Lý do ban đầu');
    assert.strictEqual(inserted.count, 3);
    let closure = await dbCall(database, 'getShopClosureByDate', '2026-01-06');
    assert.strictEqual(closure.reason, 'Lý do ban đầu');

    await dbCall(database, 'upsertShopClosureRange', '2026-01-06', '2026-01-06', 'Lý do cập nhật');
    closure = await dbCall(database, 'getShopClosureByDate', '2026-01-06');
    assert.strictEqual(closure.reason, 'Lý do cập nhật');

    const history = await dbCall(database, 'getShopClosureDates', 1, 8);
    assert.strictEqual(history.total, 3);
    assert.strictEqual(history.rows[0].closure_date, '2026-01-07');

    await dbCall(database, 'deleteShopClosureDate', '2026-01-06');
    assert.strictEqual(await dbCall(database, 'getShopClosureByDate', '2026-01-06'), undefined);
    console.log('closure history tests: OK');
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  } finally {
    await new Promise((resolve) => database.db.close(() => resolve()));
    fs.rmSync(tempDbPath, { force: true });
  }
})();
