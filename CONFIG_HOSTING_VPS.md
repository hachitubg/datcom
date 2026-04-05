# VPS-OPS — Hướng dẫn quản lý VPS

## Thông tin server

| | |
|---|---|
| IP | 103.179.190.220 |
| Domain | comcogiang.io.vn |
| OS | Ubuntu 22.04 / 24.04 (x64) |
| User | root |
| Thời gian thuê | ... |

---

## Những gì đã cài

- **Node.js 20** — runtime cho các app Node.js
- **PM2** — process manager, giữ app chạy liên tục
- **Nginx** — reverse proxy, phân traffic theo domain
- **Certbot** — SSL miễn phí (auto gia hạn)
- **Git** — pull code từ GitHub
- ~~PostgreSQL~~ — **không cần**, các app dùng SQLite

---

## Cấu trúc thư mục

```
/var/www/
├── datcom/        # Website đặt cơm
└── site2/         # Website khác (sau này)
```

Config Nginx: `/etc/nginx/sites-available/`

---

## Setup VPS lần đầu

Chạy script từ repo datcom (cần chạy với quyền root):

```bash
bash <(curl -s https://raw.githubusercontent.com/YOUR_USER/datcom/main/setup.sh)
```

Hoặc nếu đã clone repo:

```bash
cd /var/www/datcom
bash setup.sh
```

Script sẽ tự cài: Node.js 20, PM2, Nginx, Certbot, UFW.

---

## Deploy datcom

### 1. Clone repo

```bash
cd /var/www
git clone https://github.com/YOUR_USER/datcom.git datcom
cd datcom
```

### 2. Tạo file .env

```bash
nano .env
```

```env
PORT=3000
PUBLIC_BASE_URL=https://YOUR_DOMAIN

SESSION_SECRET=your-strong-random-secret
ADMIN_INITIAL_PASSWORD=your-admin-password

COOKIE_SECURE=1

# Nếu dùng PayOS:
# PAYOS_CLIENT_ID=...
# PAYOS_API_KEY=...
# PAYOS_CHECKSUM_KEY=...
# PAYOS_AUTO_SYNC_MS=30000
```

### 3. Cài dependencies & chạy

```bash
npm ci --omit=dev
pm2 start src/server.js --name datcom
pm2 save
```

### 4. Cấu hình Nginx

```bash
cp /var/www/datcom/nginx-datcom.conf /etc/nginx/sites-available/datcom
nano /etc/nginx/sites-available/datcom
# Sửa YOUR_DOMAIN thành domain thật

ln -s /etc/nginx/sites-available/datcom /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

### 5. Cấp SSL (sau khi đã trỏ domain về IP server)

```bash
certbot --nginx -d YOUR_DOMAIN
```

Certbot sẽ tự thêm HTTPS redirect và gia hạn tự động.

---

## Update code datcom

```bash
cd /var/www/datcom
git pull
npm ci --omit=dev
pm2 restart datcom
pm2 logs datcom --lines 100
```

---

## Deploy website mới (sau này)

### 1. Clone code

```bash
cd /var/www
git clone https://github.com/username/repo.git ten-site
cd ten-site
npm ci --omit=dev
```

### 2. Tạo file .env

Mỗi site dùng 1 port riêng (3001, 3002...):

```bash
nano .env
# PORT=3001
```

### 3. Chạy bằng PM2

```bash
pm2 start src/server.js --name "ten-site"
pm2 save
```

### 4. Thêm Nginx config

```bash
cp /etc/nginx/sites-available/datcom /etc/nginx/sites-available/ten-site
nano /etc/nginx/sites-available/ten-site
# Sửa server_name và port cho đúng

ln -s /etc/nginx/sites-available/ten-site /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

### 5. Cấp SSL

```bash
certbot --nginx -d ten-site-domain.com
```

---

## Quản lý PM2

```bash
pm2 list                    # xem tất cả app đang chạy
pm2 logs datcom             # xem log
pm2 restart datcom          # restart app
pm2 stop datcom             # dừng app
pm2 delete datcom           # xóa app khỏi PM2
```

---

## Quản lý Nginx

```bash
nginx -t                    # kiểm tra config trước khi reload
systemctl reload nginx      # áp dụng config mới
systemctl status nginx      # kiểm tra trạng thái
```

---

## Backup & Restore SQLite

Backup thủ công:

```bash
cp /var/www/datcom/datcom.db /var/www/datcom/datcom.db.backup-$(date +%F-%H%M%S)
```

Copy về máy local (Windows):

```bash
scp "root@103.179.190.220:/var/www/datcom/datcom.db.backup-*" "C:\Users\admin\Desktop"
```

Restore:

```bash
cp /var/www/datcom/datcom.db.backup-YYYY-MM-DD-HHMMSS /var/www/datcom/datcom.db
pm2 restart datcom
```

---

## Lưu ý quan trọng

- Mỗi website dùng **1 port riêng** (3000, 3001, 3002...)
- File `datcom.db` **không được xóa** khi pull/redeploy — đây là toàn bộ dữ liệu
- Sau khi sửa Nginx luôn chạy `nginx -t` trước khi reload
- SSL tự gia hạn, không cần làm thủ công
- Nếu đổi `SESSION_SECRET` trên production, tất cả user phải đăng nhập lại
