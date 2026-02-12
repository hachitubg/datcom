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
    this.db.serialize(() => {
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

      this.db.run(`
        CREATE TABLE IF NOT EXISTS payment_requests (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          day_id INTEGER NOT NULL,
          customer_name TEXT NOT NULL,
          order_code INTEGER UNIQUE NOT NULL,
          amount INTEGER NOT NULL,
          payment_link_id TEXT,
          checkout_url TEXT,
          qr_code TEXT,
          status TEXT DEFAULT 'PENDING',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (day_id) REFERENCES days(id)
        )
      `);

      this.db.run(`
        CREATE TABLE IF NOT EXISTS payment_transactions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          day_id INTEGER NOT NULL,
          customer_name TEXT NOT NULL,
          order_code INTEGER NOT NULL,
          amount INTEGER NOT NULL,
          status TEXT NOT NULL,
          reference TEXT,
          transaction_date TEXT,
          raw_payload TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (day_id) REFERENCES days(id),
          UNIQUE(order_code, status)
        )
      `);

      // Tạo record cho hôm nay nếu chưa có
      this.ensureTodayRecord();
    });
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
    console.log('📋 Lấy thông tin hôm nay:', today);
    this.db.get(
      `SELECT id, date, menu, quantity, price FROM days WHERE date = ?`,
      [today],
      (err, row) => {
        if (err) {
          console.error('❌ Lỗi truy vấn:', err);
          callback(err);
        } else if (!row) {
          console.log('⚠️  Chưa có record hôm nay, tạo mới');
          this.ensureTodayRecord();
          this.getTodayInfo(callback);
        } else {
          console.log('📦 Raw menu từ DB:', row.menu);
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
                
                // Parse menu nếu là JSON string
                let menu = row.menu;
                try {
                  menu = JSON.parse(row.menu);
                  console.log('✅ Parsed menu object:', menu);
                } catch (e) {
                  console.warn('⚠️  Không parse được JSON, giữ nguyên string:', row.menu);
                  // Nếu không phải JSON, giữ nguyên string
                }
                
                callback(null, {
                  id: row.id,
                  date: row.date,
                  menu: menu,
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
    console.log('📚 Tải tất cả các ngày từ database');
    this.db.all(
      `SELECT id, date, menu, quantity, price, created_at FROM days ORDER BY date DESC`,
      (err, rows) => {
        if (err) {
          console.error('❌ Lỗi getAllDays:', err);
          callback(err);
        } else {
          console.log('✅ Tìm thấy', rows.length, 'ngày');
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
                  console.log('📊 Dữ liệu lịch sử đã sẵn sàng');
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
    console.log('🔍 Tìm chi tiết ngày:', date);
    this.db.get(
      `SELECT id, date, menu, quantity, price FROM days WHERE date = ?`,
      [date],
      (err, dayRow) => {
        if (err) {
          console.error('❌ Lỗi getDayDetails:', err);
          callback(err);
        } else if (!dayRow) {
          console.warn('⚠️  Ngày không tồn tại:', date);
          callback(new Error('Ngày không tồn tại'));
        } else {
          console.log('📦 Tìm thấy ngày:', date);
          this.db.all(
            `SELECT id, name, quantity, description, created_at FROM orders WHERE day_id = ? ORDER BY created_at ASC`,
            [dayRow.id],
            (err, orders) => {
              if (err) {
                console.error('❌ Lỗi tìm đơn hàng:', err);
                callback(err);
              } else {
                const ordered = orders.reduce((sum, o) => sum + o.quantity, 0);
                console.log('📋 Tìm thấy', orders.length, 'đơn hàng');
                
                // Parse menu if it's JSON
                let menu = dayRow.menu;
                try {
                  menu = JSON.parse(dayRow.menu);
                } catch (e) {
                  // Keep as string if not JSON
                }
                
                callback(null, {
                  day: {
                    id: dayRow.id,
                    date: dayRow.date,
                    menu: menu,
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

  updateTodayMenu(menuJson, callback) {
    const today = this.getDateString();
    console.log('🗄️  Lưu vào database - Date:', today, 'Menu:', menuJson);
    this.db.run(
      `UPDATE days SET menu = ? WHERE date = ?`,
      [menuJson, today],
      (err) => {
        if (err) {
          console.error('❌ Lỗi database:', err);
        } else {
          console.log('✅ Database cập nhật thành công');
        }
        callback(err);
      }
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

  getTodayPaymentSummary(searchKeyword, callback) {
    const today = this.getDateString();
    const keyword = (searchKeyword || '').trim().toLowerCase();
    const normalizedKeyword = keyword.replace(/['\s]+/g, '');
    const searchParams = normalizedKeyword ? [`%${normalizedKeyword}%`] : [];

    const sql = `
      SELECT
        o.name,
        SUM(o.quantity) AS quantity,
        d.price AS unit_price,
        SUM(o.quantity) * d.price AS total_amount,
        COALESCE(paid.total_paid, 0) AS paid_amount,
        MAX(o.created_at) AS last_order_time
      FROM orders o
      JOIN days d ON o.day_id = d.id
      LEFT JOIN (
        SELECT day_id, customer_name, SUM(amount) AS total_paid
        FROM payment_transactions
        WHERE status = 'PAID'
        GROUP BY day_id, customer_name
      ) paid ON paid.day_id = o.day_id AND LOWER(paid.customer_name) = LOWER(o.name)
      WHERE d.date = ?
      ${normalizedKeyword ? "AND LOWER(REPLACE(REPLACE(o.name, '''', ''), ' ', '')) LIKE ?" : ''}
      GROUP BY LOWER(o.name), d.price
      ORDER BY o.name COLLATE NOCASE ASC
    `;

    this.db.all(sql, [today, ...searchParams], (err, rows = []) => {
      if (err) {
        callback(err);
        return;
      }

      const summary = rows.map((row) => {
        const totalAmount = row.total_amount || 0;
        const paidAmount = row.paid_amount || 0;
        return {
          name: row.name,
          quantity: row.quantity,
          unitPrice: row.unit_price,
          totalAmount,
          paidAmount,
          remainingAmount: Math.max(0, totalAmount - paidAmount),
          status: paidAmount >= totalAmount ? 'PAID' : paidAmount > 0 ? 'PARTIAL' : 'UNPAID',
          lastOrderTime: row.last_order_time
        };
      });

      callback(null, summary);
    });
  }

  getTodayCustomerPayment(name, callback) {
    const today = this.getDateString();

    this.db.get(
      `SELECT d.id AS day_id, d.price AS unit_price, SUM(o.quantity) AS quantity
       FROM orders o
       JOIN days d ON o.day_id = d.id
       WHERE d.date = ? AND LOWER(o.name) = LOWER(?)`,
      [today, name],
      (err, row) => {
        if (err) {
          callback(err);
          return;
        }

        if (!row || !row.quantity) {
          callback(new Error('Không tìm thấy đơn đặt cơm của tên này trong hôm nay'));
          return;
        }

        this.db.get(
          `SELECT COALESCE(SUM(amount), 0) AS paid_amount
           FROM payment_transactions
           WHERE day_id = ? AND LOWER(customer_name) = LOWER(?) AND status = 'PAID'`,
          [row.day_id, name],
          (paidErr, paidRow) => {
            if (paidErr) {
              callback(paidErr);
              return;
            }

            const totalAmount = row.quantity * row.unit_price;
            const paidAmount = (paidRow && paidRow.paid_amount) || 0;
            callback(null, {
              dayId: row.day_id,
              name,
              quantity: row.quantity,
              unitPrice: row.unit_price,
              totalAmount,
              paidAmount,
              remainingAmount: Math.max(0, totalAmount - paidAmount)
            });
          }
        );
      }
    );
  }

  createPaymentRequest(data, callback) {
    const { dayId, customerName, orderCode, amount, paymentLinkId, checkoutUrl, qrCode } = data;
    this.db.run(
      `INSERT INTO payment_requests
        (day_id, customer_name, order_code, amount, payment_link_id, checkout_url, qr_code, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
      [dayId, customerName, orderCode, amount, paymentLinkId || '', checkoutUrl || '', qrCode || ''],
      callback
    );
  }

  markPaymentPaid(orderCode, paymentData, callback) {
    const normalizedOrderCode = Number(orderCode);
    this.db.get(
      `SELECT id, day_id, customer_name FROM payment_requests WHERE order_code = ?`,
      [normalizedOrderCode],
      (err, requestRow) => {
        if (err) {
          callback(err);
          return;
        }

        if (!requestRow) {
          callback(new Error('Không tìm thấy yêu cầu thanh toán tương ứng'));
          return;
        }

        const amount = Number(paymentData.amount || 0);
        const status = 'PAID';
        const reference = paymentData.reference || paymentData.code || paymentData.paymentLinkId || '';
        const transactionDate = paymentData.transactionDateTime || paymentData.transactionDate || '';

        this.db.run(
          `INSERT OR IGNORE INTO payment_transactions
            (day_id, customer_name, order_code, amount, status, reference, transaction_date, raw_payload)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            requestRow.day_id,
            requestRow.customer_name,
            normalizedOrderCode,
            amount,
            status,
            reference,
            transactionDate,
            JSON.stringify(paymentData)
          ],
          (insertErr) => {
            if (insertErr) {
              callback(insertErr);
              return;
            }

            this.db.run(
              `UPDATE payment_requests
               SET status = 'PAID', updated_at = CURRENT_TIMESTAMP
               WHERE order_code = ?`,
              [normalizedOrderCode],
              callback
            );
          }
        );
      }
    );
  }

  getPaymentHistory(searchKeyword, callback) {
    const keyword = (searchKeyword || '').trim().toLowerCase();
    const normalizedKeyword = keyword.replace(/['\s]+/g, '');
    const query = `
      SELECT
        t.customer_name,
        t.amount,
        t.order_code,
        t.reference,
        t.transaction_date,
        t.created_at,
        d.date
      FROM payment_transactions t
      JOIN days d ON t.day_id = d.id
      WHERE t.status = 'PAID'
      ${normalizedKeyword ? "AND LOWER(REPLACE(REPLACE(t.customer_name, '''', ''), ' ', '')) LIKE ?" : ''}
      ORDER BY COALESCE(t.transaction_date, t.created_at) DESC
      LIMIT 200
    `;

    this.db.all(query, normalizedKeyword ? [`%${normalizedKeyword}%`] : [], callback);
  }
}

module.exports = Database;
