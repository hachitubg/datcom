#!/bin/bash

# Script cài đặt và chạy website trên server Linux

echo "🍚 Bắt đầu cài đặt Website Đặt Cơm..."

# Cập nhật hệ thống
echo "📦 Cập nhật hệ thống..."
apt update && apt upgrade -y

# Cài Node.js
echo "📥 Cài đặt Node.js..."
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
apt install -y nodejs

# Kiểm tra Node.js
echo "✅ Node.js version:"
node --version
echo "✅ npm version:"
npm --version

# Cài PM2 global
echo "📥 Cài đặt PM2..."
npm install -g pm2

# Tạo thư mục
echo "📁 Tạo thư mục ứng dụng..."
mkdir -p /var/www/datcom

echo ""
echo "✅ Hoàn tất! Bước tiếp theo:"
echo "1. Upload folder 'datcom' lên /var/www/datcom"
echo "2. Chạy lệnh: cd /var/www/datcom && npm install"
echo "3. Chạy lệnh: pm2 start src/server.js --name 'datcom'"
echo "4. Truy cập: http://103.200.20.160"
echo ""
