const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const net = require('net');
const { fork } = require('child_process');
const Database = require('../src/database');
const sqlite3 = require('sqlite3');
const dbPath = path.join(__dirname, '.order-entry.db');
const call = (db, method, ...args) => new Promise((resolve, reject) => db[method](...args, (e, v) => e ? reject(e) : resolve(v)));
const sql = (db, query, params = []) => new Promise((resolve, reject) => db.all(query, params, (e, v) => e ? reject(e) : resolve(v)));
const close = (db) => new Promise((resolve, reject) => db.close((e) => e ? reject(e) : resolve()));

if (process.argv.includes('--server')) {
  class TestDatabase extends Database {
    constructor() { super(dbPath); }
  }
  require.cache[require.resolve('../src/database')].exports = TestDatabase;
  require('../src/server');
} else {
  (async () => {
    fs.rmSync(dbPath, { force: true });
    let database;
    let child;
    try {
      database = new Database(dbPath, { seedAdmin: false });
      await new Promise((resolve) => setTimeout(resolve, 300));
      const today = database.getDateString();
      const owner = await call(database, 'createUser', '0900999001', 'Trung Đường', 'hash', 'salt', 'user');
      const other = await call(database, 'createUser', '0900999002', 'Người khác', 'hash', 'salt', 'user');
      await sql(database.db, 'UPDATE days SET quantity = 1 WHERE date = ?', [today]);
      await assert.rejects(call(database, 'addOrder', owner.name, 2, '', null, owner.id), /Khong du/);
      const order = await call(database, 'addAdminOrder', 'trung duong', 3, 'Không lấy lạc');
      const [stored] = await sql(database.db, 'SELECT * FROM orders WHERE id = ?', [order.id]);
      assert.equal(stored.user_id, owner.id);
      assert.equal(stored.name, owner.name);
      assert.equal(stored.kitchen_status, 'pending');
      assert.equal((await sql(database.db, 'SELECT quantity FROM days WHERE date = ?', [today]))[0].quantity, 3);
      await assert.rejects(call(database, 'addAdminOrder', owner.name, 1.5, ''), /khong hop le/);
      assert.equal((await sql(database.db, 'SELECT quantity FROM days WHERE date = ?', [today]))[0].quantity, 3);
      const debt = await call(database, 'getCustomerRemainingDebt', owner.name);
      assert.equal(debt.remainingAmount, 120000);
      await sql(database.db, `INSERT INTO promo_codes (code, discount_percent, issued_to_user_id, source) VALUES ('OWN', 50, ?, 'admin_gift'), ('OTHER', 50, ?, 'admin_gift'), ('USED', 50, ?, 'admin_gift')`, [owner.id, other.id, owner.id]);
      await sql(database.db, `UPDATE promo_codes SET used_by = ? WHERE code = 'USED'`, [owner.name]);
      const available = await call(database, 'getAvailablePromoCodesForUser', owner.id);
      assert.deepEqual(available.map((row) => row.code), ['OWN']);
      await sql(database.db, 'UPDATE days SET quantity = 20 WHERE date = ?', [today]);
      await assert.rejects(call(database, 'addOrder', other.name, 1, '', 'OWN', other.id), /tai khoan duoc tang/);
      const discounted = await call(database, 'addOrder', owner.name, 3, '', 'OWN', owner.id);
      assert.equal(discounted.discount_percent, 50);
      assert.equal((await call(database, 'getCustomerRemainingDebt', owner.name)).remainingAmount, 220000);
      assert.deepEqual(await call(database, 'getAvailablePromoCodesForUser', owner.id), []);
      await close(database.db);
      database = null;

      const port = await new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => { const value = server.address().port; server.close(() => resolve(value)); });
      });
      child = fork(__filename, ['--server'], { silent: true, env: { ...process.env, PORT: String(port), NODE_ENV: 'test', PAYOS_CLIENT_ID: '', PAYOS_API_KEY: '', PAYOS_CHECKSUM_KEY: '', ADMIN_INITIAL_PASSWORD: 'test-order-entry-password', SESSION_SECRET: 'order-entry-test-session-secret-12345', COOKIE_SECURE: '0' } });
      const base = `http://127.0.0.1:${port}`;
      let ready = false;
      for (let attempt = 0; attempt < 70; attempt++) {
        try { ready = (await fetch(`${base}/api/today`)).ok; } catch {}
        if (ready) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert(ready, 'Test server did not start');
      const post = (endpoint, body, cookie = '') => fetch(`${base}${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body) });
      assert.equal((await post('/api/admin/orders', { name: 'Khách', quantity: 1 })).status, 401);
      assert.equal((await fetch(`${base}/api/promo-wallet/available`)).status, 401);
      const login = await post('/api/admin/login', { password: 'test-order-entry-password' });
      assert.equal(login.status, 200);
      const cookie = login.headers.get('set-cookie').split(';')[0];
      const settings = await fetch(`${base}/api/admin/settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ order_cutoff_time: '00:00', shop_closed_enabled: '1', shop_closed_reason: 'Test đóng cửa' }) });
      assert.equal(settings.status, 200);
      assert.equal((await post('/api/orders', { name: 'Khách ngoài giờ', quantity: 1 })).status, 400);
      const adminOrder = await post('/api/admin/orders', { name: 'Khách ngoài giờ', quantity: 30, description: 'Admin thêm' }, cookie);
      assert.equal(adminOrder.status, 201);
      assert.equal((await adminOrder.json()).quantity, 30);
      assert.equal((await post('/api/admin/orders', { name: 'Lỗi', quantity: 0.5 }, cookie)).status, 400);
      const readOnly = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);
      const [day] = await sql(readOnly, 'SELECT quantity FROM days WHERE date = ?', [today]);
      assert.equal(day.quantity, 36);
      await close(readOnly);
      console.log('order entry tests: OK (ownership, discount for one serving, capacity, admin auth and cutoff override)');
    } finally {
      if (database) await close(database.db).catch(() => {});
      if (child && child.exitCode === null) {
        const stopped = new Promise((resolve) => child.once('exit', resolve));
        child.kill();
        await stopped;
      }
      fs.rmSync(dbPath, { force: true });
    }
  })().catch((error) => { console.error(error); process.exitCode = 1; });
}
