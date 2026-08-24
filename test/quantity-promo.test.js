const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Database = require('../src/database');

const tempDbPath = path.join(__dirname, '.quantity-promo.db');

function dbCall(database, method, ...args) {
  return new Promise((resolve, reject) => {
    database[method](...args, (err, result) => (err ? reject(err) : resolve(result)));
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

(async () => {
  fs.rmSync(tempDbPath, { force: true });
  const database = new Database(tempDbPath, { seedAdmin: false });
  try {
    await new Promise((resolve) => setTimeout(resolve, 300));
    const user = await dbCall(database, 'createUser', '0909000001', 'Khách tích suất', 'hash', 'salt', 'user');
    const oldDay = await run(database.db, `INSERT INTO days (date, menu, quantity, price) VALUES ('2026-08-01', 'Test', 20, 40000)`);
    const startDay = await run(database.db, `INSERT INTO days (date, menu, quantity, price) VALUES ('2026-08-10', 'Test', 20, 40000)`);
    const nextDay = await run(database.db, `INSERT INTO days (date, menu, quantity, price) VALUES ('2026-08-11', 'Test', 20, 40000)`);
    await run(database.db, `INSERT INTO orders (day_id, name, quantity, user_id) VALUES (?, ?, 5, ?)`, [oldDay.id, user.name, user.id]);
    await run(database.db, `INSERT INTO orders (day_id, name, quantity, user_id) VALUES (?, ?, 6, ?)`, [startDay.id, user.name, user.id]);
    await run(database.db, `INSERT INTO orders (day_id, name, quantity, user_id) VALUES (?, ?, 5, ?)`, [nextDay.id, user.name, user.id]);

    const totalServings = await dbCall(database, 'getUserTotalOrderedServings', user.id, '2026-08-10');
    assert.strictEqual(totalServings, 11);

    const firstPromo = await dbCall(database, 'createQuantityPromoCode', user.name, 50, user.id, 10, '2026-08-10');
    const duplicatePromo = await dbCall(database, 'createQuantityPromoCode', user.name, 50, user.id, 10, '2026-08-10');
    assert.strictEqual(duplicatePromo.id, firstPromo.id);
    assert.strictEqual(duplicatePromo.existing, true);
    await dbCall(database, 'createQuantityPromoCode', user.name, 50, user.id, 20, '2026-08-10');

    const promoCount = await get(database.db, `SELECT COUNT(*) count FROM promo_codes WHERE source = 'auto_quantity'`);
    assert.strictEqual(promoCount.count, 2);
    const wallet = await dbCall(database, 'getPromoWalletForUser', user.id);
    assert.strictEqual(wallet[0].source, 'auto_quantity');
    assert.strictEqual(Number(wallet[0].earned_quantity_servings), 20);
    assert.strictEqual(wallet[0].earned_quantity_start_date, '2026-08-10');

    const settings = await dbCall(database, 'getSettings', [
      'quantity_promo_enabled',
      'quantity_promo_servings',
      'quantity_promo_discount'
    ]);
    assert.deepStrictEqual(settings, {
      quantity_promo_enabled: '0',
      quantity_promo_servings: '10',
      quantity_promo_discount: '50'
    });

    console.log('quantity promo tests: OK');
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  } finally {
    await new Promise((resolve) => database.db.close(() => resolve()));
    fs.rmSync(tempDbPath, { force: true });
  }
})();
