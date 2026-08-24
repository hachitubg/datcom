const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

class Database {
  constructor(dbPath = path.join(__dirname, '../datcom.db'), options = {}) {
    this.dbPath = path.resolve(dbPath);
    this.seedAdminEnabled = options.seedAdmin !== false;
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    this.db = new sqlite3.Database(this.dbPath, (err) => {
      if (err) {
        console.error('Lỗi mở database:', err);
      } else {
        console.log(`Kết nối database thành công: ${this.dbPath}`);
      }
    });
    this.init();
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
          kitchen_status TEXT DEFAULT 'pending',
          kitchen_completed_at DATETIME,
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
          earned_quantity_servings INTEGER,
          earned_quantity_start_date TEXT,
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
      this.db.run("ALTER TABLE orders ADD COLUMN updated_at DATETIME", () => {});
      this.db.run("ALTER TABLE orders ADD COLUMN last_action TEXT DEFAULT 'created'", () => {});
      this.db.run("ALTER TABLE orders ADD COLUMN kitchen_status TEXT DEFAULT 'pending'", () => {});
      this.db.run("ALTER TABLE orders ADD COLUMN kitchen_completed_at DATETIME", () => {});
      this.db.run("ALTER TABLE promo_codes ADD COLUMN issued_to_user_id INTEGER", () => {});
      this.db.run("ALTER TABLE promo_codes ADD COLUMN issued_to_name TEXT", () => {});
      this.db.run("ALTER TABLE promo_codes ADD COLUMN source TEXT DEFAULT 'manual'", () => {});
      this.db.run("ALTER TABLE promo_codes ADD COLUMN earned_streak_days INTEGER", () => {});
      this.db.run("ALTER TABLE promo_codes ADD COLUMN earned_streak_date TEXT", () => {});
      this.db.run("ALTER TABLE promo_codes ADD COLUMN promo_seen_at DATETIME", () => {});
      this.db.run("ALTER TABLE promo_codes ADD COLUMN earned_quantity_servings INTEGER", () => {});
      this.db.run("ALTER TABLE promo_codes ADD COLUMN earned_quantity_start_date TEXT", () => {});
      this.db.run("ALTER TABLE users ADD COLUMN session_version INTEGER DEFAULT 1", () => {});

      this.db.run(`
        CREATE TABLE IF NOT EXISTS order_change_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          order_id INTEGER NOT NULL,
          day_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          quantity INTEGER NOT NULL,
          description TEXT,
          action TEXT NOT NULL,
          action_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          actor_type TEXT DEFAULT 'user',
          original_created_at DATETIME,
          kitchen_acknowledged_at DATETIME,
          FOREIGN KEY (day_id) REFERENCES days(id)
        )
      `);
      this.db.run("ALTER TABLE order_change_log ADD COLUMN kitchen_acknowledged_at DATETIME", () => {});

      // Lich nghi rieng cua tung site. Cac ngay nay khong lam gian doan chuoi dat com.
      this.db.run(`
        CREATE TABLE IF NOT EXISTS shop_closure_dates (
          closure_date TEXT PRIMARY KEY NOT NULL,
          reason TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      this.db.run(`
        CREATE TABLE IF NOT EXISTS game_scores (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          score INTEGER NOT NULL DEFAULT 0,
          level INTEGER NOT NULL DEFAULT 1,
          caught INTEGER NOT NULL DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id)
        )
      `);

      // Tạo record cho hôm nay nếu chưa có
      this.ensureTodayRecord();
      if (this.seedAdminEnabled) this.seedAdminUser();
      this.seedDefaultSettings();
      this.migrateConsecutivePromoData();
      this.migrateQuantityPromoData();
      this.migrateKitchenWorkflowData();
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

  getSearchKey(value) {
    return String(value || '')
      .trim()
      .replace(/\s+/g, ' ')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[đĐ]/g, 'd')
      .toLowerCase()
      .replace(/['\s]+/g, '');
  }

  parseMenuValue(value) {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    if (!trimmed || !['{', '['].includes(trimmed[0])) return value;
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  }

  matchesNameSearch(name, searchKeyword) {
    const keyword = this.getSearchKey(searchKeyword);
    if (!keyword) return true;
    return this.getSearchKey(name).includes(keyword);
  }

  getOrderAmountSql(orderAlias = 'o', dayAlias = 'd') {
    return `CASE
      WHEN COALESCE(${orderAlias}.discount_percent, 0) > 0 AND COALESCE(${orderAlias}.promo_code, '') != ''
        THEN ((MAX(${orderAlias}.quantity - 1, 0) * ${dayAlias}.price)
          + (${dayAlias}.price * (100 - COALESCE(${orderAlias}.discount_percent, 0)) / 100))
      ELSE ${orderAlias}.quantity * ${dayAlias}.price
    END`;
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
                  menu: this.parseMenuValue(row.menu),
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
              o.promo_code, o.user_id, COALESCE(o.last_action, 'created') AS change_action,
              CASE WHEN COALESCE(o.last_action, 'created') = 'edited'
                THEN COALESCE(o.updated_at, o.created_at) ELSE o.created_at END AS change_at,
              0 AS is_deleted,
              COALESCE(o.kitchen_status, 'pending') AS kitchen_status,
              o.kitchen_completed_at, NULL AS kitchen_acknowledged_at,
              NULL AS change_log_id, NULL AS actor_type,
              CASE
                WHEN COALESCE(o.last_action, 'created') = 'edited'
                  AND COALESCE(o.kitchen_status, 'pending') != 'done' THEN 1
                WHEN COALESCE(o.kitchen_status, 'pending') != 'done' THEN 2
                ELSE 4
              END AS sort_priority
       FROM orders o
       JOIN days d ON o.day_id = d.id
       WHERE d.date = ?
       UNION ALL
       SELECT -l.id AS id, l.name, l.quantity, l.description, l.original_created_at AS created_at,
              0 AS discount_percent, NULL AS promo_code, NULL AS user_id,
              'deleted' AS change_action, l.action_at AS change_at, 1 AS is_deleted,
              CASE WHEN l.kitchen_acknowledged_at IS NULL THEN 'cancel_pending' ELSE 'cancel_done' END AS kitchen_status,
              NULL AS kitchen_completed_at, l.kitchen_acknowledged_at,
              l.id AS change_log_id, l.actor_type,
              CASE WHEN l.kitchen_acknowledged_at IS NULL THEN 0 ELSE 3 END AS sort_priority
       FROM order_change_log l
       JOIN days d ON l.day_id = d.id
       WHERE d.date = ? AND l.action = 'deleted'
       ORDER BY sort_priority ASC, change_at DESC, id DESC`,
      [today, today],
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
                      `SELECT id, discount_percent, issued_to_user_id FROM promo_codes WHERE UPPER(code) = ? AND used_by IS NULL`,
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

                        const promoOwnerId = Number(promo.issued_to_user_id || 0);
                        if (promoOwnerId && promoOwnerId !== Number(finalUserId || 0)) {
                          rollback(new Error('Ma khuyen mai nay chi danh cho tai khoan duoc tang'));
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
            `SELECT id, name, quantity, description, created_at,
                    COALESCE(discount_percent, 0) AS discount_percent, promo_code,
                    COALESCE(last_action, 'created') AS change_action,
                    CASE WHEN COALESCE(last_action, 'created') = 'edited'
                      THEN COALESCE(updated_at, created_at) ELSE created_at END AS change_at,
                    0 AS is_deleted,
                    COALESCE(kitchen_status, 'pending') AS kitchen_status,
                    kitchen_completed_at, NULL AS kitchen_acknowledged_at,
                    NULL AS change_log_id, NULL AS actor_type,
                    CASE
                      WHEN COALESCE(last_action, 'created') = 'edited'
                        AND COALESCE(kitchen_status, 'pending') != 'done' THEN 1
                      WHEN COALESCE(kitchen_status, 'pending') != 'done' THEN 2
                      ELSE 4
                    END AS sort_priority
             FROM orders WHERE day_id = ?
             UNION ALL
             SELECT -id AS id, name, quantity, description, original_created_at AS created_at,
                    0 AS discount_percent, NULL AS promo_code, 'deleted' AS change_action,
                    action_at AS change_at, 1 AS is_deleted,
                    CASE WHEN kitchen_acknowledged_at IS NULL THEN 'cancel_pending' ELSE 'cancel_done' END AS kitchen_status,
                    NULL AS kitchen_completed_at, kitchen_acknowledged_at,
                    id AS change_log_id, actor_type,
                    CASE WHEN kitchen_acknowledged_at IS NULL THEN 0 ELSE 3 END AS sort_priority
             FROM order_change_log WHERE day_id = ? AND action = 'deleted'
             ORDER BY sort_priority ASC, change_at DESC, id DESC`,
            [dayRow.id, dayRow.id],
            (err, orders) => {
              if (err) {
                console.error('❌ Lỗi tìm đơn hàng:', err);
                callback(err);
              } else {
                const ordered = orders.reduce((sum, o) => sum + (o.is_deleted ? 0 : o.quantity), 0);
                console.log('📋 Tìm thấy', orders.length, 'đơn hàng');
                
                callback(null, {
                  day: {
                    id: dayRow.id,
                    date: dayRow.date,
                    menu: this.parseMenuValue(dayRow.menu),
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

  getCustomerOrderDetails(name, callback, resolved = false) {
    const normalizedName = String(name || '').trim();
    if (!normalizedName) {
      callback(new Error('Thiếu tên khách hàng'));
      return;
    }

    if (!resolved) {
      this.resolveCustomerName(normalizedName, (resolveErr, resolvedName) => {
        if (resolveErr) { callback(resolveErr); return; }
        this.getCustomerOrderDetails(resolvedName, callback, true);
      });
      return;
    }

    const orderAmountSql = this.getOrderAmountSql('o', 'd');

    // Lấy tất cả ngày đặt, sắp xếp cũ nhất trước để áp dụng FIFO
    this.db.all(
      `SELECT d.date, SUM(o.quantity) AS quantity, SUM(${orderAmountSql}) AS day_amount,
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
                    const quantity = Number(d.quantity || 0);
                    const discountQuantity = quantity > 0 ? 1 : 0;
                    promoByDate[d.date].push({
                      promo_code: d.promo_code,
                      discount_percent: disc,
                      quantity,
                      discount_quantity: discountQuantity,
                      full_price_quantity: Math.max(0, quantity - discountQuantity),
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
      `SELECT o.id, o.day_id, o.name, o.quantity, o.description, o.created_at, o.user_id,
              o.discount_percent, o.promo_code, d.date
       FROM orders o
       JOIN days d ON d.id = o.day_id
       WHERE o.id = ?`,
      [orderId],
      callback
    );
  }

  deleteOrder(orderId, actorType, callback) {
    if (typeof actorType === 'function') {
      callback = actorType;
      actorType = 'user';
    }

    const normalizedOrderId = Number(orderId);
    const dbConn = this.db;
    dbConn.serialize(() => {
      dbConn.run('BEGIN IMMEDIATE TRANSACTION', (beginErr) => {
        if (beginErr) { callback(beginErr); return; }
        dbConn.run(
          `INSERT INTO order_change_log
            (order_id, day_id, name, quantity, description, action, actor_type, original_created_at)
           SELECT id, day_id, name, quantity, description, 'deleted', ?, created_at
           FROM orders WHERE id = ?`,
          [String(actorType || 'user'), normalizedOrderId],
          function(logErr) {
            if (logErr || this.changes === 0) {
              dbConn.run('ROLLBACK', () => callback(logErr || new Error('Khong tim thay don hang')));
              return;
            }
            dbConn.run(
              `UPDATE promo_codes
               SET used_by = NULL, used_at = NULL, order_id = NULL
               WHERE order_id = ?`,
              [normalizedOrderId],
              (promoErr) => {
                if (promoErr) {
                  dbConn.run('ROLLBACK', () => callback(promoErr));
                  return;
                }
                dbConn.run(`DELETE FROM orders WHERE id = ?`, [normalizedOrderId], (deleteErr) => {
                  if (deleteErr) {
                    dbConn.run('ROLLBACK', () => callback(deleteErr));
                    return;
                  }
                  dbConn.run('COMMIT', callback);
                });
              }
            );
          }
        );
      });
    });
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
       SET name = ?, quantity = ?, description = ?,
           updated_at = CURRENT_TIMESTAMP, last_action = 'edited',
           kitchen_status = 'pending', kitchen_completed_at = NULL
       WHERE id = ?`,
      [normalizedName, normalizedQuantity, normalizedDescription, Number(orderId)],
      callback
    );
  }

  updateOrderKitchenStatus(orderId, status, callback) {
    const normalizedOrderId = Number(orderId || 0);
    const normalizedStatus = String(status || '').trim().toLowerCase();
    if (!normalizedOrderId || !['pending', 'done'].includes(normalizedStatus)) {
      callback(new Error('Trạng thái chế biến không hợp lệ'));
      return;
    }
    this.db.run(
      `UPDATE orders
       SET kitchen_status = ?,
           kitchen_completed_at = CASE WHEN ? = 'done' THEN CURRENT_TIMESTAMP ELSE NULL END
       WHERE id = ?`,
      [normalizedStatus, normalizedStatus, normalizedOrderId],
      function onKitchenStatusUpdated(err) {
        if (err) { callback(err); return; }
        if (!this.changes) {
          callback(new Error('Không tìm thấy đơn đặt cơm'));
          return;
        }
        callback(null, { success: true, status: normalizedStatus });
      }
    );
  }

  acknowledgeDeletedOrder(changeLogId, callback) {
    const normalizedLogId = Number(changeLogId || 0);
    if (!normalizedLogId) {
      callback(new Error('Mã thay đổi không hợp lệ'));
      return;
    }
    this.db.run(
      `UPDATE order_change_log
       SET kitchen_acknowledged_at = COALESCE(kitchen_acknowledged_at, CURRENT_TIMESTAMP)
       WHERE id = ? AND action = 'deleted'`,
      [normalizedLogId],
      function onDeletedOrderAcknowledged(err) {
        if (err) { callback(err); return; }
        if (!this.changes) {
          callback(new Error('Không tìm thấy yêu cầu hủy'));
          return;
        }
        callback(null, { success: true });
      }
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
        const exactKey = originalName.toLocaleLowerCase('vi');
        if (!uniqueMap.has(exactKey)) {
          uniqueMap.set(exactKey, originalName);
        }
      });

      const names = Array.from(uniqueMap.values()).sort((a, b) => a.localeCompare(b, 'vi'));
      callback(null, names);
    });
  }

  resolveCustomerName(name, callback) {
    const normalizedName = String(name || '').trim().replace(/\s+/g, ' ');
    const searchKey = this.getSearchKey(normalizedName);
    if (!searchKey) {
      callback(null, normalizedName);
      return;
    }

    this.getKnownCustomerNames((err, names = []) => {
      if (err) {
        callback(err);
        return;
      }

      const exactKey = normalizedName.toLocaleLowerCase('vi');
      const exactMatch = names.find((candidate) => candidate.toLocaleLowerCase('vi') === exactKey);
      if (exactMatch) {
        callback(null, exactMatch);
        return;
      }

      const normalizedMatches = names.filter((candidate) => this.getSearchKey(candidate) === searchKey);
      callback(null, normalizedMatches.length === 1 ? normalizedMatches[0] : normalizedName);
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
    const normalizedKeyword = this.getSearchKey(searchKeyword);
    const orderAmountSql = this.getOrderAmountSql('o', 'd');

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
          SUM(${orderAmountSql}) AS day_amount,
          SUM(SUM(${orderAmountSql})) OVER (
            PARTITION BY LOWER(o.name)
            ORDER BY d.date ASC
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
          )                                AS running_total,
          MAX(o.created_at)                AS last_order_time
        FROM orders o
        JOIN days d ON o.day_id = d.id
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
        SUM(
          CASE
            WHEN rem > 0 AND day_amount > 0
              THEN CAST(((rem * quantity) + day_amount - 1) / day_amount AS INTEGER)
            ELSE 0
          END
        )                                                          AS quantity,
        SUM(rem)                                                   AS total_amount,
        SUM(rem)                                                   AS remaining_amount,
        MAX(last_order_time)                                       AS last_order_time
      FROM day_rem
      GROUP BY norm_name
      HAVING SUM(rem) > 0
      ORDER BY SUM(rem) DESC, MIN(display_name) COLLATE NOCASE ASC
    `;

    this.db.all(sql, [], (err, rows = []) => {
      if (err) {
        callback(err);
        return;
      }

      const filteredRows = normalizedKeyword
        ? rows.filter((row) => this.matchesNameSearch(row.name, searchKeyword))
        : rows;

      const summary = filteredRows.map((row) => {
        const totalAmount = row.total_amount || 0;
        const remainingAmount = row.remaining_amount || 0;
        return {
          name: row.name,
          quantity: row.quantity,
          unitPrice: row.quantity > 0 ? Math.round(totalAmount / row.quantity) : 0,
          totalAmount,
          paidAmount: 0,
          remainingAmount: Math.max(0, remainingAmount),
          status: remainingAmount <= 0 ? 'PAID' : 'UNPAID',
          lastOrderTime: row.last_order_time,
          latestPendingOrderCode: 0
        };
      });

      callback(null, summary);
    });
  }


  getTodayCustomerOrderDetails(name, callback, resolved = false) {
    const normalizedName = String(name || '').trim();
    if (!normalizedName) {
      callback(new Error('Thiếu tên khách hàng'));
      return;
    }

    if (!resolved) {
      this.resolveCustomerName(normalizedName, (resolveErr, resolvedName) => {
        if (resolveErr) { callback(resolveErr); return; }
        this.getTodayCustomerOrderDetails(resolvedName, callback, true);
      });
      return;
    }

    const orderAmountSql = this.getOrderAmountSql('o', 'd');

    // Lấy từng đơn theo thứ tự cũ nhất trước để tính chính xác phần còn nợ.
    this.db.all(
      `SELECT o.id, o.quantity, o.description, o.created_at, d.price, d.date,
              ${orderAmountSql} AS order_amount,
              COALESCE(o.discount_percent, 0) AS discount_percent, o.promo_code
       FROM orders o
       JOIN days d ON d.id = o.day_id
       WHERE LOWER(o.name) = LOWER(?)
       ORDER BY d.date ASC, o.created_at ASC, o.id ASC`,
      [normalizedName],
      (err, orderRows = []) => {
        if (err) { callback(err); return; }

        // Tổng tiền đã thanh toán toàn bộ lịch sử, sau đó áp dụng FIFO vào từng đơn.
        this.db.get(
          `SELECT COALESCE(SUM(amount), 0) AS total_paid
           FROM payment_transactions
           WHERE status = 'PAID' AND LOWER(customer_name) = LOWER(?)`,
          [normalizedName],
          (err2, payRow) => {
            if (err2) { callback(err2); return; }

            let pool = Number(payRow?.total_paid || 0);
            const mappedRows = [];

            for (const row of orderRows) {
              const orderAmount = Math.round(Number(row.order_amount || 0));
              const originalQuantity = Number(row.quantity || 0);
              const applied = Math.min(pool, orderAmount);
              pool -= applied;
              const remainingAmount = Math.max(0, orderAmount - applied);

              if (remainingAmount <= 0) {
                continue;
              }

              const unitAmount = originalQuantity > 0 ? orderAmount / originalQuantity : orderAmount;
              const remainingQuantity = unitAmount > 0
                ? Math.max(1, Math.min(originalQuantity, Math.ceil(remainingAmount / unitAmount)))
                : originalQuantity;
              const disc = Number(row.discount_percent || 0);

              mappedRows.push({
                id: Number(row.id),
                quantity: remainingQuantity,
                originalQuantity,
                description: row.description || '',
                createdAt: row.created_at || '',
                date: row.date || '',
                amount: remainingAmount,
                originalAmount: orderAmount,
                paidAmount: Math.max(0, orderAmount - remainingAmount),
                discount_percent: disc,
                promo_code: row.promo_code || null
              });
            }

            const totalQuantity = mappedRows.reduce((sum, r) => sum + r.quantity, 0);
            const totalRemaining = mappedRows.reduce((sum, r) => sum + r.amount, 0);

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

  getTodayCustomerPayment(name, callback, resolved = false) {
    if (!resolved) {
      this.resolveCustomerName(name, (resolveErr, resolvedName) => {
        if (resolveErr) { callback(resolveErr); return; }
        this.getTodayCustomerPayment(resolvedName, callback, true);
      });
      return;
    }

    const orderAmountSql = this.getOrderAmountSql('o', 'd');

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
          `SELECT SUM(o.quantity) AS quantity, SUM(${orderAmountSql}) AS total_amount
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
    const incomingAmount = Number(paymentData.amount || 0);
    const dbConn = this.db;
    const orderAmountSql = this.getOrderAmountSql('o', 'd');
    let finished = false;

    if (!Number.isFinite(normalizedOrderCode) || normalizedOrderCode <= 0
      || !Number.isFinite(incomingAmount) || incomingAmount <= 0) {
      callback(new Error('Dữ liệu thanh toán không hợp lệ'));
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
              `SELECT COALESCE(SUM(${orderAmountSql}), 0) AS total_amount
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
                    const reference = paymentData.reference || paymentData.code || paymentData.paymentLinkId || '';
                    const transactionDate = paymentData.transactionDateTime || paymentData.transactionDate || '';
                    const rawPayload = JSON.stringify({
                      ...paymentData,
                      incomingAmount,
                      appliedAmount: incomingAmount,
                      remainingDebtBeforePayment: remainingDebt
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

                    dbConn.run(
                      `INSERT INTO payment_transactions
                        (day_id, customer_name, order_code, amount, status, reference, transaction_date, raw_payload)
                       VALUES (?, ?, ?, ?, 'PAID', ?, ?, ?)
                       ON CONFLICT(order_code, status) DO UPDATE SET
                         amount = MAX(payment_transactions.amount, excluded.amount),
                         reference = CASE WHEN excluded.reference != '' THEN excluded.reference ELSE payment_transactions.reference END,
                         transaction_date = CASE WHEN excluded.transaction_date != '' THEN excluded.transaction_date ELSE payment_transactions.transaction_date END,
                         raw_payload = excluded.raw_payload`,
                      [
                        requestRow.day_id,
                        requestRow.customer_name,
                        normalizedOrderCode,
                        incomingAmount,
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


  getCustomerRemainingDebt(name, callback, resolved = false) {
    const normalizedName = String(name || '').trim();
    if (!normalizedName) {
      callback(new Error('Thiếu tên khách hàng'));
      return;
    }

    if (!resolved) {
      this.resolveCustomerName(normalizedName, (resolveErr, resolvedName) => {
        if (resolveErr) { callback(resolveErr); return; }
        this.getCustomerRemainingDebt(resolvedName, callback, true);
      });
      return;
    }

    const orderAmountSql = this.getOrderAmountSql('o', 'd');

    this.db.get(
      `SELECT COALESCE(SUM(${orderAmountSql}), 0) AS total_amount
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

  markCustomerCashPaid(customerName, amount, callback, resolved = false) {
    const normalizedName = (customerName || '').trim().replace(/\s+/g, ' ');
    const requestedAmount = Number(amount || 0);
    const dbConn = this.db;
    const orderAmountSql = this.getOrderAmountSql('o', 'd');
    let finished = false;

    if (!normalizedName) {
      callback(new Error('Ten khach hang khong hop le'));
      return;
    }

    if (!resolved) {
      this.resolveCustomerName(normalizedName, (resolveErr, resolvedName) => {
        if (resolveErr) { callback(resolveErr); return; }
        this.markCustomerCashPaid(resolvedName, amount, callback, true);
      });
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
              `SELECT COALESCE(SUM(${orderAmountSql}), 0) AS total_amount
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


  getSyncablePaymentRequests(limit, callback) {
    const normalizedLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
    this.db.all(
      `SELECT id, order_code, amount, customer_name, payment_link_id, status, created_at, updated_at
       FROM payment_requests
       WHERE status IN ('PENDING', 'SUPERSEDED')
       ORDER BY CASE status WHEN 'PENDING' THEN 0 ELSE 1 END, created_at ASC
       LIMIT ?`,
      [normalizedLimit],
      callback
    );
  }

  getPendingPaymentRequests(limit, callback) {
    this.getSyncablePaymentRequests(limit, callback);
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

  getCustomerFullOrderHistory(name, callback, resolved = false) {
    const normalizedName = String(name || '').trim();
    if (!normalizedName) {
      callback(new Error('Thiếu tên khách hàng'));
      return;
    }

    if (!resolved) {
      this.resolveCustomerName(normalizedName, (resolveErr, resolvedName) => {
        if (resolveErr) { callback(resolveErr); return; }
        this.getCustomerFullOrderHistory(resolvedName, callback, true);
      });
      return;
    }

    const orderAmountSql = this.getOrderAmountSql('o', 'd');

    this.db.all(
      `SELECT d.date, SUM(o.quantity) AS quantity, SUM(${orderAmountSql}) AS day_amount, d.price
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
                  const quantity = Number(d.quantity || 0);
                  const discountQuantity = quantity > 0 ? 1 : 0;
                  promoByDate[d.date].push({
                    promo_code: d.promo_code,
                    discount_percent: disc,
                    quantity,
                    discount_quantity: discountQuantity,
                    full_price_quantity: Math.max(0, quantity - discountQuantity),
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
    const normalizedKeyword = this.getSearchKey(searchKeyword);
    const period = String((normalizedFilters && normalizedFilters.period) || 'all').toLowerCase();
    const status = String((normalizedFilters && normalizedFilters.status) || 'all').toUpperCase();
    const selectedDate = String((normalizedFilters && normalizedFilters.date) || '').trim();
    const selectedMonth = String((normalizedFilters && normalizedFilters.month) || '').trim();
    const fromDate = String((normalizedFilters && normalizedFilters.fromDate) || '').trim();
    const toDate = String((normalizedFilters && normalizedFilters.toDate) || '').trim();

    const whereClauses = ['1 = 1'];
    const params = [];

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

    this.db.all(query, params, (err, rows = []) => {
      if (err) {
        callback(err);
        return;
      }

      const filteredRows = normalizedKeyword
        ? rows.filter((row) => this.matchesNameSearch(row.customer_name, searchKeyword))
        : rows;
      callback(null, filteredRows);
    });
  }
  // =============================================
  // Promo Codes
  // =============================================
  createPromoCode(code, discountPercent, options, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }

    const normalizedOptions = options || {};
    const normalizedCode = String(code || '').trim().toUpperCase();
    const disc = Number(discountPercent || 0);
    const issuedToUserId = Number(normalizedOptions.issuedToUserId || 0) || null;
    const issuedToName = String(normalizedOptions.issuedToName || '').trim();
    const source = issuedToUserId ? 'admin_gift' : 'manual';
    if (!normalizedCode || disc <= 0 || disc > 100) {
      callback(new Error('Mã hoặc phần trăm giảm giá không hợp lệ'));
      return;
    }
    this.db.run(
      `INSERT INTO promo_codes
        (code, discount_percent, issued_to_user_id, issued_to_name, source, promo_seen_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [normalizedCode, disc, issuedToUserId, issuedToName || null, source, issuedToUserId ? null : this.formatUtcDateTime()],
      function(err) {
        if (err) {
          if (err.message && err.message.includes('UNIQUE')) {
            callback(new Error('Mã khuyến mãi đã tồn tại'));
          } else {
            callback(err);
          }
          return;
        }
        callback(null, {
          id: this.lastID,
          code: normalizedCode,
          discount_percent: disc,
          issued_to_user_id: issuedToUserId,
          issued_to_name: issuedToName || null,
          source
        });
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
      `SELECT id, code, discount_percent, created_at, used_by, used_at, order_id,
              issued_to_user_id, issued_to_name, source, earned_streak_days,
              earned_streak_date, earned_quantity_servings, earned_quantity_start_date,
              promo_seen_at
       FROM promo_codes
       ORDER BY created_at DESC`,
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
      `SELECT id, code, discount_percent, issued_to_user_id, source FROM promo_codes WHERE UPPER(code) = ? AND used_by IS NULL`,
      [normalizedCode],
      callback
    );
  }

  getPromoWalletForUser(userId, callback) {
    const normalizedUserId = Number(userId || 0);
    if (!normalizedUserId) {
      callback(null, []);
      return;
    }

    this.db.all(
      `SELECT id, code, discount_percent, created_at, used_by, used_at, order_id,
              issued_to_user_id, issued_to_name, source, earned_streak_days,
              earned_streak_date, earned_quantity_servings, earned_quantity_start_date,
              promo_seen_at
       FROM promo_codes
       WHERE issued_to_user_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 50`,
      [normalizedUserId],
      callback
    );
  }

  markPromoWalletSeen(userId, callback) {
    const normalizedUserId = Number(userId || 0);
    if (!normalizedUserId) {
      callback(null);
      return;
    }

    this.db.run(
      `UPDATE promo_codes
       SET promo_seen_at = CURRENT_TIMESTAMP
       WHERE issued_to_user_id = ? AND promo_seen_at IS NULL`,
      [normalizedUserId],
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
    this.findRegisteredUserByName(name, (nameErr, existingUser) => {
      if (nameErr) { callback(nameErr); return; }
      if (existingUser) {
        callback(new Error('Tên người dùng đã được đăng ký. Vui lòng sử dụng tên khác.'));
        return;
      }

      this.db.run(
        `INSERT INTO users (phone, name, password_hash, salt, role) VALUES (?, ?, ?, ?, ?)`,
        [phone, name, passwordHash, salt, role || 'user'],
        function onCreateUser(err) {
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
    });
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

  removeSiteAdminUsers(callback) {
    this.db.all(`SELECT id FROM users WHERE role = 'admin'`, (selectErr, rows = []) => {
      if (selectErr) { callback(selectErr); return; }
      const adminIds = rows.map((row) => Number(row.id)).filter(Boolean);
      if (!adminIds.length) {
        callback(null, { removed: 0 });
        return;
      }

      const placeholders = adminIds.map(() => '?').join(',');
      this.db.serialize(() => {
        this.db.run(`DELETE FROM user_sessions WHERE user_id IN (${placeholders})`, adminIds, (sessionErr) => {
          if (sessionErr) { callback(sessionErr); return; }
          this.db.run(
            `DELETE FROM users WHERE id IN (${placeholders}) AND role = 'admin'`,
            adminIds,
            function onDelete(err) {
              callback(err, { removed: this?.changes || 0 });
            }
          );
        });
      });
    });
  }

  getUsersPage(page, limit, callback) {
    const normalizedLimit = Math.max(1, Math.min(50, Math.floor(Number(limit) || 10)));
    const requestedPage = Math.max(1, Math.floor(Number(page) || 1));
    this.db.get('SELECT COUNT(*) AS total FROM users', (countErr, countRow) => {
      if (countErr) { callback(countErr); return; }
      const total = Number(countRow?.total || 0);
      const totalPages = Math.max(1, Math.ceil(total / normalizedLimit));
      const normalizedPage = Math.min(requestedPage, totalPages);
      this.db.all(
        `SELECT id, phone, name, role, created_at, COALESCE(session_version, 1) AS session_version
         FROM users ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
        [normalizedLimit, (normalizedPage - 1) * normalizedLimit],
        (err, rows = []) => callback(err, {
          rows,
          page: normalizedPage,
          limit: normalizedLimit,
          total,
          totalPages
        })
      );
    });
  }

  findRegisteredUserByName(name, excludeUserId, callback) {
    if (typeof excludeUserId === 'function') {
      callback = excludeUserId;
      excludeUserId = 0;
    }
    const searchKey = this.getSearchKey(name);
    if (!searchKey) {
      callback(null, null);
      return;
    }
    this.db.all(
      'SELECT id, phone, name, role FROM users WHERE id != ?',
      [Number(excludeUserId || 0)],
      (err, rows = []) => {
        if (err) { callback(err); return; }
        callback(null, rows.find((user) => this.getSearchKey(user.name) === searchKey) || null);
      }
    );
  }

  updateUserName(id, newName, callback) {
    const userId = Number(id);
    const normalizedNewName = String(newName || '').trim().replace(/\s+/g, ' ');
    if (!Number.isInteger(userId) || userId <= 0 || !normalizedNewName) {
      callback(new Error('Tên người dùng không hợp lệ'));
      return;
    }

    this.findRegisteredUserByName(normalizedNewName, userId, (nameErr, existingUser) => {
      if (nameErr) { callback(nameErr); return; }
      if (existingUser) {
        callback(new Error('Tên người dùng đã được đăng ký. Vui lòng sử dụng tên khác.'));
        return;
      }

      this.getUserById(userId, (userErr, user) => {
      if (userErr) {
        callback(userErr);
        return;
      }
      if (!user) {
        callback(new Error('Người dùng không tồn tại'));
        return;
      }

      const oldName = String(user.name || '').trim().replace(/\s+/g, ' ');
      const dbConn = this.db;

      dbConn.serialize(() => {
        dbConn.run('BEGIN IMMEDIATE TRANSACTION');
        dbConn.run(
          `UPDATE users SET name = ? WHERE id = ?`,
          [normalizedNewName, userId],
          function onUserUpdated(updateUserErr) {
            if (updateUserErr) {
              dbConn.run('ROLLBACK', () => callback(updateUserErr));
              return;
            }

            dbConn.run(
              `UPDATE orders SET name = ? WHERE user_id = ? OR name = ?`,
              [normalizedNewName, userId, oldName],
              function onOrdersUpdated(ordersErr) {
                if (ordersErr) {
                  dbConn.run('ROLLBACK', () => callback(ordersErr));
                  return;
                }
                const updatedOrders = this.changes || 0;

                dbConn.run(
                  `UPDATE payment_requests SET customer_name = ? WHERE customer_name = ?`,
                  [normalizedNewName, oldName],
                  function onPaymentRequestsUpdated(paymentRequestsErr) {
                    if (paymentRequestsErr) {
                      dbConn.run('ROLLBACK', () => callback(paymentRequestsErr));
                      return;
                    }
                    const updatedPaymentRequests = this.changes || 0;

                    dbConn.run(
                      `UPDATE payment_transactions SET customer_name = ? WHERE customer_name = ?`,
                      [normalizedNewName, oldName],
                      function onPaymentTransactionsUpdated(paymentTransactionsErr) {
                        if (paymentTransactionsErr) {
                          dbConn.run('ROLLBACK', () => callback(paymentTransactionsErr));
                          return;
                        }
                        const updatedPaymentTransactions = this.changes || 0;

                        dbConn.run(
                          `UPDATE promo_codes
                           SET issued_to_name = CASE WHEN issued_to_user_id = ? THEN ? ELSE issued_to_name END,
                               used_by = CASE WHEN used_by = ? THEN ? ELSE used_by END
                           WHERE issued_to_user_id = ? OR used_by = ?`,
                          [userId, normalizedNewName, oldName, normalizedNewName, userId, oldName],
                          function onPromoCodesUpdated(promoCodesErr) {
                            if (promoCodesErr) {
                              dbConn.run('ROLLBACK', () => callback(promoCodesErr));
                              return;
                            }
                            const updatedPromoCodes = this.changes || 0;

                            dbConn.run('COMMIT', (commitErr) => {
                              if (commitErr) {
                                callback(commitErr);
                                return;
                              }
                              callback(null, {
                                user: {
                                  id: user.id,
                                  phone: user.phone,
                                  name: normalizedNewName,
                                  role: user.role
                                },
                                updatedOrders,
                                updatedPaymentRequests,
                                updatedPaymentTransactions,
                                updatedPromoCodes
                              });
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
    });
  }
  // =============================================
  // App Settings
  // =============================================
  getShopClosureDates(page, limit, callback) {
    const parsedLimit = Number(limit);
    const parsedPage = Number(page);
    const normalizedLimit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(50, Math.floor(parsedLimit))) : 10;
    const requestedPage = Number.isFinite(parsedPage) ? Math.max(1, Math.floor(parsedPage)) : 1;
    this.db.get('SELECT COUNT(*) AS total FROM shop_closure_dates', (countErr, countRow) => {
      if (countErr) { callback(countErr); return; }
      const total = Number(countRow?.total || 0);
      const totalPages = Math.max(1, Math.ceil(total / normalizedLimit));
      const normalizedPage = Math.min(requestedPage, totalPages);
      const offset = (normalizedPage - 1) * normalizedLimit;
      this.db.all(
        `SELECT closure_date, reason, created_at
         FROM shop_closure_dates
         ORDER BY closure_date DESC
         LIMIT ? OFFSET ?`,
        [normalizedLimit, offset],
        (err, rows = []) => callback(err, {
          rows,
          page: normalizedPage,
          limit: normalizedLimit,
          total,
          totalPages
        })
      );
    });
  }

  getShopClosureByDate(date, callback) {
    this.db.get(
      `SELECT closure_date, reason, created_at
       FROM shop_closure_dates
       WHERE closure_date = ?`,
      [String(date || '').trim()],
      callback
    );
  }

  upsertShopClosureRange(startDate, endDate, reason, callback) {
    const dates = this.getDateRange(startDate, endDate);
    if (!dates.length) {
      callback(new Error('Khoang ngay nghi khong hop le'));
      return;
    }

    this.db.serialize(() => {
      this.db.run('BEGIN IMMEDIATE TRANSACTION');
      let firstError = null;
      const stmt = this.db.prepare(
        `INSERT INTO shop_closure_dates (closure_date, reason)
         VALUES (?, ?)
         ON CONFLICT(closure_date) DO UPDATE SET reason = excluded.reason`
      );
      for (const date of dates) {
        stmt.run(date, reason, (err) => {
          if (err && !firstError) firstError = err;
        });
      }
      stmt.finalize((err) => {
        const writeError = firstError || err;
        if (writeError) {
          this.db.run('ROLLBACK', () => callback(writeError));
          return;
        }
        this.db.run('COMMIT', (commitErr) => callback(commitErr, { count: dates.length }));
      });
    });
  }

  deleteShopClosureDate(date, callback) {
    this.db.run(
      'DELETE FROM shop_closure_dates WHERE closure_date = ?',
      [String(date || '').trim()],
      function onDelete(err) {
        callback(err, { deleted: this?.changes || 0 });
      }
    );
  }

  getClosureDateSet(callback) {
    this.db.all('SELECT closure_date FROM shop_closure_dates', (err, rows = []) => {
      if (err) { callback(err); return; }
      callback(null, new Set(rows.map((row) => row.closure_date)));
    });
  }

  getDateRange(startDate, endDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return [];
    const start = new Date(`${startDate}T00:00:00Z`);
    const end = new Date(`${endDate}T00:00:00Z`);
    if (Number.isNaN(start.getTime())
      || Number.isNaN(end.getTime())
      || this.getUtcDateString(start) !== startDate
      || this.getUtcDateString(end) !== endDate
      || start > end) return [];

    const dates = [];
    for (const cursor = new Date(start); cursor <= end && dates.length <= 366; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
      dates.push(this.getUtcDateString(cursor));
    }
    return dates.length <= 366 ? dates : [];
  }

  seedDefaultSettings() {
    const defaults = [
      { key: 'debt_limit_enabled', value: '0', description: 'Bật/tắt giới hạn nợ khi đặt cơm' },
      { key: 'debt_limit_servings', value: '2', description: 'Số suất nợ tối đa trước khi bị chặn' },
      { key: 'debt_limit_message', value: 'Bạn thông cảm nhé, mình cần xoay vốn nên vui lòng thanh toán để tiếp tục đặt cơm.', description: 'Thông báo khi vượt giới hạn nợ' },
      { key: 'consecutive_promo_enabled', value: '0', description: 'Bật/tắt tặng mã KM khi đặt liên tục' },
      { key: 'consecutive_promo_days', value: '5', description: 'Số ngày đặt liên tục để được tặng mã' },
      { key: 'consecutive_promo_discount', value: '50', description: 'Phần trăm giảm giá của mã tặng' },
      { key: 'quantity_promo_enabled', value: '0', description: 'Bật/tắt tặng mã theo tổng số suất' },
      { key: 'quantity_promo_servings', value: '10', description: 'Số suất tích lũy cho mỗi mã tặng' },
      { key: 'quantity_promo_discount', value: '50', description: 'Phần trăm giảm giá của mã tích suất' },
      { key: 'quantity_promo_start_date', value: '', description: 'Ngày bắt đầu tính chương trình tích suất' },
      { key: 'quantity_promo_last_batch_date', value: '', description: 'Ngày batch tích suất chạy gần nhất' },
      { key: 'order_cutoff_time', value: '10:45', description: 'Giờ chốt đặt cơm hằng ngày (HH:mm)' },
      { key: 'shop_closed_enabled', value: '0', description: 'Tạm đóng cửa website trong ngày' },
      { key: 'shop_closed_reason', value: 'Hôm nay quán tạm đóng cửa, hẹn mọi người vào ngày mai nhé.', description: 'Lý do hiển thị khi tạm đóng cửa' }
    ];
    defaults.push({
      key: 'consecutive_promo_last_batch_date',
      value: '',
      description: 'Ngay batch chuoi dat com chay thanh cong gan nhat'
    });
    defaults.push({
      key: 'consecutive_promo_data_migration_v2',
      value: '0',
      description: 'Danh dau migration ma chuoi theo tung chu ky'
    });
    const stmt = this.db.prepare(`INSERT OR IGNORE INTO app_settings (key, value, description) VALUES (?, ?, ?)`);
    for (const d of defaults) {
      stmt.run([d.key, d.value, d.description]);
    }
    stmt.finalize();
  }

  migrateConsecutivePromoData() {
    this.db.exec(
      `BEGIN IMMEDIATE TRANSACTION;

       UPDATE promo_codes
       SET earned_streak_date = SUBSTR(created_at, 1, 10),
           promo_seen_at = COALESCE(promo_seen_at, created_at)
       WHERE source = 'auto_consecutive'
         AND COALESCE((
           SELECT value FROM app_settings
           WHERE key = 'consecutive_promo_data_migration_v2'
         ), '0') != '1';

       UPDATE app_settings
       SET value = '1', updated_at = CURRENT_TIMESTAMP
       WHERE key = 'consecutive_promo_data_migration_v2' AND value != '1';

       COMMIT;

       CREATE UNIQUE INDEX IF NOT EXISTS idx_promo_consecutive_cycle
       ON promo_codes (issued_to_user_id, earned_streak_days, earned_streak_date)
       WHERE source = 'auto_consecutive'
         AND issued_to_user_id IS NOT NULL
         AND earned_streak_days IS NOT NULL
         AND earned_streak_date IS NOT NULL;`,
      (err) => {
        if (err) console.error('[Migration] Cannot migrate consecutive promo data:', err.message);
      }
    );
  }

  migrateQuantityPromoData() {
    this.db.run(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_promo_quantity_milestone
       ON promo_codes (issued_to_user_id, earned_quantity_servings, earned_quantity_start_date)
       WHERE source = 'auto_quantity'
         AND issued_to_user_id IS NOT NULL
         AND earned_quantity_servings IS NOT NULL
         AND earned_quantity_start_date IS NOT NULL`,
      (err) => {
        if (err) console.error('[Migration] Cannot create quantity promo index:', err.message);
      }
    );
  }

  migrateKitchenWorkflowData() {
    const today = this.getDateString();
    this.db.exec(
      `BEGIN IMMEDIATE TRANSACTION;

       UPDATE orders
       SET kitchen_status = 'done',
           kitchen_completed_at = COALESCE(kitchen_completed_at, created_at)
       WHERE day_id IN (SELECT id FROM days WHERE date < '${today}')
         AND COALESCE(kitchen_status, 'pending') = 'pending'
         AND NOT EXISTS (
           SELECT 1 FROM app_settings
           WHERE key = 'kitchen_workflow_migration_v1' AND value = '1'
         );

       UPDATE order_change_log
       SET kitchen_acknowledged_at = COALESCE(kitchen_acknowledged_at, action_at)
       WHERE day_id IN (SELECT id FROM days WHERE date < '${today}')
         AND action = 'deleted'
         AND NOT EXISTS (
           SELECT 1 FROM app_settings
           WHERE key = 'kitchen_workflow_migration_v1' AND value = '1'
         );

       INSERT INTO app_settings (key, value, description, updated_at)
       VALUES ('kitchen_workflow_migration_v1', '1', 'Backfill trang thai bep cho du lieu lich su', CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = '1', updated_at = CURRENT_TIMESTAMP;

       COMMIT`,
      (err) => {
        if (err) console.error('[Kitchen Migration]', err.message);
      }
    );
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

  // Kiểm tra nợ suất cơm của khách hàng (trả về số suất chưa thanh toán)
  getCustomerUnpaidServings(name, callback) {
    const normalizedName = String(name || '').trim();
    const orderAmountSql = this.getOrderAmountSql('o', 'd');
    this.db.get(
      `SELECT COALESCE(SUM(o.quantity), 0) AS total_servings,
              COALESCE(SUM(${orderAmountSql}), 0) AS total_amount
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
            // Tính số suất nợ = remaining / giá trung bình 1 suất
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
    this.getClosureDateSet((closureErr, closureDates) => {
      if (closureErr) { callback(closureErr); return; }
      this.db.all(
        `SELECT DISTINCT d.date FROM orders o JOIN days d ON d.id = o.day_id
         WHERE LOWER(o.name) = LOWER(?)
           AND strftime('%w', d.date) NOT IN ('0', '6')
         ORDER BY d.date DESC`,
        [normalizedName],
        (err, rows = []) => {
          if (err) { callback(err); return; }
          const dates = rows.map((row) => row.date).filter((date) => !closureDates.has(date));
          callback(null, this.countConsecutiveBusinessDates(dates, closureDates));
        }
      );
    });
  }

  getConsecutiveOrderDaysForUser(userId, callback) {
    this.getActiveConsecutiveOrderDatesForUser(userId, (err, dates = []) => {
      if (err) { callback(err); return; }
      callback(null, dates.length);
    });
  }

  getActiveConsecutiveOrderDatesForUser(userId, callback) {
    const normalizedUserId = Number(userId || 0);
    if (!normalizedUserId) {
      callback(null, []);
      return;
    }

    this.getClosureDateSet((closureErr, closureDates) => {
      if (closureErr) { callback(closureErr); return; }
      this.db.all(
        `SELECT DISTINCT d.date
         FROM orders o
         JOIN days d ON d.id = o.day_id
         WHERE o.user_id = ?
           AND strftime('%w', d.date) NOT IN ('0', '6')
         ORDER BY d.date DESC`,
        [normalizedUserId],
        (err, rows = []) => {
          if (err) { callback(err); return; }
          const dates = rows.map((row) => row.date).filter((date) => !closureDates.has(date));
          const activeCount = this.countActiveConsecutiveBusinessDates(dates, new Date(), closureDates);
          callback(null, dates.slice(0, activeCount));
        }
      );
    });
  }

  getConsecutiveOrderDatesForUserThroughDate(userId, throughDate, callback) {
    const normalizedUserId = Number(userId || 0);
    const normalizedDate = String(throughDate || '').trim();
    if (!normalizedUserId || !/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) {
      callback(null, []);
      return;
    }

    this.getClosureDateSet((closureErr, closureDates) => {
      if (closureErr) { callback(closureErr); return; }
      this.db.all(
        `SELECT DISTINCT d.date
         FROM orders o
         JOIN days d ON d.id = o.day_id
         WHERE o.user_id = ?
           AND d.date <= ?
           AND strftime('%w', d.date) NOT IN ('0', '6')
         ORDER BY d.date DESC`,
        [normalizedUserId, normalizedDate],
        (err, rows = []) => {
          if (err) { callback(err); return; }
          const dates = rows.map((row) => row.date).filter((date) => !closureDates.has(date));
          if (!dates.length || dates[0] !== normalizedDate) {
            callback(null, []);
            return;
          }
          callback(null, dates.slice(0, this.countConsecutiveBusinessDates(dates, closureDates)));
        }
      );
    });
  }

  getConsecutivePromoOverview(requiredDays, callback) {
    const normalizedRequiredDays = Math.max(2, Number(requiredDays || 5));
    this.db.all(
      `SELECT id, phone, name
       FROM users
       WHERE role = 'user'
       ORDER BY name COLLATE NOCASE ASC`,
      (userErr, users = []) => {
        if (userErr) { callback(userErr); return; }
        this.getClosureDateSet((closureErr, closureDates) => {
          if (closureErr) { callback(closureErr); return; }
          this.db.all(
            `SELECT DISTINCT o.user_id, d.date
             FROM orders o
             JOIN days d ON d.id = o.day_id
             WHERE o.user_id IS NOT NULL
               AND strftime('%w', d.date) NOT IN ('0', '6')
             ORDER BY o.user_id ASC, d.date DESC`,
            (dateErr, dateRows = []) => {
            if (dateErr) { callback(dateErr); return; }

            this.db.all(
              `SELECT issued_to_user_id AS user_id,
                      earned_streak_days,
                      earned_streak_date,
                      created_at
               FROM promo_codes
               WHERE source = 'auto_consecutive' AND issued_to_user_id IS NOT NULL
               ORDER BY created_at DESC, id DESC`,
              (promoErr, promoRows = []) => {
                if (promoErr) { callback(promoErr); return; }

                const datesByUser = new Map();
                for (const row of dateRows) {
                  if (closureDates.has(row.date)) continue;
                  const key = Number(row.user_id);
                  if (!datesByUser.has(key)) datesByUser.set(key, []);
                  datesByUser.get(key).push(row.date);
                }
                const promosByUser = new Map();
                for (const row of promoRows) {
                  const key = Number(row.user_id);
                  if (!promosByUser.has(key)) promosByUser.set(key, []);
                  promosByUser.get(key).push(row);
                }
                const rows = users.map((user) => {
                  const dates = datesByUser.get(Number(user.id)) || [];
                  const currentDays = this.countActiveConsecutiveBusinessDates(dates, new Date(), closureDates);
                  const userPromos = promosByUser.get(Number(user.id)) || [];
                  const cycleProgress = currentDays % normalizedRequiredDays;
                  const completedMilestone = Math.floor(currentDays / normalizedRequiredDays) * normalizedRequiredDays;
                  const currentMilestoneDate = completedMilestone > 0
                    ? dates[currentDays - completedMilestone]
                    : null;
                  const currentCycleAwarded = completedMilestone > 0 && userPromos.some((promo) => (
                    Number(promo.earned_streak_days || 0) === completedMilestone
                    && promo.earned_streak_date === currentMilestoneDate
                  ));
                  return {
                    id: user.id,
                    phone: user.phone,
                    name: user.name,
                    current_days: currentDays,
                    last_order_date: dates[0] || null,
                    remaining_days: currentDays > 0 && cycleProgress === 0
                      ? 0
                      : Math.max(0, normalizedRequiredDays - cycleProgress),
                    promo_count: userPromos.length,
                    latest_promo_at: userPromos[0]?.created_at || null,
                    highest_awarded_streak: userPromos.reduce(
                      (highest, promo) => Math.max(highest, Number(promo.earned_streak_days || 0)),
                      0
                    ),
                    current_milestone_days: completedMilestone,
                    current_milestone_date: currentMilestoneDate,
                    current_cycle_awarded: currentCycleAwarded
                  };
                });

                rows.sort((a, b) => b.current_days - a.current_days
                  || String(b.last_order_date || '').localeCompare(String(a.last_order_date || ''))
                  || a.name.localeCompare(b.name, 'vi'));
                callback(null, rows);
              }
            );
            }
          );
        });
      }
    );
  }

  countConsecutiveBusinessDates(dateRows, closureDates = new Set()) {
    const dates = Array.isArray(dateRows) ? dateRows : [];
    if (!dates.length) return 0;

    let consecutive = 1;
    for (let i = 1; i < dates.length; i++) {
      const expectedPrevious = this.getPreviousBusinessDate(dates[i - 1], closureDates);
      if (dates[i] === expectedPrevious) {
        consecutive++;
      } else {
        break;
      }
    }
    return consecutive;
  }

  countActiveConsecutiveBusinessDates(dateRows, referenceDate = new Date(), closureDates = new Set()) {
    const dates = Array.isArray(dateRows) ? dateRows : [];
    if (!dates.length) return 0;

    const latestOrderDate = dates[0];
    const currentBusinessDate = this.getCurrentBusinessDateString(referenceDate, closureDates);
    const previousBusinessDate = this.getPreviousBusinessDate(currentBusinessDate, closureDates);

    if (latestOrderDate !== currentBusinessDate && latestOrderDate !== previousBusinessDate) {
      return 0;
    }

    return this.countConsecutiveBusinessDates(dates, closureDates);
  }

  getCurrentBusinessDateString(date = new Date(), closureDates = new Set()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date).reduce((result, part) => {
      result[part.type] = part.value;
      return result;
    }, {});
    const current = new Date(Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day)
    ));
    while (current.getUTCDay() === 0
      || current.getUTCDay() === 6
      || closureDates.has(this.getUtcDateString(current))) {
      current.setUTCDate(current.getUTCDate() - 1);
    }
    return this.getUtcDateString(current);
  }

  getPreviousBusinessDate(dateString, closureDates = new Set()) {
    const date = new Date(dateString + 'T00:00:00Z');
    do {
      date.setUTCDate(date.getUTCDate() - 1);
    } while (date.getUTCDay() === 0
      || date.getUTCDay() === 6
      || closureDates.has(this.getUtcDateString(date)));

    return this.getUtcDateString(date);
  }

  getPreviousOpenBusinessDate(dateString, callback) {
    this.getClosureDateSet((err, closureDates) => {
      if (err) { callback(err); return; }
      callback(null, this.getPreviousBusinessDate(dateString, closureDates));
    });
  }

  getUtcDateString(date) {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  getAutoPromoCodeByStreak(userId, streakDays, earnedStreakDate, callback) {
    if (typeof earnedStreakDate === 'function') {
      callback = earnedStreakDate;
      earnedStreakDate = '';
    }
    const normalizedDate = String(earnedStreakDate || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) {
      callback(null, null);
      return;
    }
    this.db.get(
      `SELECT id, code, discount_percent, created_at, used_by, used_at, order_id,
              issued_to_user_id, issued_to_name, source, earned_streak_days, earned_streak_date
       FROM promo_codes
       WHERE source = 'auto_consecutive'
         AND issued_to_user_id = ?
         AND earned_streak_days = ?
         AND earned_streak_date = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [Number(userId || 0), Number(streakDays || 0), normalizedDate],
      callback
    );
  }

  getAutoPromoCodesForUser(userId, callback) {
    this.db.all(
      `SELECT id, code, discount_percent, created_at, used_by, used_at, order_id,
              issued_to_user_id, issued_to_name, source, earned_streak_days, earned_streak_date
       FROM promo_codes
       WHERE source = 'auto_consecutive'
         AND issued_to_user_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 20`,
      [Number(userId || 0)],
      callback
    );
  }

  // Tạo mã KM tự động cho khách (consecutive promo)
  createAutoPromoCode(name, discountPercent, userId, earnedStreakDays, earnedStreakDate, callback) {
    if (typeof earnedStreakDate === 'function') {
      callback = earnedStreakDate;
      earnedStreakDate = '';
    }

    const normalizedUserId = Number(userId || 0) || null;
    const normalizedStreak = Number(earnedStreakDays || 0) || null;
    const normalizedStreakDate = String(earnedStreakDate || '').trim();
    const database = this;

    if (normalizedUserId && (!normalizedStreak || !/^\d{4}-\d{2}-\d{2}$/.test(normalizedStreakDate))) {
      callback(new Error('Thieu ngay dat moc hop le cho ma chuoi'));
      return;
    }

    const buildAutoCode = () => {
      const timestamp = Date.now().toString(36).toUpperCase();
      const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
      return `AUTO${timestamp}${suffix}`;
    };

    const insertNewCode = (attempt = 0) => {
      const code = buildAutoCode();
      this.db.run(
        `INSERT INTO promo_codes
          (code, discount_percent, issued_to_user_id, issued_to_name, source, earned_streak_days, earned_streak_date)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          code,
          Number(discountPercent || 0),
          normalizedUserId,
          String(name || '').trim(),
          normalizedUserId ? 'auto_consecutive' : 'manual',
          normalizedStreak,
          normalizedUserId ? normalizedStreakDate : null
        ],
        function(err) {
          if (err) {
            if (err.message && err.message.includes('UNIQUE')) {
              database.getAutoPromoCodeByStreak(
                normalizedUserId,
                normalizedStreak,
                normalizedStreakDate,
                (findErr, existing) => {
                  if (findErr) { callback(findErr); return; }
                  if (existing) {
                    callback(null, {
                      id: existing.id,
                      code: existing.code,
                      discountPercent: Number(existing.discount_percent || discountPercent || 0),
                      earnedStreakDate: normalizedStreakDate,
                      existing: true
                    });
                    return;
                  }
                  if (attempt < 3) { insertNewCode(attempt + 1); return; }
                  callback(err);
                }
              );
              return;
            }
            callback(err);
            return;
          }
          callback(null, {
            id: this.lastID,
            code,
            discountPercent: Number(discountPercent || 0),
            earnedStreakDate: normalizedStreakDate
          });
        }
      );
    };

    if (!normalizedUserId || !normalizedStreak) {
      insertNewCode();
      return;
    }

    this.getAutoPromoCodeByStreak(normalizedUserId, normalizedStreak, normalizedStreakDate, (err, existing) => {
      if (err) {
        callback(err);
        return;
      }
      if (existing) {
        callback(null, {
          id: existing.id,
          code: existing.code,
          discountPercent: Number(existing.discount_percent || discountPercent || 0),
          earnedStreakDate: normalizedStreakDate,
          existing: true
        });
        return;
      }
      insertNewCode();
    });
  }

  getUserTotalOrderedServings(userId, startDate, callback) {
    const normalizedUserId = Number(userId || 0);
    const normalizedStartDate = String(startDate || '').trim();
    if (!normalizedUserId || !/^\d{4}-\d{2}-\d{2}$/.test(normalizedStartDate)) {
      callback(null, 0);
      return;
    }
    this.db.get(
      `SELECT COALESCE(SUM(o.quantity), 0) AS total_servings
       FROM orders o
       JOIN days d ON d.id = o.day_id
       WHERE o.user_id = ? AND d.date >= ?`,
      [normalizedUserId, normalizedStartDate],
      (err, row) => callback(err, Number(row?.total_servings || 0))
    );
  }

  getQuantityPromoByMilestone(userId, milestoneServings, startDate, callback) {
    this.db.get(
      `SELECT id, code, discount_percent, created_at, used_by, used_at, order_id,
              issued_to_user_id, issued_to_name, source,
              earned_quantity_servings, earned_quantity_start_date
       FROM promo_codes
       WHERE source = 'auto_quantity'
         AND issued_to_user_id = ?
         AND earned_quantity_servings = ?
         AND earned_quantity_start_date = ?
       LIMIT 1`,
      [Number(userId || 0), Number(milestoneServings || 0), String(startDate || '').trim()],
      callback
    );
  }

  createQuantityPromoCode(name, discountPercent, userId, milestoneServings, startDate, callback) {
    const normalizedUserId = Number(userId || 0);
    const normalizedMilestone = Number(milestoneServings || 0);
    const normalizedStartDate = String(startDate || '').trim();
    if (!normalizedUserId || !normalizedMilestone || !/^\d{4}-\d{2}-\d{2}$/.test(normalizedStartDate)) {
      callback(new Error('Dữ liệu mốc tích suất không hợp lệ'));
      return;
    }

    const database = this;
    const insertCode = (attempt = 0) => {
      const code = `QTY${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      this.db.run(
        `INSERT INTO promo_codes
          (code, discount_percent, issued_to_user_id, issued_to_name, source,
           earned_quantity_servings, earned_quantity_start_date)
         VALUES (?, ?, ?, ?, 'auto_quantity', ?, ?)`,
        [
          code,
          Number(discountPercent || 0),
          normalizedUserId,
          String(name || '').trim(),
          normalizedMilestone,
          normalizedStartDate
        ],
        function onQuantityPromoInserted(err) {
          if (!err) {
            callback(null, {
              id: this.lastID,
              code,
              discountPercent: Number(discountPercent || 0),
              milestoneServings: normalizedMilestone
            });
            return;
          }
          if (!String(err.message || '').includes('UNIQUE')) {
            callback(err);
            return;
          }
          database.getQuantityPromoByMilestone(
            normalizedUserId,
            normalizedMilestone,
            normalizedStartDate,
            (findErr, existing) => {
              if (findErr) { callback(findErr); return; }
              if (existing) {
                callback(null, {
                  id: existing.id,
                  code: existing.code,
                  discountPercent: Number(existing.discount_percent || discountPercent || 0),
                  milestoneServings: normalizedMilestone,
                  existing: true
                });
                return;
              }
              if (attempt < 3) { insertCode(attempt + 1); return; }
              callback(err);
            }
          );
        }
      );
    };

    this.getQuantityPromoByMilestone(
      normalizedUserId,
      normalizedMilestone,
      normalizedStartDate,
      (err, existing) => {
        if (err) { callback(err); return; }
        if (existing) {
          callback(null, {
            id: existing.id,
            code: existing.code,
            discountPercent: Number(existing.discount_percent || discountPercent || 0),
            milestoneServings: normalizedMilestone,
            existing: true
          });
          return;
        }
        insertCode();
      }
    );
  }

  // Bảng xếp hạng theo tháng — đếm số ngày đặt cơm (không phải số suất)
  getMonthlyLeaderboard(month, callback) {
    let selectedMonth = String(month || '').trim();
    let finalCallback = callback;

    if (typeof month === 'function') {
      finalCallback = month;
      selectedMonth = '';
    }

    if (!/^\d{4}-\d{2}$/.test(selectedMonth)) {
      const now = new Date();
      selectedMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }

    // Đếm số ngày phân biệt (distinct) mà mỗi người đặt cơm trong tháng đã chọn
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

    this.db.all(sql, [selectedMonth], (err, rows = []) => {
      if (err) { finalCallback(err); return; }

      // Tổng số ngày có phát sinh đơn hàng trong tháng (để tính %)
      this.db.get(
        `SELECT COUNT(DISTINCT d.date) AS total_days
         FROM days d
         JOIN orders o ON o.day_id = d.id
         WHERE strftime('%Y-%m', d.date) = ?`,
        [selectedMonth],
        (err2, totalRow) => {
          if (err2) { finalCallback(err2); return; }

          const totalDays = Number(totalRow?.total_days || 0);

          // Dense ranking: cùng số ngày → cùng hạng (1, 1, 2, 2, 3...)
          let currentRank = 1;
          const leaders = rows.map((row, index) => {
            if (index > 0 && row.days < rows[index - 1].days) {
              currentRank++;
            }
            return {
              rank: currentRank,
              name: row.name,
              days: Number(row.days || 0),
              percentage: totalDays > 0 ? Math.min(100, Math.round((row.days / totalDays) * 100)) : 0
            };
          });

          finalCallback(null, { month: selectedMonth, leaders });
        }
      );
    });
  }

  // =============================================
  // Game Scores
  // =============================================
  saveGameScore(userId, score, level, caught, callback) {
    this.db.run(
      `INSERT INTO game_scores (user_id, score, level, caught) VALUES (?, ?, ?, ?)`,
      [userId, score, level, caught],
      (err) => {
        if (err) return callback(err);
        // Giữ lại chỉ bản ghi điểm cao nhất của user, xoá các bản cũ
        this.db.run(
          `DELETE FROM game_scores WHERE user_id = ? AND id NOT IN (
            SELECT id FROM game_scores WHERE user_id = ? ORDER BY score DESC, level DESC LIMIT 1
          )`,
          [userId, userId],
          (err2) => {
            if (err2) return callback(err2);
            this.getPlayerBest(userId, (err3, best) => {
              if (err3) return callback(err3);
              callback(null, { best });
            });
          }
        );
      }
    );
  }

  getGameLeaderboard(callback) {
    this.db.all(
      `SELECT u.name, MAX(gs.score) AS score, gs.level, gs.caught, gs.created_at
       FROM game_scores gs
       JOIN users u ON u.id = gs.user_id
       GROUP BY gs.user_id
       ORDER BY score DESC, gs.level DESC
       LIMIT 50`,
      [],
      (err, rows) => {
        if (err) return callback(err);
        let currentRank = 0, prevScore = -1;
        const leaders = (rows || []).map((row) => {
          if (row.score !== prevScore) { currentRank++; prevScore = row.score; }
          return { rank: currentRank, name: row.name, score: row.score, level: row.level, caught: row.caught, date: row.created_at };
        });
        callback(null, leaders);
      }
    );
  }

  getPlayerBest(userId, callback) {
    this.db.get(
      `SELECT MAX(score) AS best_score, MAX(level) AS best_level FROM game_scores WHERE user_id = ?`,
      [userId],
      (err, row) => {
        if (err) return callback(err);
        callback(null, { bestScore: row?.best_score || 0, bestLevel: row?.best_level || 0 });
      }
    );
  }
}


module.exports = Database;
