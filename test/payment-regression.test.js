const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Database = require('../src/database');
const PayOSService = require('../src/payos');

const tempDbPath = path.join(__dirname, '.payment-regression.db');

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

function close(database) {
  return new Promise((resolve, reject) => database.db.close((err) => (err ? reject(err) : resolve())));
}

async function testWebhookSignature() {
  const service = new PayOSService();
  service.checksumKey = '1a54716c8f0efb2744fb28b6e38b25da7f67a925d98bc1c18bd8faaecadd7675';
  const webhook = {
    data: {
      orderCode: 123,
      amount: 3000,
      description: 'VQRIO123',
      accountNumber: '12345678',
      reference: 'TF230204212323',
      transactionDateTime: '2023-02-04 18:25:00',
      currency: 'VND',
      paymentLinkId: '124c33293c43417ab7879e14c8d9eb18',
      code: '00',
      desc: 'Thành công',
      counterAccountBankId: '',
      counterAccountBankName: '',
      counterAccountName: '',
      counterAccountNumber: '',
      virtualAccountName: '',
      virtualAccountNumber: ''
    },
    signature: '412e915d2871504ed31be63c8f62a149a4410d34c4c42affc9006ef9917eaa03'
  };
  assert.strictEqual(service.verifyWebhook(webhook), true, 'Official PayOS webhook signature must verify');
  webhook.data.amount = 3001;
  assert.strictEqual(service.verifyWebhook(webhook), false, 'Modified webhook data must fail verification');
}

async function testDatabasePaymentRules() {
  fs.rmSync(tempDbPath, { force: true });
  const database = new Database(tempDbPath);
  await new Promise((resolve) => setTimeout(resolve, 250));

  const day = await run(
    database.db,
    `INSERT INTO days (date, menu, quantity, price) VALUES ('2026-01-02', 'Test', 20, 40000)`
  );
  await run(database.db, 'INSERT INTO orders (day_id, name, quantity) VALUES (?, ?, 1)', [day.id, 'Sơn T6']);
  await run(database.db, 'INSERT INTO orders (day_id, name, quantity) VALUES (?, ?, 1)', [day.id, 'Son T6']);

  assert.strictEqual(await dbCall(database, 'resolveCustomerName', 'Sơn T6'), 'Sơn T6');
  assert.strictEqual(await dbCall(database, 'resolveCustomerName', 'Son T6'), 'Son T6');

  await run(
    database.db,
    `INSERT INTO payment_requests
      (day_id, customer_name, order_code, amount, status)
     VALUES (?, 'Sơn T6', 900001, 80000, 'PENDING')`,
    [day.id]
  );
  await dbCall(database, 'markPaymentPaid', 900001, {
    amount: 80000,
    reference: 'PAYOS-TEST',
    transactionDateTime: '2026-01-02T10:00:00+07:00'
  });
  await dbCall(database, 'markPaymentPaid', 900001, {
    amount: 80000,
    reference: 'PAYOS-TEST',
    transactionDateTime: '2026-01-02T10:00:00+07:00'
  });

  const transaction = await get(
    database.db,
    `SELECT COUNT(*) AS count, SUM(amount) AS amount
     FROM payment_transactions WHERE order_code = 900001 AND status = 'PAID'`
  );
  assert.deepStrictEqual(transaction, { count: 1, amount: 80000 });

  await run(database.db, `INSERT INTO payment_requests (day_id, customer_name, order_code, amount, status) VALUES (?, 'A', 900002, 40000, 'PENDING')`, [day.id]);
  await run(database.db, `INSERT INTO payment_requests (day_id, customer_name, order_code, amount, status) VALUES (?, 'A', 900003, 40000, 'SUPERSEDED')`, [day.id]);
  await run(database.db, `INSERT INTO payment_requests (day_id, customer_name, order_code, amount, status) VALUES (?, 'A', 900004, 40000, 'EXPIRED')`, [day.id]);
  const syncable = await dbCall(database, 'getSyncablePaymentRequests', 20);
  assert.deepStrictEqual(syncable.map((row) => row.order_code).sort(), [900002, 900003]);

  await close(database);
  fs.rmSync(tempDbPath, { force: true });
}

(async () => {
  try {
    await testWebhookSignature();
    await testDatabasePaymentRules();
    console.log('payment regression tests: OK');
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
    fs.rmSync(tempDbPath, { force: true });
  }
})();
