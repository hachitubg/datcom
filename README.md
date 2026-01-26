# 🍚 Website Đặt Cơm Online

Website quản lý đặt cơm đơn giản, dễ dàng triển khai.

## 🎯 Tính Năng

- **Trang chủ**: Hiển thị menu hôm nay, giá cơm (40.000 VNĐ), đếm ngược số lượng xuất còn lại (10 xuất/ngày)
- **Đặt cơm**: Form đơn giản với họ tên, số lượng, ghi chú
- **Danh sách đơn**: Xem tất cả đơn hàng theo thứ tự thời gian
- **Quản lý Admin**: 
  - Cập nhật menu hàng ngày
  - Thay đổi số lượng xuất có thể đặt
  - Xóa đơn hàng
  - Xem lịch sử các ngày (để theo dõi doanh thu)

## 📋 Yêu Cầu

- **Node.js** phiên bản 12 trở lên
- **npm** (đi kèm Node.js)

## ⚙️ Cài Đặt Cục Bộ (Máy Tính)

```bash
# 1. Vào thư mục dự án
cd datcom

# 2. Cài đặt các package cần thiết
npm install

# 3. Chạy server
npm start

# Mở trình duyệt: http://localhost:3000
```

## 🚀 Deploy Lên Hosting Linux

### Bước 1: Chuẩn Bị Hosting

Kết nối SSH vào server:
```bash
ssh root@103.200.20.160
# Nhập password của bạn
```

### Bước 2: Cài Đặt Node.js và npm

```bash
# Cập nhật package manager
apt update && apt upgrade -y

# Cài Node.js (v18)
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
apt install -y nodejs

# Kiểm tra cài đặt
node --version
npm --version
```

### Bước 3: Upload Dự Án Lên Server

**Cách 1: Dùng Git (KHUYẾN KHÍCH)**
```bash
# Trên server - DÙNG HTTPS (không dùng SSH)
cd /var/www
git clone https://github.com/hachitubg/datcom.git
cd datcom
npm install
```
Khi được hỏi username, nhập tên GitHub của bạn. Khi được hỏi password, dùng GitHub Personal Access Token (tạo tại https://github.com/settings/tokens)

**Cách 2: Dùng SFTP/FTP**
- Copy toàn bộ folder `datcom` lên `/var/www/datcom` trên server

**Cách 3: Dùng scp (từ máy tính)**
```bash
scp -r datcom root@103.200.20.160:/var/www/
```

### Bước 4: Cài Đặt Trên Server

```bash
# Kết nối SSH
ssh root@103.200.20.160

# Vào folder dự án
cd /var/www/datcom

# Cài đặt dependencies
npm install
```

### Bước 5: Chạy Server với PM2 (Lưu Giữ Tiến Trình)

```bash
# Cài PM2
npm install -g pm2

# Chạy ứng dụng với PM2
pm2 start src/server.js --name "datcom"

# Lưu cấu hình PM2 để tự động chạy khi reboot
pm2 startup
pm2 save

# Kiểm tra trạng thái
pm2 status
pm2 logs datcom
```

### Bước 6: Cấu Hình Nginx Reverse Proxy (Tùy Chọn nhưng Khuyến Khích)

```bash
# Cài Nginx
apt install -y nginx

# Tạo file cấu hình
nano /etc/nginx/sites-available/datcom
```

Dán nội dung sau:
```nginx
server {
    listen 80;
    server_name 103.200.20.160;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Kích hoạt:
```bash
ln -s /etc/nginx/sites-available/datcom /etc/nginx/sites-enabled/
nginx -t
systemctl restart nginx
```

## 📱 Truy Cập Website

- **Trang chủ**: http://103.200.20.160
- **Quản lý**: http://103.200.20.160/admin

## 🛠️ Các Lệnh Hữu Ích

```bash
# Xem log
pm2 logs datcom

# Dừng server
pm2 stop datcom

# Khởi động lại server
pm2 restart datcom

# Xóa server
pm2 delete datcom

# Cập nhật code mới (sau khi git pull)
pm2 restart datcom
```

## 📊 Database

- Database được lưu tại `datcom.db` (SQLite)
- Tự động tạo các bảng khi chạy lần đầu
- Dữ liệu được lưu vĩnh viễn

## 🔐 Ghi Chú Bảo Mật

- Trang admin không có password - bạn nên thêm authentication nếu cần
- Backup database `datcom.db` thường xuyên
- Nếu muốn HTTPS, hãy cài SSL Certificate (dùng Let's Encrypt)

## 📞 Hỗ Trợ

Nếu gặp lỗi:
1. Kiểm tra log: `pm2 logs datcom`
2. Kiểm tra port 3000 có bị chiếm không: `netstat -tuln | grep 3000`
3. Khởi động lại: `pm2 restart datcom`

---

**Thành công! 🎉 Website đã sẵn sàng hoạt động!**
