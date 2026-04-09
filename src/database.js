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
          quantity INTEGER DEFAULT 40,
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

      // Bảng mã khuyến mãi
      this.db.run(`
        CREATE TABLE IF NOT EXISTS promo_codes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          code TEXT UNIQUE NOT NULL,
          discount_percent INTEGER NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          used_by TEXT,
          used_at DATETIME,
          order_id INTEGER,
          FOREIGN KEY (order_id) REFERENCES orders(id)
        )
      `);

      // Bảng người dùng
      this.db.run(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          phone TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          salt TEXT NOT NULL,
          role TEXT DEFAULT 'user',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Bảng cấu hình hệ thống (key-value)
      this.db.run(`
        CREATE TABLE IF NOT EXISTS app_settings (
          key TEXT PRIMARY KEY NOT NULL,
          value TEXT NOT NULL,
          description TEXT,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      this.db.run(`
        CREATE TABLE IF NOT EXISTS feedback_submissions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          message TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      this.db.run(`
        CREATE TABLE IF NOT EXISTS user_sessions (
          token TEXT PRIMARY KEY NOT NULL,
          user_id INTEGER NOT NULL,
          role TEXT NOT NULL,
          expires_at DATETIME NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id)
        )
      `);

      // Thêm cột discount vào orders (bỏ qua lỗi nếu đã tồn tại)
      this.db.run("ALTER TABLE orders ADD COLUMN discount_percent INTEGER DEFAULT 0", () => {});
      this.db.run("ALTER TABLE orders ADD COLUMN promo_code TEXT", () => {});
      this.db.run("ALTER TABLE orders ADD COLUMN user_id INTEGER", () => {});
      this.db.run("ALTER TABLE users ADD COLUMN session_version INTEGER DEFAULT 1", () => {});

      // Tạo record cho hôm nay nếu chưa có
      this.ensureTodayRecord();
      this.seedAdminUser();
      this.seedDefaultSettings();
      this.cleanupExpiredSessions(() => {});
    });
  }

  ensureTodayRecord() {
    const today = this.getDateString();
    this.db.run(
      `INSERT OR IGNORE INTO days (date, menu, quantity, price) VALUES (?, ?, ?, ?)`,
      [today, 'Cơm chiên tôm', 40, 40000]
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
      `SELECT o.id, o.name, o.quantity, o.description, o.created_at,
              COALESCE(o.discount_percent, 0) AS discount_percent,
              o.promo_code, o.user_id
       FROM orders o
       JOIN days d ON o.day_id = d.id
       WHERE d.date = ?
       ORDER BY o.created_at DESC`,
      [today],
      callback
    );
  }

  addOrder(name, quantity, description, promoCode, userId, callback) {
    if (typeof promoCode === 'function') {
      callback = promoCode;
      promoCode = null;
      userId = null;
    } else if (typeof userId === 'function') {
      callback = userId;
      userId = null;
    }

    const normalizedQuantity = Number(quantity || 0);
    const normalizedDescription = String(description || '').trim();
    const normalizedPromoCode = String(promoCode || '').trim().toUpperCase();
    const finalUserId = userId || null;
    const today = this.getDateString();
    const dbConn = this.db;
    let finished = false;

    const done = (err, result) => {
      if (finished) return;
      finished = true;
      callback(err, result);
    };

    const rollback = (err) => {
      dbConn.run(`ROLLBACK`, () => done(err));
    };

    const commit = (result) => {
      dbConn.run(`COMMIT`, (commitErr) => {
        if (commitErr) {
          rollback(commitErr);
          return;
        }
        done(null, result);
      });
    };

    dbConn.serialize(() => {
      dbConn.run(`BEGIN IMMEDIATE TRANSACTION`, (beginErr) => {
        if (beginErr) {
          done(beginErr);
          return;
        }

        dbConn.run(
          `INSERT OR IGNORE INTO days (date, menu, quantity, price) VALUES (?, ?, ?, ?)`,
          [today, 'Com chien tom', 40, 40000],
          (ensureErr) => {
            if (ensureErr) {
              rollback(ensureErr);
              return;
            }

            dbConn.get(
              `SELECT id, quantity FROM days WHERE date = ?`,
              [today],
              (dayErr, dayInfo) => {
                if (dayErr) {
                  rollback(dayErr);
                  return;
                }

                if (!dayInfo) {
                  rollback(new Error('Khong tim thay thong tin ngay hien tai'));
                  return;
                }

                dbConn.get(
                  `SELECT COALESCE(SUM(quantity), 0) AS ordered FROM orders WHERE day_id = ?`,
                  [dayInfo.id],
                  (sumErr, orderRow) => {
                    if (sumErr) {
                      rollback(sumErr);
                      return;
                    }

                    if (!Number.isFinite(normalizedQuantity) || normalizedQuantity <= 0) {
                      rollback(new Error('So luong dat khong hop le'));
                      return;
                    }

                    const remaining = Number(dayInfo.quantity || 0) - Number(orderRow?.ordered || 0);
                    if (remaining < normalizedQuantity) {
                      rollback(new Error('Khong du so luong suat con lai'));
                      return;
                    }

                    const insertOrder = (discountPercent, codeUsed, promoId) => {
                      dbConn.run(
                        `INSERT INTO orders (day_id, name, quantity, description, discount_percent, promo_code, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                        [dayInfo.id, name, normalizedQuantity, normalizedDescription, discountPercent || 0, codeUsed || null, finalUserId],
                        function(insertErr) {
                          if (insertErr) {
                            rollback(insertErr);
                            return;
                          }

                          const orderId = this.lastID;
                          const result = {
                            id: orderId,
                            name,
                            quantity: normalizedQuantity,
                            description: normalizedDescription,
                            discount_percent: discountPercent || 0,
                            promo_code: codeUsed || null
                          };

                          if (!promoId) {
                            commit(result);
                            return;
                          }

                          dbConn.run(
                            `UPDATE promo_codes SET used_by = ?, used_at = CURRENT_TIMESTAMP, order_id = ? WHERE id = ? AND used_by IS NULL`,
                            [name, orderId, promoId],
                            function(updateErr) {
                              if (updateErr) {
                                rollback(updateErr);
                                return;
                              }

                              if ((this.changes || 0) !== 1) {
                                rollback(new Error('Ma khuyen mai khong hop le hoac da duoc su dung'));
                                return;
                              }

                              commit(result);
                            }
                          );
                        }
                      );
                    };

                    if (!normalizedPromoCode) {
                      insertOrder(0, null, null);
                      return;
                    }

                    dbConn.get(
                      `SELECT id, discount_percent FROM promo_codes WHERE UPPER(code) = ? AND used_by IS NULL`,
                      [normalizedPromoCode],
                      (promoErr, promo) => {
                        if (promoErr) {
                          rollback(promoErr);
                          return;
                        }

                        if (!promo) {
                          rollback(new Error('Ma khuyen mai khong hop le hoac da duoc su dung'));
                          return;
                        }

                        insertOrder(Number(promo.discount_percent || 0), normalizedPromoCode, promo.id);
                      }
                    );
                  }
                );
              }
            );
          }
        );
      });
    });
  }

  getAllDays(callback) {
    console.log('📚 Tải các ngày có phát sinh đơn hàng');
    this.db.all(
      `SELECT
         d.id,
         d.date,
         d.menu,
         d.quantity,
         d.price,
         d.created_at,
         COALESCE(SUM(o.quantity), 0) AS ordered
       FROM days d
       LEFT JOIN orders o ON o.day_id = d.id
       GROUP BY d.id
       HAVING COALESCE(SUM(o.quantity), 0) > 0
       ORDER BY d.date DESC`,
      (err, rows = []) => {
        if (err) {
          console.error('❌ Lỗi getAllDays:', err);
          callback(err);
          return;
        }

        const mapped = rows.map((row) => ({
          ...row,
          ordered: row.ordered || 0,
          remaining: Math.max(0, row.quantity - (row.ordered || 0))
        }));

        console.log('✅ Tìm thấy', mapped.length, 'ngày có đơn hàng');
        callback(null, mapped);
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
            `SELECT id, name, quantity, description, created_at, COALESCE(discount_percent, 0) AS discount_percent, promo_code FROM orders WHERE day_id = ? ORDER BY created_at DESC, id DESC`,
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

  getCustomerOrderDetails(name, callback) {
    const normalizedName = String(name || '').trim();
    if (!normalizedName) {
      callback(new Error('Thiếu tên khách hàng'));
      return;
    }

    // Lấy tất cả ngày đặt, sắp xếp cũ nhất trước để áp dụng FIFO
    this.db.all(
      `SELECT d.date, SUM(o.quantity) AS quantity, SUM(o.quantity * d.price * (100 - COALESCE(o.discount_percent, 0)) / 100) AS day_amount,
              MAX(CASE WHEN o.promo_code IS NOT NULL AND o.promo_code != '' THEN 1 ELSE 0 END) AS has_promo
       FROM orders o JOIN days d ON d.id = o.day_id
       WHERE LOWER(o.name) = LOWER(?)
       GROUP BY d.date ORDER BY d.date ASC`,
      [normalizedName],
      (err, orderRows = []) => {
        if (err) { callback(err); return; }

        // Lấy tổng tiền đã thanh toán (toàn bộ lịch sử, không phân biệt day_id)
        this.db.get(
          `SELECT COALESCE(SUM(amount), 0) AS total_paid
           FROM payment_transactions
           WHERE status = 'PAID' AND LOWER(customer_name) = LOWER(?)`,
          [normalizedName],
          (err2, payRow) => {
            if (err2) { callback(err2); return; }

            // FIFO waterfall: trừ tiền đã trả từ đơn cũ nhất trước
            let pool = Number(payRow?.total_paid || 0);
            const unpaidRows = [];

            for (const row of orderRows) {
              const dayAmount = Number(row.day_amount || 0);
              const applied = Math.min(pool, dayAmount);
              pool -= applied;
              const dayRemaining = dayAmount - applied;

              // Popup/thống kê thanh toán chỉ nên hiển thị các ngày còn nợ thực sự.
              // Các đơn dùng mã KM 100% có day_amount = 0 không phải là công nợ
              // nên không được giữ lại trong danh sách thanh toán.
              if (dayRemaining > 0) {
                unpaidRows.push({
                  date: row.date,
                  quantity: Number(row.quantity || 0),
                  totalAmount: dayAmount,
                  paidAmount: applied,
                  remainingAmount: dayRemaining
                });
              }
            }

            // Lấy thêm chi tiết promo cho các ngày hiển thị
            const displayDates = unpaidRows.map(r => r.date);
            if (displayDates.length === 0) {
              callback(null, []);
              return;
            }
            const placeholders = displayDates.map(() => '?').join(', ');
            this.db.all(
              `SELECT d.date, o.quantity, o.promo_code, COALESCE(o.discount_percent, 0) AS discount_percent, d.price
               FROM orders o JOIN days d ON d.id = o.day_id
               WHERE LOWER(o.name) = LOWER(?) AND d.date IN (${placeholders})
               ORDER BY d.date ASC, o.created_at ASC`,
              [normalizedName, ...displayDates],
              (err3, detailRows = []) => {
                if (err3) { callback(err3); return; }

                // Nhóm chi tiết promo theo ngày
                const promoByDate = {};
                for (const d of detailRows) {
                  if (d.promo_code) {
                    if (!promoByDate[d.date]) promoByDate[d.date] = [];
                    const disc = Number(d.discount_percent || 0);
                    const unitPrice = Number(d.price || 0);
                    const finalPrice = Math.round(unitPrice * (100 - disc) / 100);
                    promoByDate[d.date].push({
                      promo_code: d.promo_code,
                      discount_percent: disc,
                      quantity: Number(d.quantity || 0),
                      unitPrice,
                      finalPrice
                    });
                  }
                }

                for (const row of unpaidRows) {
                  row.promos = promoByDate[row.date] || [];
                }

                // Hiển thị ngày gần nhất lên trên
                unpaidRows.reverse();
                callback(null, unpaidRows);
              }
            );
          }
        );
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

  getOrderById(orderId, callback) {
    this.db.get(
      `SELECT id, name, quantity, description, created_at, user_id FROM orders WHERE id = ?`,
      [orderId],
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

  updateOrder(orderId, data, callback) {
    const normalizedName = (data.name || '').trim().replace(/\s+/g, ' ');
    const normalizedQuantity = Number(data.quantity || 0);
    const normalizedDescription = (data.description || '').trim();

    if (!normalizedName || !Number.isFinite(normalizedQuantity) || normalizedQuantity <= 0) {
      callback(new Error('Dữ liệu cập nhật đơn hàng không hợp lệ'));
      return;
    }

    this.db.run(
      `UPDATE orders
       SET name = ?, quantity = ?, description = ?
       WHERE id = ?`,
      [normalizedName, normalizedQuantity, normalizedDescription, Number(orderId)],
      callback
    );
  }

  getKnownCustomerNames(callback) {
    const query = `
      SELECT name FROM orders
      UNION
      SELECT customer_name AS name FROM payment_requests
      UNION
      SELECT customer_name AS name FROM payment_transactions
    `;

    this.db.all(query, (err, rows = []) => {
      if (err) {
        callback(err);
        return;
      }

      const uniqueMap = new Map();
      rows.forEach((row) => {
        const originalName = (row.name || '').trim().replace(/\s+/g, ' ');
        if (!originalName) return;
        const normalizedName = originalName.toLowerCase();
        if (!uniqueMap.has(normalizedName)) {
          uniqueMap.set(normalizedName, originalName);
        }
      });

      const names = Array.from(uniqueMap.values()).sort((a, b) => a.localeCompare(b, 'vi'));
      callback(null, names);
    });
  }

  renameCustomer(oldName, newName, callback) {
    const normalizedOld = (oldName || '').trim().replace(/\s+/g, ' ');
    const normalizedNew = (newName || '').trim().replace(/\s+/g, ' ');

    if (!normalizedOld || !normalizedNew) {
      callback(new Error('Tên cũ hoặc tên mới không hợp lệ'));
      return;
    }

    const keyExpression = "LOWER(REPLACE(REPLACE(%COLUMN%, '''', ''), ' ', ''))";
    const oldKey = normalizedOld.toLowerCase().replace(/['\s]+/g, '');
    const dbConn = this.db;

    dbConn.serialize(() => {
      dbConn.run(
        `UPDATE orders SET name = ? WHERE ${keyExpression.replace('%COLUMN%', 'name')} = ?`,
        [normalizedNew, oldKey],
        function onOrdersUpdated(ordersErr) {
          if (ordersErr) {
            callback(ordersErr);
            return;
          }

          const updatedOrders = this.changes || 0;

          dbConn.run(
            `UPDATE payment_requests SET customer_name = ? WHERE ${keyExpression.replace('%COLUMN%', 'customer_name')} = ?`,
            [normalizedNew, oldKey],
            function onPaymentRequestsUpdated(paymentRequestsErr) {
              if (paymentRequestsErr) {
                callback(paymentRequestsErr);
                return;
              }

              const updatedPaymentRequests = this.changes || 0;

              dbConn.run(
                `UPDATE payment_transactions SET customer_name = ? WHERE ${keyExpression.replace('%COLUMN%', 'customer_name')} = ?`,
                [normalizedNew, oldKey],
                function onPaymentTransactionsUpdated(paymentTransactionsErr) {
                  if (paymentTransactionsErr) {
                    callback(paymentTransactionsErr);
                    return;
                  }

                  callback(null, {
                    updatedOrders,
                    updatedPaymentRequests,
                    updatedPaymentTransactions: this.changes || 0
                  });
                }
              );
            }
          );
        }
      );
    });
  }

  getTodayPaymentSummary(searchKeyword, callback) {
    const keyword = (searchKeyword || '').trim().toLowerCase();
    const normalizedKeyword = keyword.replace(/['\s]+/g, '');
    const searchParams = [...(normalizedKeyword ? [`%${normalizedKeyword}%`] : [])];

    // FIFO waterfall bằng SQL CTE + window function:
    // 1. order_days: tính running_total (cộng dồn từ ngày cũ nhất) theo từng khách
    // 2. customer_paid: tổng tiền đã trả toàn bộ lịch sử per khách
    // 3. day_rem: áp dụng công thức FIFO để tính phần còn nợ mỗi ngày
    // 4. Gom lại 1 dòng per khách, chỉ tính ngày còn nợ
    const sql = `
      WITH order_days AS (
        SELECT
          LOWER(o.name)                    AS norm_name,
          MIN(o.name)                      AS display_name,
          d.date,
          SUM(o.quantity)                  AS quantity,
          SUM(o.quantity * d.price * (100 - COALESCE(o.discount_percent, 0)) / 100) AS day_amount,
          SUM(SUM(o.quantity * d.price * (100 - COALESCE(o.discount_percent, 0)) / 100)) OVER (
            PARTITION BY LOWER(o.name)
            ORDER BY d.date ASC
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
          )                                AS running_total,
          MAX(o.created_at)                AS last_order_time
        FROM orders o
        JOIN days d ON o.day_id = d.id
        ${normalizedKeyword ? "WHERE LOWER(REPLACE(REPLACE(o.name, '''', ''), ' ', '')) LIKE ?" : ''}
        GROUP BY LOWER(o.name), d.date
      ),
      customer_paid AS (
        SELECT
          LOWER(customer_name)             AS norm_name,
          COALESCE(SUM(amount), 0)         AS total_paid
        FROM payment_transactions
        WHERE status = 'PAID'
        GROUP BY LOWER(customer_name)
      ),
      day_rem AS (
        SELECT
          od.norm_name,
          od.display_name,
          od.quantity,
          od.day_amount,
          od.last_order_time,
          CASE
            WHEN od.running_total - COALESCE(cp.total_paid, 0) <= 0
              THEN 0
            WHEN od.running_total - COALESCE(cp.total_paid, 0) < od.day_amount
              THEN od.running_total - COALESCE(cp.total_paid, 0)
            ELSE od.day_amount
          END AS rem
        FROM order_days od
        LEFT JOIN customer_paid cp ON cp.norm_name = od.norm_name
      )
      SELECT
        MIN(display_name)                                          AS name,
        SUM(CASE WHEN rem > 0 THEN quantity ELSE 0 END)           AS quantity,
        SUM(CASE WHEN rem > 0 THEN day_amount ELSE 0 END)         AS total_amount,
        SUM(rem)                                                   AS remaining_amount,
        MAX(last_order_time)                                       AS last_order_time
      FROM day_rem
      GROUP BY norm_name
      HAVING SUM(rem) > 0
      ORDER BY SUM(rem) DESC, MIN(display_name) COLLATE NOCASE ASC
    `;

    this.db.all(sql, searchParams, (err, rows = []) => {
      if (err) {
        callback(err);
        return;
      }

      const summary = rows.map((row) => {
        const totalAmount = row.total_amount || 0;
        const remainingAmount = row.remaining_amount || 0;
        return {
          name: row.name,
          quantity: row.quantity,
          unitPrice: row.quantity > 0 ? Math.round(totalAmount / row.quantity) : 0,
          totalAmount,
          paidAmount: Math.max(0, totalAmount - remainingAmount),
          remainingAmount: Math.max(0, remainingAmount),
          status: remainingAmount <= 0 ? 'PAID' : totalAmount > remainingAmount ? 'PARTIAL' : 'UNPAID',
          lastOrderTime: row.last_order_time,
          latestPendingOrderCode: 0
        };
      });

      callback(null, summary);
    });
  }


  getTodayCustomerOrderDetails(name, callback) {
    const normalizedName = String(name || '').trim();
    if (!normalizedName) {
      callback(new Error('Thiếu tên khách hàng'));
      return;
    }

    // Bước 1: lấy tổng tiền mỗi ngày (cũ nhất trước) để tính FIFO
    this.db.all(
      `SELECT d.date, SUM(o.quantity * d.price * (100 - COALESCE(o.discount_percent, 0)) / 100) AS day_amount
       FROM orders o JOIN days d ON d.id = o.day_id
       WHERE LOWER(o.name) = LOWER(?)
       GROUP BY d.date ORDER BY d.date ASC`,
      [normalizedName],
      (err, dayRows = []) => {
        if (err) { callback(err); return; }

        // Bước 2: tổng tiền đã thanh toán (toàn bộ lịch sử)
        this.db.get(
          `SELECT COALESCE(SUM(amount), 0) AS total_paid
           FROM payment_transactions
           WHERE status = 'PAID' AND LOWER(customer_name) = LOWER(?)`,
          [normalizedName],
          (err2, payRow) => {
            if (err2) { callback(err2); return; }

            // Bước 3: FIFO waterfall - xác định ngày nào còn nợ và còn bao nhiêu
            let pool = Number(payRow?.total_paid || 0);
            const unpaidDates = new Set();
            let totalRemaining = 0;

            for (const day of dayRows) {
              const dayAmount = Number(day.day_amount || 0);
              const applied = Math.min(pool, dayAmount);
              pool -= applied;
              const dayRemaining = dayAmount - applied;
              if (dayRemaining > 0) {
                unpaidDates.add(day.date);
                totalRemaining += dayRemaining;
              }
            }

            const allDates = Array.from(unpaidDates);
            if (allDates.length === 0) {
              return callback(null, { name: normalizedName, totalQuantity: 0, totalAmount: 0, rows: [] });
            }

            // Bước 4: lấy từng đơn lẻ thuộc các ngày còn nợ thực sự.
            const placeholders = allDates.map(() => '?').join(', ');
            this.db.all(
              `SELECT o.id, o.quantity, o.description, o.created_at, d.price, d.date,
                      COALESCE(o.discount_percent, 0) AS discount_percent, o.promo_code
               FROM orders o JOIN days d ON d.id = o.day_id
               WHERE LOWER(o.name) = LOWER(?) AND d.date IN (${placeholders})
               ORDER BY d.date ASC, o.created_at ASC, o.id ASC`,
              [normalizedName, ...allDates],
              (err3, orderRows = []) => {
                if (err3) { callback(err3); return; }

                const mappedRows = orderRows.map((row) => {
                  const disc = Number(row.discount_percent || 0);
                  const rawAmount = Number(row.quantity || 0) * Number(row.price || 0);
                  return {
                    id: Number(row.id),
                    quantity: Number(row.quantity || 0),
                    description: row.description || '',
                    createdAt: row.created_at || '',
                    amount: Math.round(rawAmount * (100 - disc) / 100),
                    discount_percent: disc,
                    promo_code: row.promo_code || null
                  };
                });

                const totalQuantity = mappedRows.reduce((sum, r) => sum + r.quantity, 0);

                callback(null, {
                  name: normalizedName,
                  totalQuantity,
                  totalAmount: totalRemaining,
                  rows: mappedRows
                });
              }
            );
          }
        );
      }
    );
  }

  getTodayCustomerPayment(name, callback) {
    // Bước 1: Lấy day_id của ngày có đơn gần nhất (không bắt buộc hôm nay)
    this.db.get(
      `SELECT d.id AS day_id
       FROM days d
       JOIN orders o ON o.day_id = d.id
       WHERE LOWER(o.name) = LOWER(?)
       ORDER BY d.date DESC
       LIMIT 1`,
      [name],
      (err, latestRow) => {
        if (err) { callback(err); return; }

        if (!latestRow) {
          callback(new Error('Không tìm thấy đơn đặt cơm nào của khách này'));
          return;
        }

        // Bước 2: Tính tổng tiền và số lượng trên TẤT CẢ các ngày (không chỉ hôm nay)
        this.db.get(
          `SELECT SUM(o.quantity) AS quantity, SUM(o.quantity * d.price * (100 - COALESCE(o.discount_percent, 0)) / 100) AS total_amount
           FROM orders o
           JOIN days d ON o.day_id = d.id
           WHERE LOWER(o.name) = LOWER(?)`,
          [name],
          (err2, allRow) => {
            if (err2) { callback(err2); return; }

            // Bước 3: Tổng tiền đã thanh toán trên toàn bộ lịch sử (FIFO)
            this.db.get(
              `SELECT COALESCE(SUM(amount), 0) AS paid_amount
               FROM payment_transactions
               WHERE LOWER(customer_name) = LOWER(?) AND status = 'PAID'`,
              [name],
              (err3, paidRow) => {
                if (err3) { callback(err3); return; }

                const totalAmount = Number(allRow?.total_amount || 0);
                const paidAmount = Number(paidRow?.paid_amount || 0);
                const quantity = Number(allRow?.quantity || 0);

                callback(null, {
                  dayId: latestRow.day_id,
                  name,
                  quantity,
                  unitPrice: quantity > 0 ? Math.round(totalAmount / quantity) : 0,
                  totalAmount,
                  paidAmount,
                  remainingAmount: Math.max(0, totalAmount - paidAmount)
                });
              }
            );
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

  getLatestPendingPaymentRequest(customerName, callback) {
    const normalizedName = String(customerName || '').trim();
    if (!normalizedName) {
      callback(null, null);
      return;
    }

    this.db.get(
      `SELECT id, day_id, customer_name, order_code, amount, payment_link_id, checkout_url, qr_code, status, created_at, updated_at
       FROM payment_requests
       WHERE LOWER(customer_name) = LOWER(?) AND status = 'PENDING'
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [normalizedName],
      callback
    );
  }

  supersedePendingPaymentRequests(customerName, keepOrderCode, callback) {
    const normalizedName = String(customerName || '').trim();
    const normalizedOrderCode = Number(keepOrderCode || 0);
    this.db.run(
      `UPDATE payment_requests
       SET status = 'SUPERSEDED', updated_at = CURRENT_TIMESTAMP
       WHERE LOWER(customer_name) = LOWER(?) AND status = 'PENDING' AND order_code != ?`,
      [normalizedName, normalizedOrderCode],
      callback
    );
  }

  markPaymentPaid(orderCode, paymentData, callback) {
    const normalizedOrderCode = Number(orderCode);
    const dbConn = this.db;
    let finished = false;

    const done = (err) => {
      if (finished) return;
      finished = true;
      callback(err);
    };

    const rollback = (err) => {
      dbConn.run(`ROLLBACK`, () => done(err));
    };

    dbConn.serialize(() => {
      dbConn.run(`BEGIN IMMEDIATE TRANSACTION`, (beginErr) => {
        if (beginErr) {
          done(beginErr);
          return;
        }

        dbConn.get(
          `SELECT id, day_id, customer_name FROM payment_requests WHERE order_code = ?`,
          [normalizedOrderCode],
          (err, requestRow) => {
            if (err) {
              rollback(err);
              return;
            }

            if (!requestRow) {
              rollback(new Error('Khong tim thay yeu cau thanh toan tuong ung'));
              return;
            }

            dbConn.get(
              `SELECT COALESCE(SUM(o.quantity * d.price * (100 - COALESCE(o.discount_percent, 0)) / 100), 0) AS total_amount
               FROM orders o
               JOIN days d ON o.day_id = d.id
               WHERE LOWER(o.name) = LOWER(?)`,
              [requestRow.customer_name],
              (totalErr, totalRow) => {
                if (totalErr) {
                  rollback(totalErr);
                  return;
                }

                dbConn.get(
                  `SELECT COALESCE(SUM(amount), 0) AS paid_amount
                   FROM payment_transactions
                   WHERE status = 'PAID' AND LOWER(customer_name) = LOWER(?)`,
                  [requestRow.customer_name],
                  (paidErr, paidRow) => {
                    if (paidErr) {
                      rollback(paidErr);
                      return;
                    }

                    const totalAmount = Number(totalRow?.total_amount || 0);
                    const paidAmount = Number(paidRow?.paid_amount || 0);
                    const remainingDebt = Math.max(0, totalAmount - paidAmount);
                    const incomingAmount = Number(paymentData.amount || 0);
                    const appliedAmount = Math.max(0, Math.min(incomingAmount, remainingDebt));
                    const reference = paymentData.reference || paymentData.code || paymentData.paymentLinkId || '';
                    const transactionDate = paymentData.transactionDateTime || paymentData.transactionDate || '';
                    const rawPayload = JSON.stringify({
                      ...paymentData,
                      incomingAmount,
                      appliedAmount
                    });

                    const finishUpdate = () => {
                      dbConn.run(
                        `UPDATE payment_requests SET status = 'PAID', updated_at = CURRENT_TIMESTAMP WHERE order_code = ?`,
                        [normalizedOrderCode],
                        (updateErr) => {
                          if (updateErr) {
                            rollback(updateErr);
                            return;
                          }

                          dbConn.run(`COMMIT`, (commitErr) => {
                            if (commitErr) {
                              rollback(commitErr);
                              return;
                            }
                            done(null);
                          });
                        }
                      );
                    };

                    if (appliedAmount <= 0) {
                      finishUpdate();
                      return;
                    }

                    dbConn.run(
                      `INSERT OR IGNORE INTO payment_transactions
                        (day_id, customer_name, order_code, amount, status, reference, transaction_date, raw_payload)
                       VALUES (?, ?, ?, ?, 'PAID', ?, ?, ?)`,
                      [
                        requestRow.day_id,
                        requestRow.customer_name,
                        normalizedOrderCode,
                        appliedAmount,
                        reference,
                        transactionDate,
                        rawPayload
                      ],
                      (insertErr) => {
                        if (insertErr) {
                          rollback(insertErr);
                          return;
                        }

                        finishUpdate();
                      }
                    );
                  }
                );
              }
            );
          }
        );
      });
    });
  }


  getCustomerRemainingDebt(name, callback) {
    const normalizedName = String(name || '').trim();
    if (!normalizedName) {
      callback(new Error('Thiếu tên khách hàng'));
      return;
    }

    this.db.get(
      `SELECT COALESCE(SUM(o.quantity * d.price * (100 - COALESCE(o.discount_percent, 0)) / 100), 0) AS total_amount
       FROM orders o
       JOIN days d ON o.day_id = d.id
       WHERE LOWER(o.name) = LOWER(?)`,
      [normalizedName],
      (err, allRow) => {
        if (err) { callback(err); return; }

        this.db.get(
          `SELECT COALESCE(SUM(amount), 0) AS paid_amount
           FROM payment_transactions
           WHERE LOWER(customer_name) = LOWER(?) AND status = 'PAID'`,
          [normalizedName],
          (err2, paidRow) => {
            if (err2) { callback(err2); return; }

            const totalAmount = Number(allRow?.total_amount || 0);
            const paidAmount = Number(paidRow?.paid_amount || 0);
            callback(null, {
              name: normalizedName,
              totalAmount,
              paidAmount,
              remainingAmount: Math.max(0, totalAmount - paidAmount)
            });
          }
        );
      }
    );
  }

  markCustomerCashPaid(customerName, amount, callback) {
    const normalizedName = (customerName || '').trim().replace(/\s+/g, ' ');
    const requestedAmount = Number(amount || 0);
    const dbConn = this.db;
    let finished = false;

    if (!normalizedName) {
      callback(new Error('Ten khach hang khong hop le'));
      return;
    }

    if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
      callback(new Error('So tien thanh toan khong hop le'));
      return;
    }

    const done = (err) => {
      if (finished) return;
      finished = true;
      callback(err);
    };

    const rollback = (err) => {
      dbConn.run(`ROLLBACK`, () => done(err));
    };

    dbConn.serialize(() => {
      dbConn.run(`BEGIN IMMEDIATE TRANSACTION`, (beginErr) => {
        if (beginErr) {
          done(beginErr);
          return;
        }

        dbConn.get(
          `SELECT MAX(d.id) AS latest_day_id, MIN(o.name) AS db_name
           FROM orders o
           JOIN days d ON o.day_id = d.id
           WHERE LOWER(o.name) = LOWER(?)`,
          [normalizedName],
          (dayErr, dayRow) => {
            if (dayErr) {
              rollback(dayErr);
              return;
            }

            if (!dayRow || !dayRow.latest_day_id) {
              rollback(new Error('Khong tim thay don dat com cua khach nay'));
              return;
            }

            const finalName = (dayRow.db_name || normalizedName).trim();

            dbConn.get(
              `SELECT COALESCE(SUM(o.quantity * d.price * (100 - COALESCE(o.discount_percent, 0)) / 100), 0) AS total_amount
               FROM orders o
               JOIN days d ON o.day_id = d.id
               WHERE LOWER(o.name) = LOWER(?)`,
              [finalName],
              (totalErr, totalRow) => {
                if (totalErr) {
                  rollback(totalErr);
                  return;
                }

                dbConn.get(
                  `SELECT COALESCE(SUM(amount), 0) AS paid_amount
                   FROM payment_transactions
                   WHERE LOWER(customer_name) = LOWER(?) AND status = 'PAID'`,
                  [finalName],
                  (paidErr, paidRow) => {
                    if (paidErr) {
                      rollback(paidErr);
                      return;
                    }

                    const remainingAmount = Math.max(0, Number(totalRow?.total_amount || 0) - Number(paidRow?.paid_amount || 0));
                    if (remainingAmount <= 0) {
                      rollback(new Error('Khach nay khong con cong no de cap nhat'));
                      return;
                    }

                    if (requestedAmount > remainingAmount) {
                      rollback(new Error(`So tien vuot qua cong no con lai (${remainingAmount})`));
                      return;
                    }

                    const orderCode = Number(`${Date.now().toString().slice(-10)}${Math.floor(Math.random() * 90 + 10)}`);
                    const now = new Date().toISOString();
                    const payload = {
                      source: 'admin_cash_manual',
                      note: 'Manual cash payment from admin panel',
                      appliedAmount: requestedAmount
                    };

                    dbConn.run(
                      `INSERT INTO payment_requests
                        (day_id, customer_name, order_code, amount, payment_link_id, checkout_url, qr_code, status, created_at, updated_at)
                       VALUES (?, ?, ?, ?, NULL, NULL, NULL, 'PAID', ?, ?)`,
                      [Number(dayRow.latest_day_id), finalName, orderCode, requestedAmount, now, now],
                      (reqErr) => {
                        if (reqErr) {
                          rollback(reqErr);
                          return;
                        }

                        dbConn.run(
                          `INSERT INTO payment_transactions
                            (day_id, customer_name, order_code, amount, status, reference, transaction_date, raw_payload)
                           VALUES (?, ?, ?, ?, 'PAID', 'CASH-MANUAL', ?, ?)`,
                          [Number(dayRow.latest_day_id), finalName, orderCode, requestedAmount, now, JSON.stringify(payload)],
                          (txErr) => {
                            if (txErr) {
                              rollback(txErr);
                              return;
                            }

                            dbConn.run(`COMMIT`, (commitErr) => {
                              if (commitErr) {
                                rollback(commitErr);
                                return;
                              }
                              done(null);
                            });
                          }
                        );
                      }
                    );
                  }
                );
              }
            );
          }
        );
      });
    });
  }

  markPaymentPaidManual(orderCode, callback) {
    const normalizedOrderCode = Number(orderCode);
    if (!Number.isFinite(normalizedOrderCode) || normalizedOrderCode <= 0) {
      callback(new Error('Mã đơn thanh toán không hợp lệ'));
      return;
    }

    this.db.get(
      `SELECT id, amount, status FROM payment_requests WHERE order_code = ?`,
      [normalizedOrderCode],
      (requestErr, requestRow) => {
        if (requestErr) {
          callback(requestErr);
          return;
        }

        if (!requestRow) {
          callback(new Error('Không tìm thấy yêu cầu thanh toán tương ứng'));
          return;
        }

        const paymentData = {
          amount: Number(requestRow.amount || 0),
          reference: 'ADMIN-MANUAL',
          transactionDateTime: new Date().toISOString(),
          raw: {
            source: 'admin_manual',
            note: 'Manual status update from admin panel'
          }
        };

        this.markPaymentPaid(normalizedOrderCode, paymentData, callback);
      }
    );
  }


  getPendingPaymentRequests(limit, callback) {
    const normalizedLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
    this.db.all(
      `SELECT id, order_code, amount, customer_name, payment_link_id, created_at, updated_at
       FROM payment_requests
       WHERE status = 'PENDING'
       ORDER BY created_at ASC
       LIMIT ?`,
      [normalizedLimit],
      callback
    );
  }

  updatePaymentRequestStatus(orderCode, status, callback) {
    const normalizedOrderCode = Number(orderCode);
    const normalizedStatus = String(status || '').trim().toUpperCase();

    if (!normalizedOrderCode || !normalizedStatus) {
      callback(new Error('Dữ liệu cập nhật trạng thái thanh toán không hợp lệ'));
      return;
    }

    this.db.run(
      `UPDATE payment_requests
       SET status = ?, updated_at = CURRENT_TIMESTAMP
       WHERE order_code = ?`,
      [normalizedStatus, normalizedOrderCode],
      callback
    );
  }

  deletePaymentRecord(orderCode, callback) {
    const normalizedOrderCode = Number(orderCode);
    if (!Number.isFinite(normalizedOrderCode) || normalizedOrderCode <= 0) {
      callback(new Error('Mã đơn thanh toán không hợp lệ'));
      return;
    }

    this.db.run(
      `DELETE FROM payment_transactions WHERE order_code = ?`,
      [normalizedOrderCode],
      (err) => {
        if (err) { callback(err); return; }

        this.db.run(
          `DELETE FROM payment_requests WHERE order_code = ?`,
          [normalizedOrderCode],
          callback
        );
      }
    );
  }

  getCustomerFullOrderHistory(name, callback) {
    const normalizedName = String(name || '').trim();
    if (!normalizedName) {
      callback(new Error('Thiếu tên khách hàng'));
      return;
    }

    this.db.all(
      `SELECT d.date, SUM(o.quantity) AS quantity, SUM(o.quantity * d.price * (100 - COALESCE(o.discount_percent, 0)) / 100) AS day_amount, d.price
       FROM orders o JOIN days d ON d.id = o.day_id
       WHERE LOWER(o.name) = LOWER(?)
       GROUP BY d.date ORDER BY d.date ASC`,
      [normalizedName],
      (err, orderRows = []) => {
        if (err) { callback(err); return; }

        this.db.get(
          `SELECT COALESCE(SUM(amount), 0) AS total_paid
           FROM payment_transactions
           WHERE status = 'PAID' AND LOWER(customer_name) = LOWER(?)`,
          [normalizedName],
          (err2, payRow) => {
            if (err2) { callback(err2); return; }

            // Lấy chi tiết promo theo ngày
            this.db.all(
              `SELECT d.date, o.quantity, o.promo_code, COALESCE(o.discount_percent, 0) AS discount_percent, d.price
               FROM orders o JOIN days d ON d.id = o.day_id
               WHERE LOWER(o.name) = LOWER(?) AND o.promo_code IS NOT NULL AND o.promo_code != ''
               ORDER BY d.date ASC, o.created_at ASC`,
              [normalizedName],
              (err3, promoDetailRows = []) => {
                if (err3) { callback(err3); return; }

                const promoByDate = {};
                for (const d of promoDetailRows) {
                  if (!promoByDate[d.date]) promoByDate[d.date] = [];
                  const disc = Number(d.discount_percent || 0);
                  const unitPrice = Number(d.price || 0);
                  const finalPrice = Math.round(unitPrice * (100 - disc) / 100);
                  promoByDate[d.date].push({
                    promo_code: d.promo_code,
                    discount_percent: disc,
                    quantity: Number(d.quantity || 0),
                    unitPrice,
                    finalPrice
                  });
                }

                let pool = Number(payRow?.total_paid || 0);
                const result = orderRows.map((row) => {
                  const dayAmount = Number(row.day_amount || 0);
                  const applied = Math.min(pool, dayAmount);
                  pool -= applied;
                  const remaining = dayAmount - applied;
                  let paymentStatus;
                  if (remaining <= 0) paymentStatus = 'PAID';
                  else if (applied > 0) paymentStatus = 'PARTIAL';
                  else paymentStatus = 'UNPAID';
                  return {
                    date: row.date,
                    quantity: Number(row.quantity || 0),
                    unitPrice: Number(row.price || 0),
                    totalAmount: dayAmount,
                    paidAmount: applied,
                    remainingAmount: remaining,
                    paymentStatus,
                    promos: promoByDate[row.date] || []
                  };
                });

                result.reverse(); // newest first

                const totalOrders = result.reduce((sum, r) => sum + r.quantity, 0);
                const totalAmount = result.reduce((sum, r) => sum + r.totalAmount, 0);
                const totalPaidAmount = result.reduce((sum, r) => sum + r.paidAmount, 0);
                const totalRemaining = result.reduce((sum, r) => sum + r.remainingAmount, 0);

                callback(null, { rows: result, totalOrders, totalAmount, totalPaidAmount, totalRemaining });
              }
            );
          }
        );
      }
    );
  }

  getPaymentHistory(filters, callback) {
    let normalizedFilters = filters;
    if (typeof normalizedFilters === 'function') {
      callback = normalizedFilters;
      normalizedFilters = {};
    }

    if (typeof normalizedFilters === 'string') {
      normalizedFilters = { search: normalizedFilters };
    }

    const searchKeyword = (normalizedFilters && normalizedFilters.search) || '';
    const keyword = String(searchKeyword).trim().toLowerCase();
    const normalizedKeyword = keyword.replace(/['\s]+/g, '');
    const period = String((normalizedFilters && normalizedFilters.period) || 'all').toLowerCase();
    const status = String((normalizedFilters && normalizedFilters.status) || 'all').toUpperCase();
    const selectedDate = String((normalizedFilters && normalizedFilters.date) || '').trim();
    const selectedMonth = String((normalizedFilters && normalizedFilters.month) || '').trim();
    const fromDate = String((normalizedFilters && normalizedFilters.fromDate) || '').trim();
    const toDate = String((normalizedFilters && normalizedFilters.toDate) || '').trim();

    const whereClauses = ['1 = 1'];
    const params = [];

    if (normalizedKeyword) {
      whereClauses.push("LOWER(REPLACE(REPLACE(pr.customer_name, '''', ''), ' ', '')) LIKE ?");
      params.push(`%${normalizedKeyword}%`);
    }

    if (period === 'today') {
      whereClauses.push("d.date = DATE('now', 'localtime')");
    } else if (period === 'date' && selectedDate) {
      whereClauses.push('d.date = ?');
      params.push(selectedDate);
    } else if (period === 'month' && selectedMonth) {
      whereClauses.push('SUBSTR(d.date, 1, 7) = ?');
      params.push(selectedMonth);
    }

    if (fromDate) {
      whereClauses.push('d.date >= ?');
      params.push(fromDate);
    }

    if (toDate) {
      whereClauses.push('d.date <= ?');
      params.push(toDate);
    }

    if (status && status !== 'ALL') {
      whereClauses.push('UPPER(pr.status) = ?');
      params.push(status);
    }

    const query = `
      SELECT
        pr.customer_name,
        pr.order_code,
        pr.amount AS request_amount,
        pr.status AS request_status,
        pr.payment_link_id,
        pr.checkout_url,
        pr.created_at AS request_created_at,
        pr.updated_at AS request_updated_at,
        d.date,
        COALESCE(SUM(CASE WHEN t.status = 'PAID' THEN t.amount ELSE 0 END), 0) AS paid_amount,
        MAX(t.reference) AS latest_reference,
        MAX(COALESCE(t.transaction_date, t.created_at)) AS latest_paid_at
      FROM payment_requests pr
      JOIN days d ON pr.day_id = d.id
      LEFT JOIN payment_transactions t ON t.order_code = pr.order_code
      WHERE ${whereClauses.join(' AND ')}
      GROUP BY pr.id
      ORDER BY pr.created_at DESC
      LIMIT 500
    `;

    this.db.all(query, params, callback);
  }
  // =============================================
  // Promo Codes
  // =============================================
  createPromoCode(code, discountPercent, callback) {
    const normalizedCode = String(code || '').trim().toUpperCase();
    const disc = Number(discountPercent || 0);
    if (!normalizedCode || disc <= 0 || disc > 100) {
      callback(new Error('Mã hoặc phần trăm giảm giá không hợp lệ'));
      return;
    }
    this.db.run(
      `INSERT INTO promo_codes (code, discount_percent) VALUES (?, ?)`,
      [normalizedCode, disc],
      function(err) {
        if (err) {
          if (err.message && err.message.includes('UNIQUE')) {
            callback(new Error('Mã khuyến mãi đã tồn tại'));
          } else {
            callback(err);
          }
          return;
        }
        callback(null, { id: this.lastID, code: normalizedCode, discount_percent: disc });
      }
    );
  }

  createFeedback(message, callback) {
    const normalizedMessage = String(message || '').trim();
    if (!normalizedMessage) {
      callback(new Error('Nội dung góp ý không được để trống'));
      return;
    }

    this.db.run(
      `INSERT INTO feedback_submissions (message) VALUES (?)`,
      [normalizedMessage],
      function(err) {
        if (err) {
          callback(err);
          return;
        }

        callback(null, {
          id: this.lastID,
          message: normalizedMessage
        });
      }
    );
  }

  formatUtcDateTime(date = new Date()) {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const hours = String(date.getUTCHours()).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    const seconds = String(date.getUTCSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }

  createSession({ token, userId, role, expiresAt }, callback) {
    const normalizedToken = String(token || '').trim();
    const normalizedUserId = Number(userId || 0);
    const normalizedRole = String(role || '').trim() || 'user';
    const normalizedExpiresAt = expiresAt instanceof Date ? this.formatUtcDateTime(expiresAt) : String(expiresAt || '').trim();

    if (!normalizedToken || !normalizedUserId || !normalizedExpiresAt) {
      callback(new Error('Dữ liệu session không hợp lệ'));
      return;
    }

    this.db.run(
      `INSERT OR REPLACE INTO user_sessions (token, user_id, role, expires_at) VALUES (?, ?, ?, ?)`,
      [normalizedToken, normalizedUserId, normalizedRole, normalizedExpiresAt],
      callback
    );
  }

  getSessionByToken(token, callback) {
    const normalizedToken = String(token || '').trim();
    if (!normalizedToken) {
      callback(null, null);
      return;
    }

    this.db.get(
      `SELECT
         s.token,
         s.user_id,
         s.role AS session_role,
         s.expires_at,
         u.id,
         u.phone,
         u.name,
         u.role AS user_role
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > CURRENT_TIMESTAMP`,
      [normalizedToken],
      (err, row) => {
        if (err) {
          callback(err);
          return;
        }

        if (!row) {
          callback(null, null);
          return;
        }

        callback(null, {
          token: row.token,
          id: row.id,
          userId: row.user_id,
          phone: row.phone,
          name: row.name,
          role: row.user_role || row.session_role,
          expiresAt: row.expires_at
        });
      }
    );
  }

  deleteSession(token, callback) {
    const normalizedToken = String(token || '').trim();
    if (!normalizedToken) {
      callback(null);
      return;
    }

    this.db.run(`DELETE FROM user_sessions WHERE token = ?`, [normalizedToken], callback);
  }

  cleanupExpiredSessions(callback) {
    this.db.run(`DELETE FROM user_sessions WHERE expires_at <= CURRENT_TIMESTAMP`, callback);
  }

  getFeedbacks(searchKeyword, callback) {
    let keyword = '';
    let finalCallback = callback;

    if (typeof searchKeyword === 'function') {
      finalCallback = searchKeyword;
    } else {
      keyword = String(searchKeyword || '').trim().toLowerCase();
    }

    const sql = keyword
      ? `SELECT id, message, created_at
         FROM feedback_submissions
         WHERE LOWER(message) LIKE ?
         ORDER BY created_at DESC, id DESC`
      : `SELECT id, message, created_at
         FROM feedback_submissions
         ORDER BY created_at DESC, id DESC`;

    const params = keyword ? [`%${keyword}%`] : [];
    this.db.all(sql, params, finalCallback);
  }

  getPromoCodes(callback) {
    this.db.all(
      `SELECT id, code, discount_percent, created_at, used_by, used_at, order_id FROM promo_codes ORDER BY created_at DESC`,
      callback
    );
  }

  deletePromoCode(id, callback) {
    this.db.get(`SELECT used_by FROM promo_codes WHERE id = ?`, [id], (err, row) => {
      if (err) { callback(err); return; }
      if (!row) { callback(new Error('Mã không tồn tại')); return; }
      if (row.used_by) { callback(new Error('Không thể xóa mã đã được sử dụng')); return; }
      this.db.run(`DELETE FROM promo_codes WHERE id = ?`, [id], callback);
    });
  }

  validatePromoCode(code, callback) {
    const normalizedCode = String(code || '').trim().toUpperCase();
    if (!normalizedCode) { callback(null, null); return; }
    this.db.get(
      `SELECT id, code, discount_percent FROM promo_codes WHERE UPPER(code) = ? AND used_by IS NULL`,
      [normalizedCode],
      callback
    );
  }

  // =============================================
  // Users
  // =============================================
  seedAdminUser() {
    const crypto = require('crypto');
    const initialPassword = String(process.env.ADMIN_INITIAL_PASSWORD || '').trim();
    // Chỉ tạo nếu chưa có admin nào
    this.db.get(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`, (err, row) => {
      if (err || row) return; // Đã có admin hoặc lỗi
      if (!initialPassword) {
        console.warn('Chưa có admin trong DB và ADMIN_INITIAL_PASSWORD chưa được cấu hình. Bỏ qua seed admin mặc định.');
        return;
      }
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = crypto.scryptSync(initialPassword, salt, 64).toString('hex');
      this.db.run(
        `INSERT OR IGNORE INTO users (phone, name, password_hash, salt, role) VALUES (?, ?, ?, ?, ?)`,
        ['admin', 'Admin', hash, salt, 'admin']
      );
    });
  }

  createUser(phone, name, passwordHash, salt, role, callback) {
    this.db.run(
      `INSERT INTO users (phone, name, password_hash, salt, role) VALUES (?, ?, ?, ?, ?)`,
      [phone, name, passwordHash, salt, role || 'user'],
      function(err) {
        if (err) {
          if (err.message && err.message.includes('UNIQUE')) {
            callback(new Error('Số điện thoại đã được đăng ký'));
          } else {
            callback(err);
          }
          return;
        }
        callback(null, { id: this.lastID, phone, name, role: role || 'user' });
      }
    );
  }

  getUserByPhone(phone, callback) {
    this.db.get(
      `SELECT id, phone, name, password_hash, salt, role, created_at, COALESCE(session_version, 1) AS session_version FROM users WHERE phone = ?`,
      [phone],
      callback
    );
  }

  getUserById(id, callback) {
    this.db.get(
      `SELECT id, phone, name, password_hash, salt, role, created_at, COALESCE(session_version, 1) AS session_version FROM users WHERE id = ?`,
      [id],
      callback
    );
  }

  getUsers(callback) {
    this.db.all(
      `SELECT id, phone, name, role, created_at, COALESCE(session_version, 1) AS session_version FROM users ORDER BY created_at DESC`,
      callback
    );
  }

  deleteUser(id, callback) {
    this.db.get(`SELECT role FROM users WHERE id = ?`, [id], (err, row) => {
      if (err) { callback(err); return; }
      if (!row) { callback(new Error('Người dùng không tồn tại')); return; }
      // Không cho xóa admin duy nhất
      if (row.role === 'admin') {
        this.db.get(`SELECT COUNT(*) AS cnt FROM users WHERE role = 'admin'`, (err2, cntRow) => {
          if (err2) { callback(err2); return; }
          if ((cntRow?.cnt || 0) <= 1) {
            callback(new Error('Không thể xóa tài khoản admin duy nhất'));
            return;
          }
          this.db.run(`DELETE FROM users WHERE id = ?`, [id], callback);
        });
        return;
      }
      this.db.run(`DELETE FROM users WHERE id = ?`, [id], callback);
    });
  }

  updateUserPassword(id, passwordHash, salt, callback) {
    this.db.run(
      `UPDATE users SET password_hash = ?, salt = ?, session_version = COALESCE(session_version, 1) + 1 WHERE id = ?`,
      [passwordHash, salt, id],
      callback
    );
  }
  // =============================================
  // App Settings
  // =============================================
  seedDefaultSettings() {
    const defaults = [
      { key: 'debt_limit_enabled', value: '0', description: 'Bật/tắt giới hạn nợ khi đặt cơm' },
      { key: 'debt_limit_servings', value: '2', description: 'Số xuất nợ tối đa trước khi bị chặn' },
      { key: 'debt_limit_message', value: 'Bạn thông cảm nhé, mình cần xoay vốn nên vui lòng thanh toán để tiếp tục đặt cơm.', description: 'Thông báo khi vượt giới hạn nợ' },
      { key: 'consecutive_promo_enabled', value: '0', description: 'Bật/tắt tặng mã KM khi đặt liên tục' },
      { key: 'consecutive_promo_days', value: '5', description: 'Số ngày đặt liên tục để được tặng mã' },
      { key: 'consecutive_promo_discount', value: '50', description: 'Phần trăm giảm giá của mã tặng' }
    ];
    const stmt = this.db.prepare(`INSERT OR IGNORE INTO app_settings (key, value, description) VALUES (?, ?, ?)`);
    for (const d of defaults) {
      stmt.run([d.key, d.value, d.description]);
    }
    stmt.finalize();
  }

  getAllSettings(callback) {
    this.db.all(`SELECT key, value, description, updated_at FROM app_settings ORDER BY key`, callback);
  }

  getSetting(key, callback) {
    this.db.get(`SELECT value FROM app_settings WHERE key = ?`, [key], (err, row) => {
      callback(err, row ? row.value : null);
    });
  }

  getSettings(keys, callback) {
    const placeholders = keys.map(() => '?').join(', ');
    this.db.all(`SELECT key, value FROM app_settings WHERE key IN (${placeholders})`, keys, (err, rows = []) => {
      if (err) { callback(err); return; }
      const map = {};
      for (const r of rows) map[r.key] = r.value;
      callback(null, map);
    });
  }

  updateSetting(key, value, callback) {
    this.db.run(
      `UPDATE app_settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?`,
      [String(value), key],
      function(err) {
        if (err) { callback(err); return; }
        if (this.changes === 0) {
          callback(new Error('Không tìm thấy cài đặt: ' + key));
          return;
        }
        callback(null);
      }
    );
  }

  bulkUpdateSettings(settings, callback) {
    const stmt = this.db.prepare(`UPDATE app_settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?`);
    for (const [key, value] of Object.entries(settings)) {
      stmt.run([String(value), key]);
    }
    stmt.finalize(callback);
  }

  // Kiểm tra nợ xuất cơm của khách hàng (trả về số xuất chưa thanh toán)
  getCustomerUnpaidServings(name, callback) {
    const normalizedName = String(name || '').trim();
    this.db.get(
      `SELECT COALESCE(SUM(o.quantity), 0) AS total_servings,
              COALESCE(SUM(o.quantity * d.price * (100 - COALESCE(o.discount_percent, 0)) / 100), 0) AS total_amount
       FROM orders o JOIN days d ON d.id = o.day_id
       WHERE LOWER(o.name) = LOWER(?)`,
      [normalizedName],
      (err, orderRow) => {
        if (err) { callback(err); return; }
        this.db.get(
          `SELECT COALESCE(SUM(amount), 0) AS total_paid
           FROM payment_transactions
           WHERE status = 'PAID' AND LOWER(customer_name) = LOWER(?)`,
          [normalizedName],
          (err2, payRow) => {
            if (err2) { callback(err2); return; }
            const totalAmount = Number(orderRow?.total_amount || 0);
            const totalPaid = Number(payRow?.total_paid || 0);
            const remaining = Math.max(0, totalAmount - totalPaid);
            // Tính số xuất nợ = remaining / giá trung bình 1 xuất
            const totalServings = Number(orderRow?.total_servings || 0);
            const avgPrice = totalServings > 0 ? totalAmount / totalServings : 0;
            const unpaidServings = avgPrice > 0 ? Math.ceil(remaining / avgPrice) : 0;
            callback(null, { unpaidServings, remainingAmount: remaining });
          }
        );
      }
    );
  }

  // Đếm số ngày đặt liên tục gần nhất của khách hàng
  getConsecutiveOrderDays(name, callback) {
    const normalizedName = String(name || '').trim();
    this.db.all(
      `SELECT DISTINCT d.date FROM orders o JOIN days d ON d.id = o.day_id
       WHERE LOWER(o.name) = LOWER(?)
       ORDER BY d.date DESC`,
      [normalizedName],
      (err, rows = []) => {
        if (err) { callback(err); return; }
        if (!rows.length) { callback(null, 0); return; }

        let consecutive = 1;
        for (let i = 1; i < rows.length; i++) {
          const prev = new Date(rows[i - 1].date + 'T00:00:00Z');
          const curr = new Date(rows[i].date + 'T00:00:00Z');
          const diffDays = (prev - curr) / 86400000;
          if (diffDays === 1) {
            consecutive++;
          } else {
            break;
          }
        }
        callback(null, consecutive);
      }
    );
  }

  // Tạo mã KM tự động cho khách (consecutive promo)
  createAutoPromoCode(name, discountPercent, callback) {
    const code = 'AUTO' + Date.now().toString(36).toUpperCase();
    this.db.run(
      `INSERT INTO promo_codes (code, discount_percent) VALUES (?, ?)`,
      [code, discountPercent],
      function(err) {
        if (err) { callback(err); return; }
        callback(null, { id: this.lastID, code, discountPercent });
      }
    );
  }

  // Bảng xếp hạng theo tháng — đếm số ngày đặt cơm (không phải số xuất)
  getMonthlyLeaderboard(callback) {
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    // Đếm số ngày phân biệt (distinct) mà mỗi người đặt cơm trong tháng hiện tại
    const sql = `
      SELECT
        o.name,
        COUNT(DISTINCT d.date) AS days
      FROM orders o
      JOIN days d ON o.day_id = d.id
      WHERE strftime('%Y-%m', d.date) = ?
      GROUP BY LOWER(o.name)
      ORDER BY days DESC, MIN(o.name) ASC
    `;

    this.db.all(sql, [currentMonth], (err, rows = []) => {
      if (err) { callback(err); return; }

      // Tổng số ngày có phát sinh đơn hàng trong tháng (để tính %)
      this.db.get(
        `SELECT COUNT(DISTINCT d.date) AS total_days
         FROM days d
         JOIN orders o ON o.day_id = d.id
         WHERE strftime('%Y-%m', d.date) = ?`,
        [currentMonth],
        (err2, totalRow) => {
          if (err2) { callback(err2); return; }

          const totalDays = Number(totalRow?.total_days || 0);

          const leaders = rows.map((row, index) => ({
            rank: index + 1,
            name: row.name,
            days: Number(row.days || 0),
            percentage: totalDays > 0 ? Math.min(100, Math.round((row.days / totalDays) * 100)) : 0
          }));

          callback(null, { month: currentMonth, leaders });
        }
      );
    });
  }
}


module.exports = Database;
