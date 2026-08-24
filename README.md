# Datcom

Huong dan nhanh de chay, deploy va van hanh du an `datcom`.

## Tong quan

Day la web app dat com gom 2 phan:

- Trang khach: xem menu, dat com, dang ky/dang nhap, thanh toan, gui gop y an danh.
- Trang admin: quan ly don, menu, thanh toan, ma khuyen mai, nguoi dung, cai dat va doc gop y.

Tech stack hien tai:

- Backend: Node.js + Express
- Frontend: HTML/CSS/JavaScript thuan
- Database: SQLite (`datcom.db`)
- Thanh toan: PayOS
- Deploy: PM2 tren VPS/Linux

## Chay local

```bash
npm install
```

Tao file `.env` tai thu muc goc:

```env
PORT=3000
PUBLIC_BASE_URL=http://localhost:3000

# Bat buoc cho production, nen set ca local de on dinh session
SESSION_SECRET=your-session-secret

# Chi can khi khoi dong moi tren DB chua co admin
ADMIN_INITIAL_PASSWORD=your-admin-password

# Dat 1 neu chay HTTPS thuc su
COOKIE_SECURE=0

# Tuy chon neu dung PayOS
# PAYOS_CLIENT_ID=your-client-id
# PAYOS_API_KEY=your-api-key
# PAYOS_CHECKSUM_KEY=your-checksum-key
# PAYOS_AUTO_SYNC_MS=30000
```

Chay server:

```bash
npm start
```

Mo tren trinh duyet:

- Trang khach: `http://localhost:3000`
- Admin login: `http://localhost:3000/admin-login`
- Admin: `http://localhost:3000/admin`

## Bien moi truong quan trong

- `PORT`: cong server.
- `PUBLIC_BASE_URL`: domain/public URL de backend tao callback URL va redirect dung.
- `SESSION_SECRET`: khoa ky cookie session. Production bat buoc phai set.
- `ADMIN_INITIAL_PASSWORD`: mat khau admin khoi tao lan dau neu DB chua co tai khoan admin.
- `COOKIE_SECURE`: `1` khi chay HTTPS, `0` khi chay HTTP local.
- `PAYOS_CLIENT_ID`, `PAYOS_API_KEY`, `PAYOS_CHECKSUM_KEY`: can khi bat thanh toan PayOS.
- `PAYOS_AUTO_SYNC_MS`: chu ky dong bo trang thai thanh toan PayOS, mac dinh `30000`.

Luu y:

- Khong con mat khau admin hardcode trong code.
- Neu DB da co admin thi `ADMIN_INITIAL_PASSWORD` khong tu dong ghi de.
- Session dang nhap hien tai dung cookie co chu ky, khong phu thuoc session RAM nen restart app khong lam mat login ngay lap tuc chi vi bo nho process bi reset.
- Neu local chua set `SESSION_SECRET`, server se dung fallback dev secret va in canh bao. Khong nen dung fallback nay tren production.

## Database SQLite

Du an dung file SQLite local:

- DB file: `datcom.db`
- Khong can cai PostgreSQL/MySQL neu giu kien truc hien tai.

Can dam bao:

- user chay app co quyen doc/ghi thu muc project
- file `datcom.db` duoc backup truoc moi lan deploy
- khong xoa DB khi pull/redeploy

Neu muon kiem tra DB thu cong:

```bash
sqlite3 datcom.db
```

Mot so lenh hay dung:

```sql
.tables
.schema
SELECT * FROM orders ORDER BY id DESC LIMIT 20;
SELECT * FROM feedback_submissions ORDER BY id DESC LIMIT 20;
```

## Deploy tren VPS

Quy trinh cap nhat code:

```bash
cd /var/www/datcom
git pull
npm ci --omit=dev
pm2 restart datcom
pm2 logs datcom --lines 100
```

## CI/CD GitHub Actions

Workflow `.github/workflows/ci-cd.yml` chạy khi có pull request hoặc push vào `main`:

1. `npm ci --omit=dev`
2. kiểm tra cú pháp JavaScript
3. chạy toàn bộ regression test
4. `npm audit` cho dependency production
5. push vào `main` mới được deploy lên VPS

VPS deploy bằng `scripts/deploy.sh`. Script khóa không cho hai deploy chạy đồng thời, backup toàn bộ SQLite, checkout đúng commit, restart PM2 và kiểm tra `/api/today` của main cùng mọi site đang bật. Nếu có lỗi, code và database tự quay lại commit/snapshot trước.

Tạo GitHub Environment tên `production` và cấu hình các secret:

- `VPS_HOST`: IP hoặc hostname VPS.
- `VPS_PORT`: cổng SSH, thường là `22`.
- `VPS_USER`: user chạy PM2 và sở hữu `/var/www/datcom`.
- `VPS_SSH_KEY`: private key dành riêng cho GitHub Actions.
- `VPS_KNOWN_HOSTS`: kết quả `ssh-keyscan -H -p 22 <VPS_HOST>` đã được kiểm tra fingerprint.

Biến `PRODUCTION_DEPLOY_ENABLED` có thể dùng làm cờ vận hành nội bộ, nhưng deploy được kích hoạt trực tiếp bởi push vào `main` sau khi các secret đã sẵn sàng.

Public key tương ứng phải được giới hạn bằng forced command trong `~/.ssh/authorized_keys` của `VPS_USER`:

```text
command="/usr/local/sbin/datcom-deploy-entrypoint",restrict ssh-ed25519 AAAA... github-actions-datcom
```

Copy `scripts/deploy-entrypoint.sh` thành `/usr/local/sbin/datcom-deploy-entrypoint` và cấp quyền thực thi. Key này chỉ chấp nhận `deploy-datcom <commit-sha>`, không thể mở shell tùy ý. VPS cần có `bash`, `flock`, `curl`, Node.js 20, npm và PM2. Không lưu private key hoặc nội dung `.env` trong repository.

Có thể chạy lại deploy thủ công tại tab **Actions → CI and production deploy → Run workflow**. Nên bật branch protection cho `main` và yêu cầu job `test` thành công trước khi merge.

Vi du khoi dong bang PM2:

```bash
cd /var/www/datcom
npm ci --omit=dev
pm2 start src/server.js --name datcom
pm2 save
```

Neu chay sau reverse proxy/HTTPS:

- set `PUBLIC_BASE_URL` dung domain that
- set `COOKIE_SECURE=1`
- giu `SESSION_SECRET` co gia tri co dinh va rieng tu

## Backup va restore

Backup:

```bash
cp /var/www/datcom/datcom.db /var/www/datcom/datcom.db.backup-$(date +%F-%H%M%S)
```

Restore:

```bash
cp /var/www/datcom/datcom.db.backup-2026-04-05-010000 /var/www/datcom/datcom.db
pm2 restart datcom
```

Copy file ve local:
```bash
scp "root@103.200.20.160:/var/www/datcom/datcom.db.backup-*" "C:\Users\admin\Desktop"
```

## Tinh nang dang co

- Dat com theo ngay
- Dang ky/dang nhap user
- Sua/xoa don trong thoi gian cho phep
- Promo code va khuyen mai theo chuoi ngay
- Thanh toan cong no qua PayOS
- Auto sync trang thai PayOS tu backend
- Admin xem cong no can thu va lich su thanh toan
- Tong hop tong tien theo bo loc trong admin payment
- Gop y an danh tu trang chu
- Admin doc danh sach gop y
- So suat mac dinh cho ngay moi: `40`

## Tai lieu bo sung

- Tong quan cau truc du an: `AI_PROJECT_GUIDE.md`
- Dinh huong giao dien: `DESIGN.md`

## Ghi chu van hanh

- Neu app moi khoi tao ma chua co admin, hay set `ADMIN_INITIAL_PASSWORD` truoc lan chay dau.
- Neu thay doi `SESSION_SECRET` tren production, cac session hien tai se bi vo hieu hoa va can dang nhap lai.
- Neu PayOS khong cau hinh, cac chuc nang thanh toan online se khong hoat dong nhung website van chay cac phan khac.
- Local dev co the chay khi thieu `SESSION_SECRET`, nhung production thi khong.
