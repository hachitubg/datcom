const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Database = require('../src/database');

const tempDbPath = path.join(__dirname, '.user-management.db');
const tempSiteDbPath = path.join(__dirname, '.site-admin.db');

function dbCall(database, method, ...args) {
  return new Promise((resolve, reject) => {
    database[method](...args, (err, result) => (err ? reject(err) : resolve(result)));
  });
}

function close(database) {
  return new Promise((resolve, reject) => database.db.close((err) => (err ? reject(err) : resolve())));
}

(async () => {
  fs.rmSync(tempDbPath, { force: true });
  const database = new Database(tempDbPath);
  try {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const protectedUser = await dbCall(database, 'createUser', '0900000001', 'Trung Đường', 'hash', 'salt', 'user');
    const matched = await dbCall(database, 'findRegisteredUserByName', '  trung   duong ');
    assert.strictEqual(matched.id, protectedUser.id);

    await assert.rejects(
      dbCall(database, 'createUser', '0900000002', 'TRUNG DUONG', 'hash', 'salt', 'user'),
      /Tên người dùng đã được đăng ký/
    );

    const secondUser = await dbCall(database, 'createUser', '0900000003', 'Người dùng 2', 'hash', 'salt', 'user');
    await assert.rejects(
      dbCall(database, 'updateUserName', secondUser.id, 'Trung Duong'),
      /Tên người dùng đã được đăng ký/
    );

    for (let index = 4; index <= 13; index++) {
      await dbCall(
        database,
        'createUser',
        `09${String(index).padStart(8, '0')}`,
        `Người dùng ${index}`,
        'hash',
        'salt',
        'user'
      );
    }

    const firstPage = await dbCall(database, 'getUsersPage', 1, 5);
    const lastPage = await dbCall(database, 'getUsersPage', 99, 5);
    assert.deepStrictEqual(
      { rows: firstPage.rows.length, page: firstPage.page, total: firstPage.total, totalPages: firstPage.totalPages },
      { rows: 5, page: 1, total: 12, totalPages: 3 }
    );
    assert.deepStrictEqual(
      { rows: lastPage.rows.length, page: lastPage.page },
      { rows: 2, page: 3 }
    );

    assert.strictEqual(database.parseMenuValue('Cơm chiên tôm'), 'Cơm chiên tôm');
    assert.deepStrictEqual(database.parseMenuValue('{"monChinh":"Cá kho"}'), { monChinh: 'Cá kho' });
    assert.strictEqual(database.parseMenuValue('{không hợp lệ}'), '{không hợp lệ}');

    fs.rmSync(tempSiteDbPath, { force: true });
    const siteDatabase = new Database(tempSiteDbPath, { seedAdmin: false });
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.strictEqual((await dbCall(siteDatabase, 'getUsers')).length, 0);
    await dbCall(siteDatabase, 'createUser', 'admin', 'Admin', 'hash', 'salt', 'admin');
    assert.strictEqual((await dbCall(siteDatabase, 'getUsers')).length, 1);
    const cleanupResult = await dbCall(siteDatabase, 'removeSiteAdminUsers');
    assert.strictEqual(cleanupResult.removed, 1);
    assert.strictEqual((await dbCall(siteDatabase, 'getUsers')).length, 0);
    await close(siteDatabase);
    fs.rmSync(tempSiteDbPath, { force: true });

    console.log('user management tests: OK');
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  } finally {
    await close(database).catch(() => {});
    fs.rmSync(tempDbPath, { force: true });
    fs.rmSync(tempSiteDbPath, { force: true });
  }
})();
