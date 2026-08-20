const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Database = require('../src/database');

const tempDbPath = path.join(__dirname, '.kitchen-workflow.db');

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
    const today = database.getDateString();
    const todayRow = await get(database.db, 'SELECT id FROM days WHERE date = ?', [today]);
    const first = await run(
      database.db,
      `INSERT INTO orders (day_id, name, quantity, description) VALUES (?, 'Khách sửa', 2, 'Không hành')`,
      [todayRow.id]
    );
    const second = await run(
      database.db,
      `INSERT INTO orders (day_id, name, quantity) VALUES (?, 'Khách hủy', 1)`,
      [todayRow.id]
    );

    await dbCall(database, 'updateOrderKitchenStatus', first.id, 'done');
    let firstRow = await get(database.db, 'SELECT kitchen_status, kitchen_completed_at FROM orders WHERE id = ?', [first.id]);
    assert.strictEqual(firstRow.kitchen_status, 'done');
    assert.ok(firstRow.kitchen_completed_at);

    await dbCall(database, 'updateOrder', first.id, { name: 'Khách sửa', quantity: 3, description: 'Thêm một suất' });
    firstRow = await get(database.db, 'SELECT kitchen_status, kitchen_completed_at, last_action FROM orders WHERE id = ?', [first.id]);
    assert.deepStrictEqual(firstRow, { kitchen_status: 'pending', kitchen_completed_at: null, last_action: 'edited' });

    await dbCall(database, 'deleteOrder', second.id, 'user');
    let details = await dbCall(database, 'getDayDetails', today);
    assert.strictEqual(details.orders[0].change_action, 'deleted');
    assert.strictEqual(details.orders[0].kitchen_status, 'cancel_pending');
    assert.strictEqual(details.orders[1].id, first.id);

    const deletedLogId = details.orders[0].change_log_id;
    await dbCall(database, 'acknowledgeDeletedOrder', deletedLogId);
    details = await dbCall(database, 'getDayDetails', today);
    const deletedRow = details.orders.find((order) => order.change_log_id === deletedLogId);
    assert.strictEqual(deletedRow.kitchen_status, 'cancel_done');
    assert.ok(deletedRow.kitchen_acknowledged_at);

    const historicalDay = await run(
      database.db,
      `INSERT INTO days (date, menu, quantity, price) VALUES ('2026-01-02', 'Test', 10, 40000)`
    );
    await run(database.db, `INSERT INTO orders (day_id, name, quantity) VALUES (?, 'Đơn cũ', 1)`, [historicalDay.id]);
    await run(
      database.db,
      `INSERT INTO order_change_log (order_id, day_id, name, quantity, action) VALUES (999, ?, 'Đơn hủy cũ', 1, 'deleted')`,
      [historicalDay.id]
    );
    await run(database.db, `DELETE FROM app_settings WHERE key = 'kitchen_workflow_migration_v1'`);
    database.migrateKitchenWorkflowData();
    await new Promise((resolve) => setTimeout(resolve, 150));
    const migratedOrder = await get(database.db, `SELECT kitchen_status FROM orders WHERE day_id = ?`, [historicalDay.id]);
    const migratedDelete = await get(database.db, `SELECT kitchen_acknowledged_at FROM order_change_log WHERE day_id = ?`, [historicalDay.id]);
    assert.strictEqual(migratedOrder.kitchen_status, 'done');
    assert.ok(migratedDelete.kitchen_acknowledged_at);

    console.log('kitchen workflow tests: OK');
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  } finally {
    await new Promise((resolve) => database.db.close(() => resolve()));
    fs.rmSync(tempDbPath, { force: true });
  }
})();
