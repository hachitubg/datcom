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
    return requireAdminPageAuth(req, res, next);
  }
  next();
});
app.use(express.static('public'));

// Khởi tạo database
const db = new Database();
const payos = new PayOSService();

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

function verifyPassword(password, hash, salt) {
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return derived === hash;
}

function getCookieOptions(maxAgeSeconds) {
  const parts = ['HttpOnly', 'Path=/', `Max-Age=${maxAgeSeconds}`, 'SameSite=Lax'];
  if (String(process.env.COOKIE_SECURE || '') === '1') {
    parts.push('Secure');
  }
  return parts.join('; ');
}

function setSessionCookie(res, cookieName, token, maxAgeSeconds) {
  res.setHeader('Set-Cookie', `${cookieName}=${encodeURIComponent(token)}; ${getCookieOptions(maxAgeSeconds)}`);
}

function clearSessionCookie(res, cookieName) {
  const parts = ['HttpOnly', 'Path=/', 'Max-Age=0', 'SameSite=Lax'];
  if (String(process.env.COOKIE_SECURE || '') === '1') {
    parts.push('Secure');
  }
  res.setHeader('Set-Cookie', `${cookieName}=; ${parts.join('; ')}`);
}

const configuredSessionSecret = String(process.env.SESSION_SECRET || '').trim();
const publicBaseUrl = String(process.env.PUBLIC_BASE_URL || '').trim().toLowerCase();
const isLocalLikeEnv = !publicBaseUrl || publicBaseUrl.includes('localhost') || publicBaseUrl.includes('127.0.0.1');
const isProduction = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
const SESSION_SECRET = configuredSessionSecret || (!isProduction && isLocalLikeEnv ? 'datcom-dev-session-secret' : '');

if (!SESSION_SECRET) {
  throw new Error('SESSION_SECRET is required in production');
}

if (!configuredSessionSecret) {
  console.warn('[Auth] SESSION_SECRET is missing. Using local development fallback secret.');
}

function toBase64Url(value) {
  return Buffer.from(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + pad, 'base64').toString('utf8');
}

function signSessionPayload(encodedPayload) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(encodedPayload).digest('base64url');
}

function buildSessionToken(payload) {
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signature = signSessionPayload(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

function parseSessionToken(token) {
  const rawToken = String(token || '').trim();
  if (!rawToken) return null;

  const [encodedPayload, signature] = rawToken.split('.');
  if (!encodedPayload || !signature) return null;
  if (signSessionPayload(encodedPayload) !== signature) return null;

  try {
    const payload = JSON.parse(fromBase64Url(encodedPayload));
    if (!payload || typeof payload !== 'object') return null;
    if (!payload.exp || Number(payload.exp) <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

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

function getUserSessionToken(req) {
  const cookies = parseCookies(req);
  return cookies.user_session || '';
}

function loadSessionUser(req, cookieName, expectedRole, callback) {
  const token = cookieName === 'admin_session' ? getAdminSessionToken(req) : getUserSessionToken(req);
  const session = parseSessionToken(token);
  if (!session || !session.id) {
    callback(null, null);
    return;
  }

  db.getUserById(session.id, (err, user) => {
    if (err) {
      callback(err);
      return;
    }

    if (!user) {
      callback(null, null);
      return;
    }

    const sessionVersion = Number(user.session_version || 1);
    if (Number(session.sv || 1) !== sessionVersion) {
      callback(null, null);
      return;
    }

    if (session.role !== user.role) {
      callback(null, null);
      return;
    }

    if (expectedRole && user.role !== expectedRole) {
      callback(null, null);
      return;
    }

    callback(null, {
      id: user.id,
      phone: user.phone,
      name: user.name,
      role: user.role,
      sessionVersion
    });
  });
}

function getUserSessionInfo(req, callback) {
  loadSessionUser(req, 'user_session', null, callback);
}

function requireAdminApiAuth(req, res, next) {
  loadSessionUser(req, 'admin_session', 'admin', (err, adminUser) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!adminUser) {
      return res.status(401).json({ error: 'UNAUTHORIZED_ADMIN' });
    }
    req.adminSession = adminUser;
    next();
  });
}

function requireAdminPageAuth(req, res, next) {
  loadSessionUser(req, 'admin_session', 'admin', (err, adminUser) => {
    if (err) {
      return res.redirect('/admin-login');
    }
    if (!adminUser) {
      return res.redirect('/admin-login');
    }
    req.adminSession = adminUser;
    next();
  });
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
  const promoCode = (req.body.promoCode || '').trim() || null;

  if (!normalizedCustomerName || !quantity) {
    return res.status(400).json({ error: 'Thieu thong tin bat buoc' });
  }

  getUserSessionInfo(req, (userErr, user) => {
    if (userErr) {
      return res.status(500).json({ error: userErr.message });
    }

    const userId = user ? user.id : null;

    db.getSettings(['debt_limit_enabled', 'debt_limit_servings', 'debt_limit_message'], (settingsErr, settings) => {
      if (settingsErr) {
        return res.status(500).json({ error: settingsErr.message });
      }

      const debtEnabled = settings.debt_limit_enabled === '1';
      const debtLimit = Number(settings.debt_limit_servings || 2);
      const debtMessage = settings.debt_limit_message || 'Vui long thanh toan no cu truoc khi dat com.';

      const proceedWithOrder = () => {
        db.addOrder(normalizedCustomerName, quantity, description || '', promoCode, userId, (err, order) => {
          if (err) {
            return res.status(400).json({ error: err.message });
          }

          db.getSettings(['consecutive_promo_enabled', 'consecutive_promo_days', 'consecutive_promo_discount'], (cpErr, cpSettings) => {
            if (cpErr || cpSettings.consecutive_promo_enabled !== '1') {
              return res.json(order);
            }

            const requiredDays = Number(cpSettings.consecutive_promo_days || 5);
            const discount = Number(cpSettings.consecutive_promo_discount || 50);

            db.getConsecutiveOrderDays(normalizedCustomerName, (daysErr, consecutiveDays) => {
              if (daysErr || consecutiveDays < requiredDays) {
                return res.json(order);
              }

              if (consecutiveDays % requiredDays !== 0) {
                return res.json(order);
              }

              db.createAutoPromoCode(normalizedCustomerName, discount, (promoErr, promoInfo) => {
                if (promoErr) {
                  return res.json(order);
                }
                res.json({
                  ...order,
                  bonus_promo: {
                    code: promoInfo.code,
                    discount: promoInfo.discountPercent,
                    message: `Chuc mung! Ban da dat com ${consecutiveDays} ngay lien tuc va duoc tang ma giam ${discount}%: ${promoInfo.code}`
                  }
                });
              });
            });
          });
        });
      };

      if (!debtEnabled) {
        return proceedWithOrder();
      }

      db.getCustomerUnpaidServings(normalizedCustomerName, (debtErr, debtInfo) => {
        if (debtErr) {
          return res.status(500).json({ error: debtErr.message });
        }

        if (debtInfo.unpaidServings >= debtLimit) {
          return res.status(400).json({ error: debtMessage });
        }

        proceedWithOrder();
      });
    });
  });
});

app.delete('/api/orders/:orderId', (req, res) => {
  getUserSessionInfo(req, (userErr, user) => {
    if (userErr) return res.status(500).json({ error: userErr.message });
    if (!user) return res.status(401).json({ error: 'Vui long dang nhap' });

    const { orderId } = req.params;
    db.getOrderById(orderId, (err, order) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!order) return res.status(404).json({ error: 'Khong tim thay don hang' });
      if (order.user_id !== user.id) return res.status(403).json({ error: 'Ban khong co quyen xoa don nay' });

      const createdAt = new Date(order.created_at + 'Z');
      const now = new Date();
      const diffMinutes = (now - createdAt) / 60000;
      if (diffMinutes > 30) {
        return res.status(400).json({ error: 'Da qua 30 phut, vui long nhan tin cho admin de xoa don.' });
      }

      db.deleteOrder(orderId, (delErr) => {
        if (delErr) return res.status(500).json({ error: delErr.message });
        res.json({ success: true });
      });
    });
  });
});

app.put('/api/orders/:orderId', (req, res) => {
  getUserSessionInfo(req, (userErr, user) => {
    if (userErr) return res.status(500).json({ error: userErr.message });
    if (!user) return res.status(401).json({ error: 'Vui long dang nhap' });

    const { orderId } = req.params;
    db.getOrderById(orderId, (err, order) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!order) return res.status(404).json({ error: 'Khong tim thay don hang' });
      if (order.user_id !== user.id) return res.status(403).json({ error: 'Ban khong co quyen sua don nay' });

      const quantity = Number(req.body.quantity || 0);
      const description = (req.body.description || '').toString();

      if (!Number.isFinite(quantity) || quantity <= 0) {
        return res.status(400).json({ error: 'So luong khong hop le' });
      }

      db.updateOrder(orderId, { name: order.name, quantity, description }, (updErr) => {
        if (updErr) return res.status(500).json({ error: updErr.message });
        res.json({ success: true });
      });
    });
  });
});

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

app.post('/api/feedback', (req, res) => {
  const message = String(req.body.message || '').trim();

  if (!message) {
    return res.status(400).json({ error: 'Vui lòng nhập nội dung góp ý' });
  }

  if (message.length > 2000) {
    return res.status(400).json({ error: 'Góp ý quá dài, vui lòng rút gọn dưới 2000 ký tự' });
  }

  db.createFeedback(message, (err, feedback) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    res.json({
      success: true,
      feedback
    });
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

app.get('/api/admin/customers/:name/full-history', (req, res) => {
  const customerName = normalizeName(decodeURIComponent(req.params.name || ''));
  if (!customerName) {
    return res.status(400).json({ error: 'Thiếu tên khách hàng hợp lệ' });
  }

  db.getCustomerFullOrderHistory(customerName, (err, data) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ customerName, ...data });
  });
});

app.get('/api/payments/today/:name/details', (req, res) => {
  const customerName = normalizeName(decodeURIComponent(req.params.name || ''));
  if (!customerName) {
    return res.status(400).json({ error: 'Thiếu tên khách hàng hợp lệ' });
  }

  db.getTodayCustomerOrderDetails(customerName, (err, data) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    res.json(data);
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
      const reusePending = await new Promise((resolve, reject) => {
        db.getLatestPendingPaymentRequest(name, (pendingErr, pendingRow) => {
          if (pendingErr) {
            reject(pendingErr);
            return;
          }
          resolve(pendingRow || null);
        });
      });

      if (reusePending && Number(reusePending.amount || 0) === Number(paymentInfo.remainingAmount || 0) && reusePending.checkout_url) {
        return res.json({
          paid: false,
          reused: true,
          paymentInfo,
          payos: {
            orderCode: Number(reusePending.order_code),
            amount: Number(reusePending.amount || 0),
            checkoutUrl: reusePending.checkout_url,
            qrCode: reusePending.qr_code || '',
            paymentLinkId: reusePending.payment_link_id || ''
          }
        });
      }

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

          db.supersedePendingPaymentRequests(name, orderCode, () => {
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

  db.getCustomerRemainingDebt(name, (paymentErr, paymentInfo) => {
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

// Admin: xóa lịch sử thanh toán
app.delete('/api/admin/payments/:orderCode', (req, res) => {
  const orderCode = Number(req.params.orderCode || 0);
  if (!orderCode) {
    return res.status(400).json({ error: 'Thiếu mã orderCode hợp lệ' });
  }

  db.deletePaymentRecord(orderCode, (err) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ success: true, orderCode });
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

// Bảng xếp hạng theo tháng
app.get('/api/leaderboard/monthly', (req, res) => {
  db.getMonthlyLeaderboard((err, data) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(data);
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
  loadSessionUser(req, 'admin_session', 'admin', (err, adminUser) => {
    if (!err && adminUser) {
      return res.redirect('/admin');
    }
    res.sendFile(path.join(__dirname, '../public/admin-login.html'));
  });
});
app.post('/api/admin/login', (req, res) => {
  const password = String(req.body.password || '');

  db.getUserByPhone('admin', (err, adminUser) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!adminUser) {
      return res.status(503).json({
        error: 'Chua co tai khoan admin. Hay set ADMIN_INITIAL_PASSWORD roi restart server hoac tao admin truoc trong DB.'
      });
    }
    if (!verifyPassword(password, adminUser.password_hash, adminUser.salt)) {
      return res.status(401).json({ error: 'Mat khau khong dung' });
    }

    const maxAgeSeconds = 28800;
    const sessionToken = buildSessionToken({
      id: adminUser.id,
      phone: adminUser.phone,
      name: adminUser.name,
      role: 'admin',
      sv: Number(adminUser.session_version || 1),
      exp: Date.now() + maxAgeSeconds * 1000
    });
    setSessionCookie(res, 'admin_session', sessionToken, maxAgeSeconds);
    res.json({ success: true });
  });
});

app.post('/api/admin/logout', (req, res) => {
  clearSessionCookie(res, 'admin_session');
  res.json({ success: true });
});

// =============================================
// Promo Code Validation (public)
// =============================================
app.post('/api/promo-codes/validate', (req, res) => {
  const code = String(req.body.code || '').trim();
  if (!code) {
    return res.json({ valid: false });
  }
  db.validatePromoCode(code, (err, promo) => {
    if (err || !promo) {
      return res.json({ valid: false });
    }
    res.json({ valid: true, discountPercent: promo.discount_percent });
  });
});

// =============================================
// Admin: Promo Codes
// =============================================
app.get('/api/admin/promo-codes', (req, res) => {
  db.getPromoCodes((err, codes) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(codes || []);
  });
});

app.post('/api/admin/promo-codes', (req, res) => {
  const code = String(req.body.code || '').trim();
  const discountPercent = Number(req.body.discountPercent || 0);
  if (!code || discountPercent <= 0 || discountPercent > 100) {
    return res.status(400).json({ error: 'Mã và phần trăm giảm giá không hợp lệ (1-100%)' });
  }
  db.createPromoCode(code, discountPercent, (err, promo) => {
    if (err) return res.status(400).json({ error: err.message });
    res.json(promo);
  });
});

app.delete('/api/admin/promo-codes/:id', (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) return res.status(400).json({ error: 'ID không hợp lệ' });
  db.deletePromoCode(id, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    res.json({ success: true });
  });
});

// =============================================
// Admin: User Management
// =============================================
app.get('/api/admin/users', (req, res) => {
  db.getUsers((err, users) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(users || []);
  });
});

app.post('/api/admin/users', (req, res) => {
  const phone = String(req.body.phone || '').trim();
  const name = normalizeName(req.body.name);
  const password = String(req.body.password || '');
  const role = String(req.body.role || 'user');

  if (!phone || !name || !password) {
    return res.status(400).json({ error: 'Vui lòng nhập đầy đủ số điện thoại, tên và mật khẩu' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Mật khẩu phải có ít nhất 6 ký tự' });
  }
  if (!['user', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'Vai trò không hợp lệ' });
  }

  const { hash, salt } = hashPassword(password);
  db.createUser(phone, name, hash, salt, role, (err, user) => {
    if (err) return res.status(400).json({ error: err.message });
    res.json(user);
  });
});

app.delete('/api/admin/users/:id', (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) return res.status(400).json({ error: 'ID không hợp lệ' });
  db.deleteUser(id, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    res.json({ success: true });
  });
});

app.put('/api/admin/users/:id/password', (req, res) => {
  const id = Number(req.params.id || 0);
  const password = String(req.body.password || '');
  if (!id || password.length < 6) {
    return res.status(400).json({ error: 'Mật khẩu phải có ít nhất 6 ký tự' });
  }
  const { hash, salt } = hashPassword(password);
  db.updateUserPassword(id, hash, salt, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// =============================================
// Admin Settings
// =============================================
app.get('/api/admin/settings', (req, res) => {
  db.getAllSettings((err, settings) => {
    if (err) return res.status(500).json({ error: err.message });
    const map = {};
    for (const s of settings) map[s.key] = s.value;
    res.json(map);
  });
});

app.get('/api/admin/feedback', (req, res) => {
  const search = String(req.query.search || '').trim();
  db.getFeedbacks(search, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows || []);
  });
});

app.put('/api/admin/settings', (req, res) => {
  const settings = req.body;
  if (!settings || typeof settings !== 'object') {
    return res.status(400).json({ error: 'Dữ liệu không hợp lệ' });
  }
  db.bulkUpdateSettings(settings, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// =============================================
// User Auth (Public - Optional login)
// =============================================
app.post('/api/auth/register', (req, res) => {
  const phone = String(req.body.phone || '').trim();
  const name = normalizeName(req.body.name);
  const password = String(req.body.password || '');
  if (!phone || !name || !password) {
    return res.status(400).json({ error: 'Vui long nhap day du thong tin' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Mat khau phai co it nhat 6 ky tu' });
  }
  const { hash, salt } = hashPassword(password);
  db.createUser(phone, name, hash, salt, 'user', (err, user) => {
    if (err) return res.status(400).json({ error: err.message });
    const maxAgeSeconds = 604800;
    const sessionToken = buildSessionToken({
      id: user.id,
      phone: user.phone,
      name: user.name,
      role: 'user',
      sv: Number(user.session_version || 1),
      exp: Date.now() + maxAgeSeconds * 1000
    });
    setSessionCookie(res, 'user_session', sessionToken, maxAgeSeconds);
    res.json({ success: true, user: { id: user.id, name: user.name, phone: user.phone } });
  });
});

app.post('/api/auth/login', (req, res) => {
  const phone = String(req.body.phone || '').trim();
  const password = String(req.body.password || '');
  if (!phone || !password) {
    return res.status(400).json({ error: 'Vui long nhap so dien thoai va mat khau' });
  }
  db.getUserByPhone(phone, (err, user) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!user) return res.status(401).json({ error: 'So dien thoai hoac mat khau khong dung' });
    if (!verifyPassword(password, user.password_hash, user.salt)) {
      return res.status(401).json({ error: 'So dien thoai hoac mat khau khong dung' });
    }
    const maxAgeSeconds = 604800;
    const sessionToken = buildSessionToken({
      id: user.id,
      phone: user.phone,
      name: user.name,
      role: user.role,
      sv: Number(user.session_version || 1),
      exp: Date.now() + maxAgeSeconds * 1000
    });
    setSessionCookie(res, 'user_session', sessionToken, maxAgeSeconds);
    res.json({ success: true, user: { id: user.id, name: user.name, phone: user.phone, role: user.role } });
  });
});

app.post('/api/auth/logout', (req, res) => {
  clearSessionCookie(res, 'user_session');
  res.json({ success: true });
});

app.get('/api/auth/me', (req, res) => {
  getUserSessionInfo(req, (err, user) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!user) return res.json({ loggedIn: false });
    res.json({ loggedIn: true, user });
  });
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

