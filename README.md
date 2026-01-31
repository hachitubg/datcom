# 🍚 Website Đặt Cơm Online

Website quản lý đặt cơm đơn giản, dễ dàng triển khai.

## 🛠️ Công Nghệ Stack

| Layer | Công Nghệ |
|-------|-----------|
| **Frontend** | HTML, CSS, JavaScript (Static Files) |
| **Backend** | Node.js + Express.js |
| **Database** | SQLite (datcom.db) |
| **Chạy Trên** | localhost:3000 (hoặc PORT env var) |

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

### Backup Database

```bash
cp /var/www/datcom/datcom.db /var/www/datcom/datcom.db.backup
```

## ��� Truy Cập

- Trang chủ: http://103.200.20.160
- Admin: http://103.200.20.160/admin

---

**Code trên GitHub | Nginx + Port 3000**
