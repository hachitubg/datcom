#!/bin/bash

# ============================================================
# VPS Initial Setup Script
# Dành cho: Ubuntu 22.04 / 24.04
# Cài đặt: Node.js 20, PM2, Nginx, Certbot
# Không cần PostgreSQL vì dự án dùng SQLite
# ============================================================

set -e

echo "====================================================="
echo " VPS Setup: Node.js + PM2 + Nginx + Certbot"
echo "====================================================="

# Cập nhật hệ thống
echo ""
echo "[1/6] Cập nhật hệ thống..."
apt update && apt upgrade -y

# Cài các gói cần thiết
echo ""
echo "[2/6] Cài gói cơ bản..."
apt install -y curl git ufw nginx certbot python3-certbot-nginx

# Cài Node.js 20
echo ""
echo "[3/6] Cài Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

echo "  Node.js: $(node --version)"
echo "  npm:     $(npm --version)"

# Cài PM2 global
echo ""
echo "[4/6] Cài PM2..."
npm install -g pm2
pm2 startup systemd -u root --hp /root

echo "  PM2: $(pm2 --version)"

# Tạo cấu trúc thư mục
echo ""
echo "[5/6] Tạo thư mục /var/www..."
mkdir -p /var/www

# Cấu hình Firewall
echo ""
echo "[6/6] Cấu hình Firewall (UFW)..."
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

echo ""
echo "====================================================="
echo " Setup hoàn tất!"
echo "====================================================="
echo ""
echo "Bước tiếp theo để deploy datcom:"
echo ""
echo "  1. Clone repo:"
echo "     cd /var/www"
echo "     git clone https://github.com/YOUR_USER/datcom.git datcom"
echo ""
echo "  2. Tạo file .env:"
echo "     cd /var/www/datcom"
echo "     nano .env"
echo ""
echo "  3. Cài dependencies & chạy app:"
echo "     npm ci --omit=dev"
echo "     pm2 start src/server.js --name datcom"
echo "     pm2 save"
echo ""
echo "  4. Thêm Nginx config:"
echo "     cp /var/www/datcom/nginx-datcom.conf /etc/nginx/sites-available/datcom"
echo "     ln -s /etc/nginx/sites-available/datcom /etc/nginx/sites-enabled/"
echo "     nginx -t && systemctl reload nginx"
echo ""
echo "  5. Cấp SSL (sau khi đã trỏ domain):"
echo "     certbot --nginx -d yourdomain.com"
echo ""
