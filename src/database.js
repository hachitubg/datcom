const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class Database {
  constructor() {
    this.db = new sqlite3.Database(path.join(__dirname, '../datcom.db'), (err) => {
      if (err) {
        console.error('Lỗi mở database:', err);
      } else {
        console.log('Kết nối database thành công');
        this.init();
      }
    });
  }

  init() {
    // Tạo bảng ngày
    this.db.run(`
      CREATE TABLE IF NOT EXISTS days (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT UNIQUE NOT NULL,
        menu TEXT DEFAULT 'Cơm chiên tôm',
        quantity INTEGER DEFAULT 10,
        price INTEGER DEFAULT 40000,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Tạo bảng đơn hàng
    this.db.run(`
      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        day_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (day_id) REFERENCES days(id)
      )
    `);

    // Tạo record cho hôm nay nếu chưa có
    this.ensureTodayRecord();
  }

  ensureTodayRecord() {
    const today = this.getDateString();
    this.db.run(
      `INSERT OR IGNORE INTO days (date, menu, quantity, price) VALUES (?, ?, ?, ?)`,
      [today, 'Cơm chiên tôm', 10, 40000]
    );
  }

  getDateString(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  getTodayInfo(callback) {
    const today = this.getDateString();
    this.db.get(
      `SELECT id, date, menu, quantity, price FROM days WHERE date = ?`,
      [today],
      (err, row) => {
        if (err) {
          callback(err);
        } else if (!row) {
          this.ensureTodayRecord();
          this.getTodayInfo(callback);
        } else {
          // Đếm số lượng đã đặt
          this.db.get(
            `SELECT SUM(quantity) as ordered FROM orders WHERE day_id = ?`,
            [row.id],
            (err, orderRow) => {
              if (err) {
                callback(err);
              } else {
                const ordered = (orderRow && orderRow.ordered) || 0;
                const remaining = row.quantity - ordered;
                callback(null, {
                  id: row.id,
                  date: row.date,
                  menu: row.menu,
                  quantity: row.quantity,
                  ordered: ordered,
                  remaining: Math.max(0, remaining),
                  price: row.price
                });
              }
            }
          );
        }
      }
    );
  }

  getTodayOrders(callback) {
    const today = this.getDateString();
    this.db.all(
      `SELECT o.id, o.name, o.quantity, o.description, o.created_at 
       FROM orders o
       JOIN days d ON o.day_id = d.id
       WHERE d.date = ?
       ORDER BY o.created_at ASC`,
      [today],
      callback
    );
  }

  addOrder(name, quantity, description, callback) {
    this.getTodayInfo((err, dayInfo) => {
      if (err) {
        callback(err);
        return;
      }

      if (dayInfo.remaining < quantity) {
        callback(new Error('Không đủ số lượng xuất còn lại'));
        return;
      }

      this.db.run(
        `INSERT INTO orders (day_id, name, quantity, description) VALUES (?, ?, ?, ?)`,
        [dayInfo.id, name, quantity, description],
        function(err) {
          if (err) {
            callback(err);
          } else {
            callback(null, {
              id: this.lastID,
              name,
              quantity,
              description
            });
          }
        }
      );
    });
  }

  getAllDays(callback) {
    this.db.all(
      `SELECT id, date, menu, quantity, price, created_at FROM days ORDER BY date DESC`,
      (err, rows) => {
        if (err) {
          callback(err);
        } else {
          // Đếm số lượng đã đặt cho mỗi ngày
          let completedRows = 0;
          const result = rows.map(row => {
            this.db.get(
              `SELECT SUM(quantity) as ordered FROM orders WHERE day_id = ?`,
              [row.id],
              (err, orderRow) => {
                const ordered = (orderRow && orderRow.ordered) || 0;
                row.ordered = ordered;
                row.remaining = Math.max(0, row.quantity - ordered);
                completedRows++;
                
                if (completedRows === rows.length) {
                  callback(null, rows);
                }
              }
            );
            return row;
          });
          
          if (rows.length === 0) {
            callback(null, []);
          }
        }
      }
    );
  }

  getDayDetails(date, callback) {
    this.db.get(
      `SELECT id, date, menu, quantity, price FROM days WHERE date = ?`,
      [date],
      (err, dayRow) => {
        if (err) {
          callback(err);
        } else if (!dayRow) {
          callback(new Error('Ngày không tồn tại'));
        } else {
          this.db.all(
            `SELECT id, name, quantity, description, created_at FROM orders WHERE day_id = ? ORDER BY created_at ASC`,
            [dayRow.id],
            (err, orders) => {
              if (err) {
                callback(err);
              } else {
                const ordered = orders.reduce((sum, o) => sum + o.quantity, 0);
                callback(null, {
                  day: {
                    id: dayRow.id,
                    date: dayRow.date,
                    menu: dayRow.menu,
                    quantity: dayRow.quantity,
                    price: dayRow.price,
                    ordered: ordered,
                    remaining: Math.max(0, dayRow.quantity - ordered)
                  },
                  orders: orders
                });
              }
            }
          );
        }
      }
    );
  }

  updateTodayMenu(menu, callback) {
    const today = this.getDateString();
    this.db.run(
      `UPDATE days SET menu = ? WHERE date = ?`,
      [menu, today],
      callback
    );
  }

  updateTodayQuantity(quantity, callback) {
    const today = this.getDateString();
    this.db.run(
      `UPDATE days SET quantity = ? WHERE date = ?`,
      [quantity, today],
      callback
    );
  }

  deleteOrder(orderId, callback) {
    this.db.run(
      `DELETE FROM orders WHERE id = ?`,
      [orderId],
      callback
    );
  }
}

module.exports = Database;
