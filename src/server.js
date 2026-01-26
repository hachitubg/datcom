const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const Database = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// Khởi tạo database
const db = new Database();

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
  const { name, quantity, description } = req.body;

  if (!name || !quantity) {
    return res.status(400).json({ error: 'Thiếu thông tin bắt buộc' });
  }

  db.addOrder(name, quantity, description || '', (err, order) => {
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
