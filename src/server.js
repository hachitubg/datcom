require('./load-env');
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');
const Database = require('./database');
const PayOSService = require('./payos');
const SiteRegistry = require('./site-registry');

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
        console.error('[PayOS Webhook] Chữ ký không hợp lệ');
        return res.status(400).json({ error: 'INVALID_SIGNATURE' });
      }

      const data = parsedBody.data;
      if (parsedBody.success === false || parsedBody.code !== '00' || data.code !== '00') {
        return res.status(200).json({ ok: true, ignored: true });
      }
      const orderCode = Number(data.orderCode);
      const amount = Number(data.amount || 0);
      if (!Number.isFinite(orderCode) || orderCode <= 0 || !Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ error: 'INVALID_PAYMENT_DATA' });
      }

      markPaymentPaidAcrossSites(orderCode, {
        amount,
        reference: data.reference || '',
        transactionDateTime: data.transactionDateTime || '',
        code: data.code || '',
        paymentLinkId: data.paymentLinkId || '',
        raw: parsedBody
      }, (err) => {
        if (err) {
          if (isPaymentRequestNotFoundError(err)) {
            console.warn(`[PayOS Webhook] Không tìm thấy orderCode=${orderCode}; có thể là webhook kiểm tra cấu hình.`);
            return res.status(200).json({ ok: true, ignored: true });
          }
          console.error('[PayOS Webhook] DB error:', err);
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
app.use(sitePrefixMiddleware);
app.use((req, res, next) => {
  if (req.path === '/admin.html') {
    return requireAdminPageAuth(req, res, next);
  }
  next();
});
app.use(express.static('public'));

// Khởi tạo database
const mainDb = new Database();
const siteRegistry = new SiteRegistry();
const siteDbBySlug = new Map();
const siteContext = new AsyncLocalStorage();
const db = new Proxy({}, {
  get(_target, prop) {
    const activeDb = getActiveDb();
    const value = activeDb[prop];
    return typeof value === 'function' ? value.bind(activeDb) : value;
  }
});
const payos = new PayOSService();

function getActiveDb() {
  return siteContext.getStore()?.db || mainDb;
}

function getSiteDb(site) {
  if (!site || !site.slug) {
    return mainDb;
  }

  if (!siteDbBySlug.has(site.slug)) {
    siteDbBySlug.set(site.slug, new Database(site.db_path));
  }

  return siteDbBySlug.get(site.slug);
}

function getAllSiteDatabases() {
  const databases = [mainDb];
  siteRegistry.listSites()
    .filter((site) => site.active)
    .forEach((site) => databases.push(getSiteDb(site)));
  return databases;
}

function getSiteBasePath(req) {
  const slug = req.site?.slug || siteContext.getStore()?.slug || '';
  return slug ? `/${slug}` : '';
}

function sitePrefixMiddleware(req, res, next) {
  const match = req.url.match(/^\/([a-z0-9-]+)(?=\/|\?|$)/i);
  if (!match) {
    return next();
  }

  const slug = siteRegistry.normalizeSlug(match[1]);
  const site = siteRegistry.getSite(slug);
  if (!site || !site.active) {
    return next();
  }

  const originalUrl = req.url;
  const siteBasePath = `/${site.slug}`;
  let rewrittenUrl = originalUrl.slice(siteBasePath.length) || '/';
  if (rewrittenUrl.startsWith('?')) {
    rewrittenUrl = `/${rewrittenUrl}`;
  }

  req.originalSiteUrl = originalUrl;
  req.site = site;
  req.siteBasePath = siteBasePath;
  req.url = rewrittenUrl;

  siteContext.run({ db: getSiteDb(site), slug: site.slug }, () => next());
}

function sitePath(req, targetPath) {
  return `${getSiteBasePath(req)}${targetPath}`;
}

function requireMainSite(req, res, next) {
  if (req.site) {
    return res.status(404).json({ error: 'NOT_FOUND' });
  }
  next();
}

function setSessionCookieForRequest(req, res, cookieName, token, maxAgeSeconds) {
  setSessionCookie(res, getScopedCookieName(req, cookieName), token, maxAgeSeconds);
}

function clearSessionCookieForRequest(req, res, cookieName) {
  clearSessionCookie(res, getScopedCookieName(req, cookieName));
}

function getScopedCookieName(req, cookieName) {
  const slug = req.site?.slug || '';
  return slug ? `${cookieName}_${slug}` : cookieName;
}

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
  return cookies[getScopedCookieName(req, 'admin_session')] || '';
}

function getUserSessionToken(req) {
  const cookies = parseCookies(req);
  return cookies[getScopedCookieName(req, 'user_session')] || '';
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
      return res.redirect(sitePath(req, '/admin-login'));
    }
    if (!adminUser) {
      return res.redirect(sitePath(req, '/admin-login'));
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

function normalizeCutoffTime(value) {
  const raw = String(value || '').trim();
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(raw) ? raw : '10:45';
}

function getOrderCutoffInfo(cutoffTime, now = new Date()) {
  const normalized = normalizeCutoffTime(cutoffTime);
  const [hours, minutes] = normalized.split(':').map(Number);
  const cutoff = new Date(now);
  cutoff.setHours(hours, minutes, 0, 0);

  const remainingSeconds = Math.max(0, Math.floor((cutoff.getTime() - now.getTime()) / 1000));
  return {
    cutoffTime: normalized,
    cutoffAt: cutoff.toISOString(),
    isOrderClosed: now.getTime() >= cutoff.getTime(),
    remainingSeconds
  };
}

function buildOrderCode() {
  return Number(`${Date.now().toString().slice(-9)}${crypto.randomInt(100000, 1000000)}`);
}

function getPublicBaseUrl(req) {
  const baseUrl = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
  return `${baseUrl.replace(/\/+$/, '')}${getSiteBasePath(req)}`;
}

function isPaymentRequestNotFoundError(error) {
  return error && String(error.message || '').includes('Khong tim thay yeu cau thanh toan');
}

function markPaymentPaidAcrossSites(orderCode, paymentData, callback) {
  const databases = getAllSiteDatabases();
  let index = 0;
  let lastError = null;

  const next = () => {
    if (index >= databases.length) {
      callback(lastError || new Error('Khong tim thay yeu cau thanh toan tuong ung'));
      return;
    }

    const database = databases[index++];
    database.markPaymentPaid(orderCode, paymentData, (err) => {
      if (!err) {
        callback(null);
        return;
      }
      lastError = err;
      if (isPaymentRequestNotFoundError(err)) {
        next();
        return;
      }
      callback(err);
    });
  };

  next();
}

function callDb(methodName, ...args) {
  return callDatabase(getActiveDb(), methodName, ...args);
}

function callDatabase(database, methodName, ...args) {
  return new Promise((resolve, reject) => {
    database[methodName](...args, (err, result) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(result);
    });
  });
}

function normalizeShopClosedSettings(settings = {}) {
  const reason = String(settings.shop_closed_reason || '').trim()
    || 'Hôm nay quán tạm đóng cửa, hẹn mọi người vào ngày mai nhé.';

  return {
    isClosed: settings.shop_closed_enabled === '1',
    reason
  };
}

async function getShopClosedStatus(database, settings = {}, date = database.getDateString()) {
  const scheduledClosure = await callDatabase(database, 'getShopClosureByDate', date);
  if (scheduledClosure) {
    return {
      isClosed: true,
      reason: scheduledClosure.reason,
      date: scheduledClosure.closure_date,
      source: 'schedule'
    };
  }
  return { ...normalizeShopClosedSettings(settings), date, source: 'manual' };
}

async function ensureConsecutivePromoForUser(
  user,
  settingsInput = null,
  database = getActiveDb(),
  throughDate = null
) {
  if (!user || !user.id) {
    return null;
  }

  const settings = settingsInput
    || await callDatabase(database, 'getSettings', ['consecutive_promo_enabled', 'consecutive_promo_days', 'consecutive_promo_discount']);

  if (settings.consecutive_promo_enabled !== '1') {
    return null;
  }

  const requiredDays = Math.max(2, Number(settings.consecutive_promo_days || 5));
  const discountPercent = Math.max(1, Math.min(100, Number(settings.consecutive_promo_discount || 50)));
  const activeDates = throughDate
    ? await callDatabase(database, 'getConsecutiveOrderDatesForUserThroughDate', user.id, throughDate)
    : await callDatabase(database, 'getActiveConsecutiveOrderDatesForUser', user.id);
  const currentDays = activeDates.length;
  const milestoneCount = Math.floor(Number(currentDays || 0) / requiredDays);
  const createdPromos = [];

  for (let index = 1; index <= milestoneCount; index++) {
    const streakDays = index * requiredDays;
    const earnedStreakDate = activeDates[currentDays - streakDays];
    const existing = await callDatabase(
      database,
      'getAutoPromoCodeByStreak',
      user.id,
      streakDays,
      earnedStreakDate
    );
    if (existing) {
      continue;
    }

    const promo = await callDatabase(
      database,
      'createAutoPromoCode',
      user.name,
      discountPercent,
      user.id,
      streakDays,
      earnedStreakDate
    );
    if (promo && !promo.existing) {
      createdPromos.push({ ...promo, earnedStreakDays: streakDays, earnedStreakDate });
    }
  }

  return {
    currentDays: Number(currentDays || 0),
    requiredDays,
    discountPercent,
    createdPromos
  };
}

const consecutivePromoBatchInProgress = new WeakSet();

function getVietnamBatchTime(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date).reduce((result, part) => {
    result[part.type] = part.value;
    return result;
  }, {});
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour || 0)
  };
}

async function runConsecutivePromoBatch(database) {
  if (consecutivePromoBatchInProgress.has(database)) return;
  consecutivePromoBatchInProgress.add(database);
  try {
    const batchTime = getVietnamBatchTime();
    const settings = await callDatabase(database, 'getSettings', [
      'consecutive_promo_enabled',
      'consecutive_promo_days',
      'consecutive_promo_discount',
      'consecutive_promo_last_batch_date'
    ]);
    if (settings.consecutive_promo_enabled !== '1'
      || batchTime.hour < 6
      || settings.consecutive_promo_last_batch_date === batchTime.date) {
      return;
    }

    const users = await callDatabase(database, 'getUsers');
    const throughDate = await callDatabase(database, 'getPreviousOpenBusinessDate', batchTime.date);
    let createdCount = 0;
    for (const user of users.filter((item) => item.role === 'user')) {
      const result = await ensureConsecutivePromoForUser(user, settings, database, throughDate);
      createdCount += result?.createdPromos?.length || 0;
    }
    await callDatabase(database, 'updateSetting', 'consecutive_promo_last_batch_date', batchTime.date);
    console.log(`[Consecutive Promo Batch] ${database.dbPath}: created ${createdCount} promo(s) for ${batchTime.date}`);
  } catch (err) {
    console.error(`[Consecutive Promo Batch] ${database.dbPath}:`, err.message);
  } finally {
    consecutivePromoBatchInProgress.delete(database);
  }
}

function runConsecutivePromoBatchAcrossSites() {
  for (const database of getAllSiteDatabases()) {
    runConsecutivePromoBatch(database);
  }
}

async function syncOrderCodeFromPayOS(orderCode, database = getActiveDb()) {
  const paymentInfo = await payos.getPaymentLinkInformation(orderCode);
  const paidAmount = Number(paymentInfo.amountPaid || 0);
  const amount = Number(paymentInfo.amount || paidAmount || 0);
  const status = String(paymentInfo.status || '').toUpperCase();
  const paidStatuses = PAID_PAYMENT_STATUSES;
  const transactions = Array.isArray(paymentInfo.transactions) ? paymentInfo.transactions : [];
  const latestTransaction = transactions.slice().sort((a, b) => (
    String(b.transactionDateTime || '').localeCompare(String(a.transactionDateTime || ''))
  ))[0] || {};

  if (paidStatuses.has(status) || paidAmount > 0) {
    return new Promise((resolve, reject) => {
      database.markPaymentPaid(
        orderCode,
        {
          amount: paidAmount > 0 ? paidAmount : amount,
          reference: latestTransaction.reference || paymentInfo.reference || paymentInfo.paymentLinkId || paymentInfo.id || '',
          transactionDateTime: latestTransaction.transactionDateTime || paymentInfo.transactionDateTime || paymentInfo.transactionDate || '',
          code: paymentInfo.code || '',
          paymentLinkId: paymentInfo.paymentLinkId || paymentInfo.id || '',
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
      database.updatePaymentRequestStatus(orderCode, status, (err) => {
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
const paymentCreationLocks = new WeakMap();

function acquirePaymentCreationLock(database, customerName) {
  if (!paymentCreationLocks.has(database)) paymentCreationLocks.set(database, new Set());
  const locks = paymentCreationLocks.get(database);
  const key = database.getSearchKey(customerName);
  if (locks.has(key)) return null;
  locks.add(key);
  return () => locks.delete(key);
}

function isPayOSPaymentNotFoundError(error) {
  const message = String(error?.message || '').toLowerCase();
  return error?.statusCode === 404
    || message.includes('mã thanh toán không tồn tại')
    || message.includes('payment link not found');
}

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
    let updatedCount = 0;
    for (const database of getAllSiteDatabases()) {
      const pendingRows = await new Promise((resolve, reject) => {
        database.getSyncablePaymentRequests(25, (err, rows = []) => {
          if (err) {
            reject(err);
            return;
          }

          resolve(rows);
        });
      });

      for (const row of pendingRows) {
        try {
          const result = await syncOrderCodeFromPayOS(Number(row.order_code), database);
          if (result && result.updated) {
            updatedCount += 1;
            console.log(`[PayOS Sync] Updated PAID for orderCode=${row.order_code}`);
          }
        } catch (orderErr) {
          if (isPayOSPaymentNotFoundError(orderErr)) {
            await callDatabase(database, 'updatePaymentRequestStatus', row.order_code, 'NOT_FOUND');
            console.warn(`[PayOS Sync] Marked NOT_FOUND for orderCode=${row.order_code}`);
            await new Promise((resolve) => setTimeout(resolve, 1200));
            continue;
          }
          console.error(`[PayOS Sync] Failed orderCode=${row.order_code}:`, orderErr.message);
        }
        await new Promise((resolve) => setTimeout(resolve, 1200));
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
    db.getSettings(['order_cutoff_time', 'shop_closed_enabled', 'shop_closed_reason'], async (settingsErr, settings) => {
      if (settingsErr) {
        return res.status(500).json({ error: settingsErr.message });
      }

      try {
        const cutoffTime = normalizeCutoffTime(settings.order_cutoff_time);
        const shopClosed = await getShopClosedStatus(db, settings);
        res.json({
          ...data,
          orderCutoffTime: cutoffTime,
          orderCutoff: getOrderCutoffInfo(cutoffTime),
          shopClosed
        });
      } catch (closureErr) {
        res.status(500).json({ error: closureErr.message });
      }
    });
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

    db.getSettings([
      'order_cutoff_time',
      'shop_closed_enabled',
      'shop_closed_reason',
      'debt_limit_enabled',
      'debt_limit_servings',
      'debt_limit_message'
    ], async (settingsErr, settings) => {
      if (settingsErr) {
        return res.status(500).json({ error: settingsErr.message });
      }

      let shopClosed;
      try {
        shopClosed = await getShopClosedStatus(db, settings);
      } catch (closureErr) {
        return res.status(500).json({ error: closureErr.message });
      }
      if (shopClosed.isClosed) {
        return res.status(400).json({
          error: `Hôm nay quán tạm đóng cửa. ${shopClosed.reason}`
        });
      }

      const cutoffTime = normalizeCutoffTime(settings.order_cutoff_time);
      if (getOrderCutoffInfo(cutoffTime).isOrderClosed) {
        return res.status(400).json({
          error: `Đã quá giờ đặt cơm hôm nay (${cutoffTime}). Vui lòng đặt trước giờ chốt.`
        });
      }

      const debtEnabled = settings.debt_limit_enabled === '1';
      const debtLimit = Number(settings.debt_limit_servings || 2);
      const debtMessage = settings.debt_limit_message || 'Vui long thanh toan no cu truoc khi dat com.';

      const proceedWithOrder = () => {
        db.addOrder(normalizedCustomerName, quantity, description || '', promoCode, userId, (err, order) => {
          if (err) {
            return res.status(400).json({ error: err.message });
          }

          // Consecutive promotions are issued only by the daily 06:00 batch.
          res.json(order);
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
      if (order.date !== db.getDateString()) {
        return res.status(400).json({ error: 'Chi co the xoa don dat com cua ngay hom nay' });
      }

      db.deleteOrder(orderId, 'user', (delErr) => {
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
      if (order.date !== db.getDateString()) {
        return res.status(400).json({ error: 'Chi co the sua don dat com cua ngay hom nay' });
      }

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
  const { quantity, cutoffTime } = req.body;
  if (!quantity || quantity < 1) {
    return res.status(400).json({ error: 'Số lượng không hợp lệ' });
  }

  const normalizedCutoffTime = cutoffTime ? normalizeCutoffTime(cutoffTime) : null;
  if (cutoffTime && normalizedCutoffTime !== String(cutoffTime).trim()) {
    return res.status(400).json({ error: 'Giờ chốt không hợp lệ' });
  }

  db.updateTodayQuantity(quantity, (err) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    if (!normalizedCutoffTime) {
      return res.json({ success: true });
    }

    db.updateSetting('order_cutoff_time', normalizedCutoffTime, (settingErr) => {
      if (settingErr) {
        return res.status(500).json({ error: settingErr.message });
      }
      res.json({ success: true, orderCutoffTime: normalizedCutoffTime });
    });
  });
});

// Xóa đơn hàng
app.delete('/api/admin/orders/:orderId', (req, res) => {
  const { orderId } = req.params;
  db.deleteOrder(orderId, 'admin', (err) => {
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

  const activeDatabase = getActiveDb();
  const releasePaymentCreationLock = acquirePaymentCreationLock(activeDatabase, name);
  if (!releasePaymentCreationLock) {
    return res.status(409).json({
      error: 'Hệ thống đang tạo mã thanh toán cho khách này. Vui lòng chờ trong giây lát.'
    });
  }
  let paymentLockReleased = false;
  const releaseOnce = () => {
    if (paymentLockReleased) return;
    paymentLockReleased = true;
    releasePaymentCreationLock();
  };
  res.once('finish', releaseOnce);
  res.once('close', releaseOnce);

  db.getTodayCustomerPayment(name, async (err, paymentInfo) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }

    let activePaymentInfo = paymentInfo;
    const refreshPaymentInfo = () => callDb('getTodayCustomerPayment', name);

    if (activePaymentInfo.remainingAmount <= 0) {
      return res.json({
        paid: true,
        message: 'Đơn này đã thanh toán đủ.',
        paymentInfo: activePaymentInfo
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

      let canReusePending = Boolean(reusePending);
      if (reusePending) {
        try {
          const syncResult = await syncOrderCodeFromPayOS(Number(reusePending.order_code));
          const syncStatus = String(syncResult?.status || '').toUpperCase();

          if (syncResult?.updated || PAID_PAYMENT_STATUSES.has(syncStatus)) {
            activePaymentInfo = await refreshPaymentInfo();
            if (activePaymentInfo.remainingAmount <= 0) {
              return res.json({
                paid: true,
                message: 'Đơn này đã thanh toán đủ.',
                paymentInfo: activePaymentInfo
              });
            }
          }

          canReusePending = !['CANCELLED', 'EXPIRED'].includes(syncStatus)
            && !PAID_PAYMENT_STATUSES.has(syncStatus);
        } catch (syncErr) {
          console.error(`[PayOS] Không kiểm tra được link pending ${reusePending.order_code}:`, syncErr.message);
          const createdAt = Date.parse(`${String(reusePending.created_at || '').replace(' ', 'T')}Z`);
          const pendingAgeMs = Number.isFinite(createdAt) ? Date.now() - createdAt : Infinity;
          canReusePending = pendingAgeMs < 14 * 60 * 1000;
        }
      }

      if (canReusePending
        && Number(reusePending.amount || 0) === Number(activePaymentInfo.remainingAmount || 0)
        && reusePending.checkout_url) {
        return res.json({
          paid: false,
          reused: true,
          paymentInfo: activePaymentInfo,
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
        amount: activePaymentInfo.remainingAmount,
        description: `DATCOM ${name}`.slice(0, 25),
        returnUrl: `${baseUrl}/?payment=success&orderCode=${orderCode}`,
        cancelUrl: `${baseUrl}/?payment=cancel&orderCode=${orderCode}`,
        buyerName: name,
        expiredAt: Math.floor(Date.now() / 1000) + 15 * 60
      };

      const payosLink = await payos.createPaymentLink(payload);
      db.createPaymentRequest(
        {
          dayId: activePaymentInfo.dayId,
          customerName: name,
          orderCode,
          amount: activePaymentInfo.remainingAmount,
          paymentLinkId: payosLink.paymentLinkId,
          checkoutUrl: payosLink.checkoutUrl,
          qrCode: payosLink.qrCode
        },
        (saveErr) => {
          if (saveErr) {
            return res.status(500).json({ error: saveErr.message });
          }

          db.supersedePendingPaymentRequests(name, orderCode, (supersedeErr) => {
            if (supersedeErr) {
              return res.status(500).json({ error: supersedeErr.message });
            }
            res.json({
              paid: false,
              paymentInfo: activePaymentInfo,
              payos: {
                orderCode,
                amount: activePaymentInfo.remainingAmount,
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

app.get('/api/consecutive-promo/status', (req, res) => {
  db.getSettings(['consecutive_promo_enabled', 'consecutive_promo_days', 'consecutive_promo_discount'], (settingsErr, settings) => {
    if (settingsErr) {
      return res.status(500).json({ error: settingsErr.message });
    }

    const enabled = settings.consecutive_promo_enabled === '1';
    const requiredDays = Number(settings.consecutive_promo_days || 5);
    const discountPercent = Number(settings.consecutive_promo_discount || 50);

    if (!enabled) {
      return res.json({
        enabled: false,
        requiredDays,
        discountPercent,
        loggedIn: false,
        currentDays: 0,
        remainingDays: requiredDays
      });
    }

    getUserSessionInfo(req, (userErr, user) => {
      if (userErr) {
        return res.status(500).json({ error: userErr.message });
      }

      if (!user) {
        return res.json({
          enabled: true,
          requiredDays,
          discountPercent,
          loggedIn: false,
          currentDays: 0,
          remainingDays: requiredDays
        });
      }

      callDb('getConsecutiveOrderDaysForUser', user.id)
        .then((currentDays) => {
        res.json({
          enabled: true,
          requiredDays,
          discountPercent,
          loggedIn: true,
          currentDays,
          remainingDays: Math.max(0, requiredDays - (currentDays % requiredDays || (currentDays >= requiredDays ? requiredDays : 0))),
          newPromoCount: 0
        });
        })
        .catch((daysErr) => {
          res.status(500).json({ error: daysErr.message });
        });
    });
  });
});

app.get('/api/promo-wallet', (req, res) => {
  getUserSessionInfo(req, (userErr, user) => {
    if (userErr) {
      return res.status(500).json({ error: userErr.message });
    }
    if (!user) {
      return res.status(401).json({ error: 'Vui lòng đăng nhập để xem mã khuyến mãi' });
    }

    db.getPromoWalletForUser(user.id, (err, rows = []) => {
          if (err) {
            return res.status(500).json({ error: err.message });
          }

          const codes = rows.map((row) => ({
            id: row.id,
            code: row.code,
            discountPercent: Number(row.discount_percent || 0),
            createdAt: row.created_at,
            usedAt: row.used_at,
            used: Boolean(row.used_by),
            source: row.source || 'manual',
            earnedStreakDays: Number(row.earned_streak_days || 0),
            earnedStreakDate: row.earned_streak_date || null,
            seen: Boolean(row.promo_seen_at)
          }));

          res.json({
            codes,
            unseenCount: codes.filter((code) => !code.seen && !code.used).length
          });
    });
  });
});

app.post('/api/promo-wallet/mark-seen', (req, res) => {
  getUserSessionInfo(req, (userErr, user) => {
    if (userErr) {
      return res.status(500).json({ error: userErr.message });
    }
    if (!user) {
      return res.status(401).json({ error: 'Vui lòng đăng nhập để xem mã khuyến mãi' });
    }

    db.markPromoWalletSeen(user.id, (err) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json({ success: true });
    });
  });
});

// Bảng xếp hạng theo tháng
app.get('/api/leaderboard/monthly', (req, res) => {
  const month = String(req.query.month || '').trim();
  if (month && !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: 'Tháng không hợp lệ' });
  }

  db.getMonthlyLeaderboard(month, (err, data) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(data);
  });
});

// Super admin: quản lý các site phụ
app.get('/admin2', requireMainSite, requireAdminPageAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin2.html'));
});

app.get('/api/admin2/sites', requireMainSite, requireAdminApiAuth, (req, res) => {
  res.json(siteRegistry.listSites());
});

app.post('/api/admin2/sites', requireMainSite, requireAdminApiAuth, (req, res) => {
  const name = String(req.body.name || '').trim();
  const slug = String(req.body.slug || '').trim();
  const adminPassword = String(req.body.adminPassword || '');

  if (!name || !slug || adminPassword.length < 6) {
    return res.status(400).json({ error: 'Vui lòng nhập tên site, slug và mật khẩu admin tối thiểu 6 ký tự' });
  }

  let site;
  try {
    site = siteRegistry.createSite({ name, slug });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  const siteDb = getSiteDb(site);
  const { hash, salt } = hashPassword(adminPassword);
  siteDb.createUser('admin', 'Admin', hash, salt, 'admin', (err) => {
    if (err) {
      return res.status(500).json({ error: `Đã tạo site nhưng chưa tạo được admin: ${err.message}` });
    }
    res.json({
      ...site,
      url_path: `/${site.slug}`,
      admin_path: `/${site.slug}/admin`
    });
  });
});

app.put('/api/admin2/sites/:slug/status', requireMainSite, requireAdminApiAuth, (req, res) => {
  try {
    const site = siteRegistry.updateSiteStatus(req.params.slug, Boolean(req.body.active));
    res.json({
      ...site,
      url_path: `/${site.slug}`,
      admin_path: `/${site.slug}/admin`
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
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
      return res.redirect(sitePath(req, '/admin'));
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
    setSessionCookieForRequest(req, res, 'admin_session', sessionToken, maxAgeSeconds);
    res.json({ success: true });
  });
});

app.post('/api/admin/logout', (req, res) => {
  clearSessionCookieForRequest(req, res, 'admin_session');
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

    const promoOwnerId = Number(promo.issued_to_user_id || 0);
    if (!promoOwnerId) {
      return res.json({ valid: true, discountPercent: promo.discount_percent });
    }

    getUserSessionInfo(req, (userErr, user) => {
      if (userErr || !user || Number(user.id) !== promoOwnerId) {
        return res.json({
          valid: false,
          reason: 'Mã này chỉ dùng được trên tài khoản được tặng'
        });
      }

      res.json({ valid: true, discountPercent: promo.discount_percent });
    });
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
  const issuedToUserId = Number(req.body.issuedToUserId || 0);
  if (!code || discountPercent <= 0 || discountPercent > 100) {
    return res.status(400).json({ error: 'Mã và phần trăm giảm giá không hợp lệ (1-100%)' });
  }
  const createPromo = (user) => {
    db.createPromoCode(
      code,
      discountPercent,
      user ? { issuedToUserId: user.id, issuedToName: user.name } : {},
      (err, promo) => {
        if (err) return res.status(400).json({ error: err.message });
        res.json(promo);
      }
    );
  };

  if (!issuedToUserId) {
    createPromo(null);
    return;
  }

  db.getUserById(issuedToUserId, (userErr, user) => {
    if (userErr) return res.status(500).json({ error: userErr.message });
    if (!user || user.role !== 'user') {
      return res.status(400).json({ error: 'Tài khoản nhận mã không hợp lệ' });
    }
    createPromo(user);
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
    db.getShopClosureByDate(db.getDateString(), (closureErr, closure) => {
      if (closureErr) return res.status(500).json({ error: closureErr.message });
      map.shop_closed_enabled = closure ? '1' : '0';
      if (closure) {
        map.shop_closed_reason = closure.reason;
      }
      res.json(map);
    });
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
  const shouldCloseToday = settings.shop_closed_enabled === '1';
  const closureReason = String(settings.shop_closed_reason || '').trim();
  if (shouldCloseToday && (!closureReason || closureReason.length > 500)) {
    return res.status(400).json({ error: 'Vui lòng nhập lý do nghỉ (tối đa 500 ký tự)' });
  }

  const today = db.getDateString();
  const settingsToSave = {
    ...settings,
    shop_closed_enabled: '0',
    shop_closed_reason: closureReason || 'Hôm nay quán tạm đóng cửa, hẹn mọi người vào ngày mai nhé.'
  };
  db.bulkUpdateSettings(settingsToSave, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    const onClosureSaved = (closureErr) => {
      if (closureErr) return res.status(500).json({ error: closureErr.message });
      db.updateSetting('consecutive_promo_last_batch_date', '', (settingErr) => {
        if (settingErr) return res.status(500).json({ error: settingErr.message });
        runConsecutivePromoBatch(db);
        res.json({ success: true, shopClosedToday: shouldCloseToday });
      });
    };
    if (shouldCloseToday) {
      db.upsertShopClosureRange(today, today, closureReason, onClosureSaved);
    } else {
      db.deleteShopClosureDate(today, onClosureSaved);
    }
  });
});

app.get('/api/admin/shop-closures', (req, res) => {
  const parsedPage = Number(req.query.page);
  const parsedLimit = Number(req.query.limit);
  const page = Number.isFinite(parsedPage) ? Math.max(1, Math.floor(parsedPage)) : 1;
  const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(50, Math.floor(parsedLimit))) : 10;
  db.getShopClosureDates(page, limit, (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(result);
  });
});

app.post('/api/admin/shop-closures', (req, res) => {
  const startDate = String(req.body.startDate || '').trim();
  const endDate = String(req.body.endDate || startDate).trim();
  const reason = String(req.body.reason || '').trim();
  const validDate = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  };
  if (!validDate(startDate) || !validDate(endDate) || startDate > endDate) {
    return res.status(400).json({ error: 'Khoảng ngày nghỉ không hợp lệ' });
  }
  if (!reason || reason.length > 500) {
    return res.status(400).json({ error: 'Vui lòng nhập lý do nghỉ (tối đa 500 ký tự)' });
  }

  db.upsertShopClosureRange(startDate, endDate, reason, (err, result) => {
    if (err) return res.status(400).json({ error: err.message });
    db.updateSetting('consecutive_promo_last_batch_date', '', (settingErr) => {
      if (settingErr) return res.status(500).json({ error: settingErr.message });
      runConsecutivePromoBatch(db);
      res.json({ success: true, count: result.count });
    });
  });
});

app.delete('/api/admin/shop-closures/:date', (req, res) => {
  const date = String(req.params.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Ngày nghỉ không hợp lệ' });
  }
  db.deleteShopClosureDate(date, (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    db.updateSetting('consecutive_promo_last_batch_date', '', (settingErr) => {
      if (settingErr) return res.status(500).json({ error: settingErr.message });
      runConsecutivePromoBatch(db);
      res.json({ success: true, deleted: result.deleted });
    });
  });
});

// =============================================
// Game Scores
// =============================================
app.post('/api/game/score', (req, res) => {
  getUserSessionInfo(req, (err, user) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!user) return res.status(401).json({ error: 'Chưa đăng nhập' });
    const score = parseInt(req.body.score, 10) || 0;
    const level = parseInt(req.body.level, 10) || 1;
    const caught = parseInt(req.body.caught, 10) || 0;
    if (score < 0 || level < 1 || level > 10 || caught < 0) {
      return res.status(400).json({ error: 'Dữ liệu không hợp lệ' });
    }
    db.saveGameScore(user.id, score, level, caught, (err2, result) => {
      if (err2) return res.status(500).json({ error: err2.message });
      res.json({ success: true, best: result.best });
    });
  });
});

app.get('/api/game/leaderboard', (req, res) => {
  db.getGameLeaderboard((err, leaders) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ leaders });
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
    setSessionCookieForRequest(req, res, 'user_session', sessionToken, maxAgeSeconds);
    res.json({ success: true, user: { id: user.id, name: user.name, phone: user.phone } });
  });
});

app.get('/api/admin/consecutive-streaks', (req, res) => {
  db.getSettings([
    'consecutive_promo_enabled',
    'consecutive_promo_days',
    'consecutive_promo_discount',
    'consecutive_promo_last_batch_date'
  ], (settingsErr, settings) => {
    if (settingsErr) return res.status(500).json({ error: settingsErr.message });
    const requiredDays = Math.max(2, Number(settings.consecutive_promo_days || 5));
    db.getConsecutivePromoOverview(requiredDays, (overviewErr, rows) => {
      if (overviewErr) return res.status(500).json({ error: overviewErr.message });
      res.json({
        enabled: settings.consecutive_promo_enabled === '1',
        requiredDays,
        discountPercent: Number(settings.consecutive_promo_discount || 50),
        lastBatchDate: settings.consecutive_promo_last_batch_date || null,
        rows
      });
    });
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
    setSessionCookieForRequest(req, res, 'user_session', sessionToken, maxAgeSeconds);
    res.json({ success: true, user: { id: user.id, name: user.name, phone: user.phone, role: user.role } });
  });
});

app.post('/api/auth/logout', (req, res) => {
  clearSessionCookieForRequest(req, res, 'user_session');
  res.json({ success: true });
});

app.put('/api/auth/me/name', (req, res) => {
  const newName = normalizeName(req.body.name);
  if (!newName) {
    return res.status(400).json({ error: 'Vui lòng nhập họ và tên' });
  }

  getUserSessionInfo(req, (sessionErr, user) => {
    if (sessionErr) {
      return res.status(500).json({ error: sessionErr.message });
    }
    if (!user) {
      return res.status(401).json({ error: 'Vui lòng đăng nhập lại' });
    }

    db.updateUserName(user.id, newName, (updateErr, result) => {
      if (updateErr) {
        return res.status(500).json({ error: updateErr.message });
      }
      res.json({ success: true, ...result });
    });
  });
});

app.get('/api/auth/me', (req, res) => {
  getUserSessionInfo(req, (err, user) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!user) return res.json({ loggedIn: false });
    res.json({ loggedIn: true, user });
  });
});

const configuredPayOSAutoSyncMs = Number(process.env.PAYOS_AUTO_SYNC_MS || 60000);
const payosAutoSyncMs = Number.isFinite(configuredPayOSAutoSyncMs)
  ? Math.max(60000, configuredPayOSAutoSyncMs)
  : 60000;
if (payos.isConfigured()) {
  setTimeout(() => {
    syncPendingPaymentsFromPayOS();
  }, 5000);

  setInterval(() => {
    syncPendingPaymentsFromPayOS();
  }, payosAutoSyncMs);
}

if (process.env.NODE_ENV !== 'test') {
  setTimeout(runConsecutivePromoBatchAcrossSites, 5000);
  setInterval(runConsecutivePromoBatchAcrossSites, 60000);
}

app.listen(PORT, () => {
  console.log(`Server chạy tại http://localhost:${PORT}`);
  if (payos.isConfigured()) {
    console.log(`PayOS auto-sync pending payments mỗi ${payosAutoSyncMs}ms`);
  }
});

