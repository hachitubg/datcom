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
       ORDER BY o.created_at DESC`,
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
            `SELECT id, name, quantity, description, created_at FROM orders WHERE day_id = ? ORDER BY created_at DESC, id DESC`,
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
      `SELECT d.date, SUM(o.quantity) AS quantity, SUM(o.quantity * d.price) AS day_amount
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

            // Hiển thị ngày gần nhất lên trên
            unpaidRows.reverse();
            callback(null, unpaidRows);
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
          SUM(o.quantity * d.price)        AS day_amount,
          SUM(SUM(o.quantity * d.price)) OVER (
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
      `SELECT d.date, SUM(o.quantity * d.price) AS day_amount
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

            if (unpaidDates.size === 0) {
              return callback(null, { name: normalizedName, totalQuantity: 0, totalAmount: 0, rows: [] });
            }

            // Bước 4: lấy từng đơn lẻ thuộc các ngày còn nợ
            const placeholders = Array.from(unpaidDates).map(() => '?').join(', ');
            this.db.all(
              `SELECT o.id, o.quantity, o.description, o.created_at, d.price, d.date
               FROM orders o JOIN days d ON d.id = o.day_id
               WHERE LOWER(o.name) = LOWER(?) AND d.date IN (${placeholders})
               ORDER BY d.date ASC, o.created_at ASC, o.id ASC`,
              [normalizedName, ...Array.from(unpaidDates)],
              (err3, orderRows = []) => {
                if (err3) { callback(err3); return; }

                const mappedRows = orderRows.map((row) => ({
                  id: Number(row.id),
                  quantity: Number(row.quantity || 0),
                  description: row.description || '',
                  createdAt: row.created_at || '',
                  amount: Number(row.quantity || 0) * Number(row.price || 0)
                }));

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
          `SELECT SUM(o.quantity) AS quantity, SUM(o.quantity * d.price) AS total_amount
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


  getCustomerRemainingDebt(name, callback) {
    const normalizedName = String(name || '').trim();
    if (!normalizedName) {
      callback(new Error('Thiếu tên khách hàng'));
      return;
    }

    this.db.get(
      `SELECT COALESCE(SUM(o.quantity * d.price), 0) AS total_amount
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
    const normalizedAmount = Number(amount || 0);

    if (!normalizedName) {
      callback(new Error('Tên khách hàng không hợp lệ'));
      return;
    }

    if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
      callback(new Error('Số tiền thanh toán không hợp lệ'));
      return;
    }

    this.db.get(
      `SELECT MAX(d.id) AS latest_day_id, MIN(o.name) AS db_name
       FROM orders o
       JOIN days d ON o.day_id = d.id
       WHERE LOWER(o.name) = LOWER(?)`,
      [normalizedName],
      (dayErr, dayRow) => {
        if (dayErr) {
          callback(dayErr);
          return;
        }

        if (!dayRow || !dayRow.latest_day_id) {
          callback(new Error('Không tìm thấy đơn đặt cơm của khách này'));
          return;
        }

        const orderCode = Number(`${Date.now().toString().slice(-10)}${Math.floor(Math.random() * 90 + 10)}`);
        const finalName = (dayRow.db_name || normalizedName).trim();
        const now = new Date().toISOString();
        const payload = {
          source: 'admin_cash_manual',
          note: 'Manual cash payment from admin panel'
        };

        this.db.run(
          `INSERT INTO payment_requests
            (day_id, customer_name, order_code, amount, payment_link_id, checkout_url, qr_code, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, NULL, NULL, NULL, 'PAID', ?, ?)`,
          [Number(dayRow.latest_day_id), finalName, orderCode, normalizedAmount, now, now],
          (reqErr) => {
            if (reqErr) { callback(reqErr); return; }

            this.db.run(
              `INSERT INTO payment_transactions
                (day_id, customer_name, order_code, amount, status, reference, transaction_date, raw_payload)
               VALUES (?, ?, ?, ?, 'PAID', 'CASH-MANUAL', ?, ?)`,
              [Number(dayRow.latest_day_id), finalName, orderCode, normalizedAmount, now, JSON.stringify(payload)],
              callback
            );
          }
        );
      }
    );
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
      `SELECT d.date, SUM(o.quantity) AS quantity, SUM(o.quantity * d.price) AS day_amount, d.price
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
                paymentStatus
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
}


module.exports = Database;
