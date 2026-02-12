require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const Database = require('./database');
const PayOSService = require('./payos');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// Khởi tạo database
const db = new Database();
const payos = new PayOSService();

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
        returnUrl: `${baseUrl}/?payment=success`,
        cancelUrl: `${baseUrl}/?payment=cancel`,
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

// Webhook PayOS cập nhật trạng thái thanh toán
app.post('/api/payments/webhook/payos',
  express.raw({ type: 'application/json' }),
  (req, res) => {
    const rawBody = req.body.toString();
    const parsedBody = JSON.parse(rawBody);

    const isValidSignature = payos.verifyWebhook(parsedBody);

    if (!isValidSignature) {
      console.log('❌ Invalid signature');
      return res.status(400).json({ error: 'Webhook signature không hợp lệ' });
    }

    const data = parsedBody.data || {};
    const orderCode = Number(data.orderCode);
    const amount = Number(data.amount || 0);

    db.markPaymentPaid(
      orderCode,
      {
        amount,
        raw: parsedBody
      },
      (err) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        res.json({ success: true });
      }
    );
  }
);

app.get('/api/payments/verify-return', async (req, res) => {
  if (!payos.isConfigured()) {
    return res.status(500).json({ error: 'PayOS chưa được cấu hình trên server' });
  }

  const orderCode = Number(req.query.orderCode || req.query.order_code || 0);
  if (!orderCode) {
    return res.status(400).json({ error: 'Thiếu mã đơn hàng (orderCode)' });
  }

  try {
    const paymentInfo = await payos.getPaymentLinkInformation(orderCode);
    const paidAmount = Number(paymentInfo.amountPaid || 0);
    const amount = Number(paymentInfo.amount || paidAmount || 0);
    const status = String(paymentInfo.status || '').toUpperCase();
    const paidStatuses = new Set(['PAID', 'SUCCESS', 'SUCCEEDED']);

    if (!paidStatuses.has(status) && paidAmount <= 0) {
      return res.json({ success: true, updated: false, status, amount, paidAmount });
    }

    db.markPaymentPaid(
      orderCode,
      {
        amount: paidAmount > 0 ? paidAmount : amount,
        reference: paymentInfo.reference || paymentInfo.paymentLinkId || '',
        transactionDateTime: paymentInfo.transactionDateTime || paymentInfo.transactionDate || '',
        code: paymentInfo.code || req.query.code || '',
        paymentLinkId: paymentInfo.paymentLinkId || '',
        raw: paymentInfo
      },
      (err) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        res.json({
          success: true,
          updated: true,
          status,
          amount,
          paidAmount: paidAmount > 0 ? paidAmount : amount
        });
      }
    );
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// Lịch sử thanh toán
app.get('/api/payments/history', (req, res) => {
  const search = (req.query.search || '').toString();
  db.getPaymentHistory(search, (err, rows) => {
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
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin.html'));
});

app.listen(PORT, () => {
  console.log(`Server chạy tại http://localhost:${PORT}`);
});
