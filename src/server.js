require('./load-env');
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const Database = require('./database');
const PayOSService = require('./payos');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());

app.post('/api/payments/webhook/payos',
  express.raw({ type: '*/*' }),
  (req, res) => {
    try {
      if (!req.body) {
        return res.status(200).json({ ok: true });
      }

      const rawBody = req.body.toString('utf8');
      let parsedBody;

      try {
        parsedBody = JSON.parse(rawBody);
      } catch {
        return res.status(200).json({ ok: true });
      }

      // Nếu không có data → đây là request test
      if (!parsedBody.data || !parsedBody.data.orderCode) {
        return res.status(200).json({ ok: true });
      }

      const isValidSignature = payos.verifyWebhook(parsedBody);
      if (!isValidSignature) {
        console.log("Invalid signature");
        return res.status(200).json({ ok: true }); // ⚠️ KHÔNG trả 400
      }

      const data = parsedBody.data;
      const orderCode = Number(data.orderCode);
      const amount = Number(data.amount || 0);

      db.markPaymentPaid(orderCode, { amount, raw: parsedBody }, (err) => {
        if (err) {
          console.error("DB error:", err);
          return res.status(500).json({ error: err.message });
        }

        res.json({ success: true });
      });

    } catch (err) {
      console.error("Webhook crash:", err);
      res.status(200).json({ ok: true }); // ⚠️ KHÔNG trả 500
    }
  }
);

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use((req, res, next) => {
  if (req.path === '/admin.html') {
    const token = getAdminSessionToken(req);
    if (!token || !adminSessions.has(token)) {
      return res.redirect('/admin-login');
    }
  }
  next();
});
app.use(express.static('public'));

// Khởi tạo database
const db = new Database();
const payos = new PayOSService();
const ADMIN_PASSWORD = 'hachitu';
const adminSessions = new Set();

function parseCookies(req) {
  const cookieHeader = req.headers.cookie || '';
  const cookies = {};
  cookieHeader.split(';').forEach((part) => {
    const [rawKey, ...rawValueParts] = part.trim().split('=');
    if (!rawKey) return;
    cookies[rawKey] = decodeURIComponent(rawValueParts.join('='));
  });
  return cookies;
}

function getAdminSessionToken(req) {
  const cookies = parseCookies(req);
  return cookies.admin_session || '';
}

function requireAdminApiAuth(req, res, next) {
  const token = getAdminSessionToken(req);
  if (!token || !adminSessions.has(token)) {
    return res.status(401).json({ error: 'UNAUTHORIZED_ADMIN' });
  }
  next();
}

function requireAdminPageAuth(req, res, next) {
  const token = getAdminSessionToken(req);
  if (!token || !adminSessions.has(token)) {
    return res.redirect('/admin-login');
  }
  next();
}

app.use('/api/admin', (req, res, next) => {
  if (req.path === '/login' || req.path === '/logout') {
    return next();
  }
  return requireAdminApiAuth(req, res, next);
});

function normalizeName(name) {
  const compact = (name || '').trim().replace(/\s+/g, ' ');
  if (!compact) {
    return '';
  }

  return compact
    .split(' ')
    .map((part) => {
      if (!part) return '';
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(' ');
}

function buildOrderCode() {
  return Number(`${Date.now().toString().slice(-10)}${Math.floor(Math.random() * 90 + 10)}`);
}

function getPublicBaseUrl(req) {
  return process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
}

async function syncOrderCodeFromPayOS(orderCode) {
  const paymentInfo = await payos.getPaymentLinkInformation(orderCode);
  const paidAmount = Number(paymentInfo.amountPaid || 0);
  const amount = Number(paymentInfo.amount || paidAmount || 0);
  const status = String(paymentInfo.status || '').toUpperCase();
  const paidStatuses = PAID_PAYMENT_STATUSES;

  if (paidStatuses.has(status) || paidAmount > 0) {
    return new Promise((resolve, reject) => {
      db.markPaymentPaid(
        orderCode,
        {
          amount: paidAmount > 0 ? paidAmount : amount,
          reference: paymentInfo.reference || paymentInfo.paymentLinkId || '',
          transactionDateTime: paymentInfo.transactionDateTime || paymentInfo.transactionDate || '',
          code: paymentInfo.code || '',
          paymentLinkId: paymentInfo.paymentLinkId || '',
          raw: paymentInfo
        },
        (err) => {
          if (err) {
            reject(err);
            return;
          }

          resolve({ updated: true, status, paidAmount: paidAmount > 0 ? paidAmount : amount });
        }
      );
    });
  }

  if (status === 'CANCELLED' || status === 'EXPIRED') {
    await new Promise((resolve, reject) => {
      db.updatePaymentRequestStatus(orderCode, status, (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  }

  return { updated: false, status, paidAmount };
}

const PAID_PAYMENT_STATUSES = new Set(['PAID', 'SUCCESS', 'SUCCEEDED']);

let isSyncingPendingPayOS = false;

async function syncPendingPaymentsFromPayOS() {
  if (!payos.isConfigured()) {
    return;
  }

  if (isSyncingPendingPayOS) {
    return;
  }

  isSyncingPendingPayOS = true;
  try {
    const pendingRows = await new Promise((resolve, reject) => {
      db.getPendingPaymentRequests(50, (err, rows = []) => {
        if (err) {
          reject(err);
          return;
        }

        resolve(rows);
      });
    });

    let updatedCount = 0;
    for (const row of pendingRows) {
      try {
        const result = await syncOrderCodeFromPayOS(Number(row.order_code));
        if (result && result.updated) {
          updatedCount += 1;
          console.log(`[PayOS Sync] Updated PAID for orderCode=${row.order_code}`);
        }
      } catch (orderErr) {
        console.error(`[PayOS Sync] Failed orderCode=${row.order_code}:`, orderErr.message);
      }
    }

    if (updatedCount > 0) {
      console.log(`[PayOS Sync] Updated ${updatedCount} pending payment(s).`);
    }
  } catch (err) {
    console.error('[PayOS Sync] Batch sync failed:', err.message);
  } finally {
    isSyncingPendingPayOS = false;
  }
}

// API Routes
// Lấy thông tin hôm nay
app.get('/api/today', (req, res) => {
  db.getTodayInfo((err, data) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(data);
  });
});

// Lấy danh sách đơn hàng hôm nay
app.get('/api/orders/today', (req, res) => {
  db.getTodayOrders((err, orders) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(orders);
  });
});

// Tạo đơn hàng mới
app.post('/api/orders', (req, res) => {
  const normalizedCustomerName = normalizeName(req.body.name);
  const { quantity, description } = req.body;

  if (!normalizedCustomerName || !quantity) {
    return res.status(400).json({ error: 'Thiếu thông tin bắt buộc' });
  }

  db.addOrder(normalizedCustomerName, quantity, description || '', (err, order) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(order);
  });
});

// Lấy danh sách tất cả ngày (cho admin)
app.get('/api/admin/all-days', (req, res) => {
  console.log('📋 Request: Danh sách tất cả ngày');
  db.getAllDays((err, days) => {
    if (err) {
      console.error('❌ Lỗi:', err);
      return res.status(500).json({ error: err.message });
    }
    console.log('✅ Trả về', days.length, 'ngày');
    res.json(days);
  });
});

// Lấy chi tiết một ngày
app.get('/api/admin/day/:date', (req, res) => {
  const { date } = req.params;
  console.log('📅 Request: Chi tiết ngày', date);
  db.getDayDetails(date, (err, data) => {
    if (err) {
      console.error('❌ Lỗi:', err);
      return res.status(500).json({ error: err.message });
    }
    console.log('✅ Trả về chi tiết ngày', date);
    res.json(data);
  });
});

// Cập nhật menu hôm nay
app.post('/api/admin/menu', (req, res) => {
  const { menu, menuString } = req.body;
  console.log('🔧 Admin cập nhật menu:', menu);
  
  if (!menu) {
    console.error('❌ Menu trống!');
    return res.status(400).json({ error: 'Menu không được để trống' });
  }
  
  // Lưu menu object dưới dạng JSON
  // Nếu menu đã là string, dùng trực tiếp; nếu là object, stringify nó
  let menuJson = typeof menu === 'string' ? menu : JSON.stringify(menu);
  console.log('📝 Lưu menu JSON:', menuJson);
  
  db.updateTodayMenu(menuJson, (err) => {
    if (err) {
      console.error('❌ Lỗi lưu menu:', err);
      return res.status(500).json({ error: err.message });
    }
    console.log('✅ Menu đã lưu thành công');
    res.json({ success: true });
  });
});

// Cập nhật số lượng có thể đặt
app.post('/api/admin/quantity', (req, res) => {
  const { quantity } = req.body;
  if (!quantity || quantity < 1) {
    return res.status(400).json({ error: 'Số lượng không hợp lệ' });
  }
  db.updateTodayQuantity(quantity, (err) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ success: true });
  });
});

// Xóa đơn hàng
app.delete('/api/admin/orders/:orderId', (req, res) => {
  const { orderId } = req.params;
  db.deleteOrder(orderId, (err) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ success: true });
  });
});

// Sửa đơn hàng
app.put('/api/admin/orders/:orderId', (req, res) => {
  const { orderId } = req.params;
  const name = normalizeName(req.body.name);
  const quantity = Number(req.body.quantity || 0);
  const description = (req.body.description || '').toString();

  if (!name || !Number.isFinite(quantity) || quantity <= 0) {
    return res.status(400).json({ error: 'Dữ liệu cập nhật không hợp lệ' });
  }

  db.updateOrder(orderId, { name, quantity, description }, (err) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    res.json({ success: true });
  });
});

app.get('/api/customers/names', (req, res) => {
  db.getKnownCustomerNames((err, names) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(names);
  });
});

app.post('/api/admin/customers/rename', (req, res) => {
  const oldName = normalizeName(req.body.oldName);
  const newName = normalizeName(req.body.newName);

  if (!oldName || !newName) {
    return res.status(400).json({ error: 'Vui lòng nhập đủ tên cũ và tên mới' });
  }

  db.renameCustomer(oldName, newName, (err, result) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    res.json({ success: true, ...result });
  });
});


// Danh sách công nợ thanh toán hôm nay
app.get('/api/payments/today', (req, res) => {
  const search = (req.query.search || '').toString();
  db.getTodayPaymentSummary(search, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

app.get('/api/admin/customers/:name/orders', (req, res) => {
  const customerName = normalizeName(decodeURIComponent(req.params.name || ''));
  if (!customerName) {
    return res.status(400).json({ error: 'Thiếu tên khách hàng hợp lệ' });
  }

  db.getCustomerOrderDetails(customerName, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    res.json({ customerName, rows });
  });
});

// Tạo QR thanh toán cho khách hàng hôm nay
app.post('/api/payments/create', async (req, res) => {
  const name = normalizeName(req.body.name);
  if (!name) {
    return res.status(400).json({ error: 'Vui lòng nhập tên người đặt cơm' });
  }

  if (!payos.isConfigured()) {
    return res.status(500).json({
      error: 'PayOS chưa được cấu hình. Vui lòng thiết lập PAYOS_CLIENT_ID, PAYOS_API_KEY, PAYOS_CHECKSUM_KEY ở biến môi trường.'
    });
  }

  db.getTodayCustomerPayment(name, async (err, paymentInfo) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }

    if (paymentInfo.remainingAmount <= 0) {
      return res.json({
        paid: true,
        message: 'Đơn này đã thanh toán đủ.',
        paymentInfo
      });
    }

    try {
      const orderCode = buildOrderCode();
      const baseUrl = getPublicBaseUrl(req);
      const payload = {
        orderCode,
        amount: paymentInfo.remainingAmount,
        description: `DATCOM ${name}`.slice(0, 25),
        returnUrl: `${baseUrl}/?payment=success&orderCode=${orderCode}`,
        cancelUrl: `${baseUrl}/?payment=cancel&orderCode=${orderCode}`,
        buyerName: name,
        expiredAt: Math.floor(Date.now() / 1000) + 15 * 60
      };

      const payosLink = await payos.createPaymentLink(payload);
      db.createPaymentRequest(
        {
          dayId: paymentInfo.dayId,
          customerName: name,
          orderCode,
          amount: paymentInfo.remainingAmount,
          paymentLinkId: payosLink.paymentLinkId,
          checkoutUrl: payosLink.checkoutUrl,
          qrCode: payosLink.qrCode
        },
        (saveErr) => {
          if (saveErr) {
            return res.status(500).json({ error: saveErr.message });
          }

          res.json({
            paid: false,
            paymentInfo,
            payos: {
              orderCode,
              amount: paymentInfo.remainingAmount,
              checkoutUrl: payosLink.checkoutUrl,
              qrCode: payosLink.qrCode,
              paymentLinkId: payosLink.paymentLinkId
            }
          });
        }
      );
    } catch (createErr) {
      return res.status(500).json({ error: createErr.message });
    }
  });
});

app.get('/api/payments/verify-return', async (req, res) => {
  if (!payos.isConfigured()) {
    return res.status(500).json({ error: 'PayOS chưa được cấu hình trên server' });
  }

  const orderCode = Number(req.query.orderCode || req.query.order_code || 0);
  if (!orderCode) {
    return res.status(400).json({ error: 'Thiếu mã đơn hàng (orderCode)' });
  }

  try {
    const result = await syncOrderCodeFromPayOS(orderCode);
    return res.json({ success: true, ...result });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});


// Admin: chuyển trạng thái thủ công khi PayOS webhook/API lỗi
app.post('/api/admin/payments/manual-paid', (req, res) => {
  const orderCode = Number(req.body.orderCode || 0);

  if (!orderCode) {
    return res.status(400).json({ error: 'Thiếu mã orderCode hợp lệ' });
  }

  db.markPaymentPaidManual(orderCode, (err) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    res.json({ success: true, orderCode });
  });
});


// Admin: ghi nhận thu tiền mặt/chuyển khoản ngoài hệ thống cho khách
app.post('/api/admin/payments/manual-cash', (req, res) => {
  const name = normalizeName(req.body.name);
  const requestedAmount = Number(req.body.amount || 0);

  if (!name) {
    return res.status(400).json({ error: 'Thiếu tên khách hàng' });
  }

  db.getTodayCustomerPayment(name, (paymentErr, paymentInfo) => {
    if (paymentErr) {
      return res.status(400).json({ error: paymentErr.message });
    }

    if (paymentInfo.remainingAmount <= 0) {
      return res.status(400).json({ error: 'Khách này không còn công nợ để cập nhật' });
    }

    const manualAmount = requestedAmount > 0 ? requestedAmount : paymentInfo.remainingAmount;
    if (!Number.isFinite(manualAmount) || manualAmount <= 0) {
      return res.status(400).json({ error: 'Số tiền cập nhật không hợp lệ' });
    }

    if (manualAmount > paymentInfo.remainingAmount) {
      return res.status(400).json({
        error: `Số tiền vượt quá công nợ còn lại (${paymentInfo.remainingAmount})`
      });
    }

    db.markCustomerCashPaid(name, manualAmount, (markErr) => {
      if (markErr) {
        return res.status(500).json({ error: markErr.message });
      }

      res.json({
        success: true,
        name,
        amount: manualAmount,
        remainingAmount: Math.max(0, paymentInfo.remainingAmount - manualAmount)
      });
    });
  });
});

// Lịch sử thanh toán
app.get('/api/payments/history', (req, res) => {
  const filters = {
    search: (req.query.search || '').toString(),
    period: (req.query.period || 'all').toString(),
    date: (req.query.date || '').toString(),
    month: (req.query.month || '').toString(),
    fromDate: (req.query.fromDate || '').toString(),
    toDate: (req.query.toDate || '').toString(),
    status: (req.query.status || 'all').toString()
  };

  db.getPaymentHistory(filters, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// Serve trang chủ
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Serve trang admin
app.get('/admin', requireAdminPageAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin.html'));
});

app.get('/admin-login', (req, res) => {
  const token = getAdminSessionToken(req);
  if (token && adminSessions.has(token)) {
    return res.redirect('/admin');
  }
  res.sendFile(path.join(__dirname, '../public/admin-login.html'));
});

app.post('/api/admin/login', (req, res) => {
  const password = String(req.body.password || '');
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Mật khẩu không đúng' });
  }

  const sessionToken = crypto.randomBytes(24).toString('hex');
  adminSessions.add(sessionToken);
  res.setHeader('Set-Cookie', `admin_session=${encodeURIComponent(sessionToken)}; HttpOnly; Path=/; Max-Age=28800; SameSite=Lax`);
  res.json({ success: true });
});

app.post('/api/admin/logout', (req, res) => {
  const token = getAdminSessionToken(req);
  if (token && adminSessions.has(token)) {
    adminSessions.delete(token);
  }
  res.setHeader('Set-Cookie', 'admin_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax');
  res.json({ success: true });
});

const payosAutoSyncMs = Number(process.env.PAYOS_AUTO_SYNC_MS || 30000);
if (payos.isConfigured()) {
  setTimeout(() => {
    syncPendingPaymentsFromPayOS();
  }, 5000);

  setInterval(() => {
    syncPendingPaymentsFromPayOS();
  }, payosAutoSyncMs);
}

app.listen(PORT, () => {
  console.log(`Server chạy tại http://localhost:${PORT}`);
  if (payos.isConfigured()) {
    console.log(`PayOS auto-sync pending payments mỗi ${payosAutoSyncMs}ms`);
  }
});
