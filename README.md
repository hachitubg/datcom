# Website Đặt Cơm (Hướng dẫn nhanh)

## 1) Chạy website ở localhost để test

```bash
# Cài dependencies
npm install

# (Khuyến nghị) tạo file .env ở thư mục gốc project
cat > .env <<'EOF'
PORT=3000
PUBLIC_BASE_URL=http://localhost:3000
# PAYOS_CLIENT_ID=your-client-id
# PAYOS_API_KEY=your-api-key
# PAYOS_CHECKSUM_KEY=your-checksum-key
EOF

# Chạy server (mặc định http://localhost:3000)
npm start
```

Mở trình duyệt:
- Trang khách: `http://localhost:3000`
- Trang admin: `http://localhost:3000/admin`

> Nếu dùng thanh toán PayOS, cần set biến môi trường trước khi chạy:

```bash
export PAYOS_CLIENT_ID="your-client-id"
export PAYOS_API_KEY="your-api-key"
export PAYOS_CHECKSUM_KEY="your-checksum-key"
export PUBLIC_BASE_URL="http://localhost:3000"
```

---

## 2) Deploy và cách build lại khi có code mới

```bash
# 1) Vào thư mục project trên server
cd /var/www/datcom

# 2) Lấy code mới
git pull

# 3) Cài đúng dependency theo lockfile
npm ci --omit=dev

# 4) Restart app bằng PM2
pm2 restart datcom

# 5) Kiểm tra log
pm2 logs datcom --lines 100
```

Ghi chú ngắn:
- Dự án này là Node.js server (không có bước build frontend riêng).
- Mỗi lần có code mới: `git pull` → `npm ci --omit=dev` → `pm2 restart datcom`.

---

## 3) Kiểm tra, backup, restore Database + lệnh hay dùng

### Kiểm tra database

```bash
# Kiểm tra file DB
ls -lh /var/www/datcom/datcom.db

# Xem nhanh bảng trong DB
sqlite3 /var/www/datcom/datcom.db ".tables"
```

### Backup database

```bash
# Tạo file backup kèm thời gian
cp /var/www/datcom/datcom.db /var/www/datcom/datcom.db.backup-$(date +%F-%H%M%S)
```

### Restore từ file backup

```bash
# Ví dụ restore từ 1 file backup cụ thể
cp /var/www/datcom/datcom.db.backup-2026-02-12-234028 /var/www/datcom/datcom.db

# Restart app sau khi restore
pm2 restart datcom
```

### Một số lệnh SQLite hay dùng

```bash
# Mở DB
sqlite3 /var/www/datcom/datcom.db

# Trong màn hình sqlite3:
.tables
.schema
SELECT * FROM orders ORDER BY id DESC LIMIT 20;
.quit
```


### Lỗi thường gặp

- **`Error: Cannot find module 'dotenv'`**
  - Dự án đã chuyển sang loader nội bộ (`src/load-env.js`) để đọc file `.env`, nên không cần cài package `dotenv`.
  - Nếu gặp lỗi này, hãy pull code mới nhất rồi chạy lại:

```bash
git pull
npm install
npm start
```

## 4) Cập nhật Admin: đơn giản hơn cho PC + mobile

Admin được tách rõ 3 khu vực để dễ dùng:

- **Danh sách đặt cơm** (màn hình đầu tiên):
  - Mặc định hiển thị đơn của ngày hôm nay.
  - Có ô chọn ngày + danh sách ngày nổi bật (ngày có phát sinh đơn).
  - Hiển thị thông tin nhanh: ngày hiện tại và tổng xuất đã đặt.
  - Có thao tác **Sửa** và **Xóa** trực tiếp từng đơn.

- **Quản lý menu**:
  - Giữ nguyên phần cập nhật menu/số lượng như cũ.
  - Bỏ danh sách đơn hôm nay trong tab này để tránh trùng với tab Danh sách đặt cơm.

- **Quản lý thanh toán**:
  - Mặc định hiển thị **Công nợ cần thu** (tổng xuất + số tiền cần thanh toán của người chưa trả đủ).
  - Có nút chuyển sang **Lịch sử thanh toán** ngay phía trên.
  - Hỗ trợ cập nhật thủ công: **Đã thu tiền mặt** / **Chuyển Paid** khi API không hoạt động.

## 5) Khắc phục trường hợp khách không quay lại trang PayOS success

Đã bổ sung cơ chế **auto-sync trạng thái thanh toán ở backend** để không phụ thuộc việc người dùng quay lại website:

- Server tự quét các `payment_requests` đang `PENDING`.
- Mỗi chu kỳ sẽ gọi API `getPaymentLinkInformation` của PayOS theo `orderCode`.
- Nếu PayOS đã ghi nhận thanh toán, server tự cập nhật sang `PAID` và ghi transaction vào DB.
- Nếu PayOS trả trạng thái `CANCELLED` hoặc `EXPIRED`, request cũng được cập nhật tương ứng.

Biến môi trường tùy chọn:

```bash
# Chu kỳ auto-sync (ms), mặc định 30000 = 30 giây
export PAYOS_AUTO_SYNC_MS=30000
```

> Như vậy kể cả khách chỉ chuyển khoản xong rồi thoát, hệ thống vẫn tự cập nhật status sau mỗi chu kỳ đồng bộ.

