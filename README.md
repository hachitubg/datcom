# 🍚 Website Đặt Cơm Online

Website quản lý đặt cơm đơn giản, dễ dàng triển khai.

## 🛠️ Công Nghệ Stack

| Layer | Công Nghệ |
|-------|-----------|
| **Frontend** | HTML, CSS, JavaScript (Static Files) |
| **Backend** | Node.js + Express.js |
| **Database** | SQLite (datcom.db) |
| **Chạy Trên** | localhost:3000 (hoặc PORT env var) |

## 💳 Cấu hình thanh toán PayOS

Tính năng thanh toán yêu cầu cấu hình biến môi trường trước khi chạy server:

```bash
export PAYOS_CLIENT_ID="your-client-id"
export PAYOS_API_KEY="your-api-key"
export PAYOS_CHECKSUM_KEY="your-checksum-key"
# optional: URL public để return/cancel URL chính xác
export PUBLIC_BASE_URL="https://your-domain.com"
```

### Webhook PayOS

- Endpoint webhook của ứng dụng: `POST /api/payments/webhook/payos`
- Cấu hình endpoint này trong dashboard PayOS để hệ thống tự động cập nhật trạng thái thanh toán đơn cơm sau khi khách chuyển khoản thành công.

## ��� Tính Năng

- **Trang chủ**: Hiển thị menu hôm nay, giá cơm (40.000 VNĐ), số lượng xuất còn lại
- **Đặt cơm**: Form với họ tên, số lượng, ghi chú
- **Danh sách đơn**: Xem tất cả đơn hàng theo thứ tự thời gian
- **Quản lý Admin**: Cập nhật menu, số lượng, xóa đơn, xem lịch sử

## ��� Quản Lý Server Trên Host

### Kiểm Tra Database

```bash
# Tìm file database
find /var/www/datcom -name "*.db" -type f

# Kiểm tra kích thước
ls -lh /var/www/datcom/datcom.db
```

### Reset Database

```bash
# Xóa database cũ
rm /var/www/datcom/datcom.db

# Restart server (sẽ tạo database mới)
pm2 restart datcom
```

### Restart Server

```bash
# Restart server
pm2 restart datcom

# Xem log
pm2 logs datcom

# Dừng server
pm2 stop datcom

# Khởi động server
pm2 start datcom
```

### Pull code mới trên host + restart đúng cách

> Khuyến nghị: dùng `npm ci` thay vì `npm install` để tránh làm thay đổi `package-lock.json` trên host.

```bash
# 1) Vào project
cd /var/www/datcom

# 2) Kiểm tra có file local thay đổi không
git status

# 3) Nếu package-lock.json đang bị sửa local do npm install trước đó:
git restore package-lock.json

# 4) Pull code mới
git pull origin <ten-branch>

# 5) Cài đúng dependency theo lockfile
npm ci --omit=dev

# 6) Restart app
pm2 restart datcom

# 7) Kiểm tra log
pm2 logs datcom --lines 100
```

Nếu `git pull` báo conflict riêng file `package-lock.json`, ưu tiên lấy lockfile mới từ repo:

```bash
git checkout --theirs package-lock.json
git add package-lock.json
git commit -m "Resolve package-lock conflict with repository version"
```

Sau đó chạy lại:

```bash
npm ci --omit=dev
pm2 restart datcom
```

### Backup Database

```bash
cp /var/www/datcom/datcom.db /var/www/datcom/datcom.db.backup
```

## ��� Truy Cập

- Trang chủ: http://103.200.20.160
- Admin: http://103.200.20.160/admin

---

**Code trên GitHub | Nginx + Port 3000**
