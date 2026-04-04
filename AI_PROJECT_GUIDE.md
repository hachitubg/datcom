# Datcom Project Guide

## 1. Muc tieu du an

Day la mot web app dat com don gian cho mot cua hang/com nha lam, gom:

- Trang public de xem menu hom nay, dat com, xem danh sach don, tra cuu va thanh toan cong no.
- Trang admin de quan ly menu, so luong suat, lich su dat, thanh toan, ma khuyen mai, nguoi dung va cai dat he thong.
- Backend Node.js dung Express, frontend la HTML/CSS/JS thuan, database la SQLite luu trong file local.

Du an khong co buoc build frontend, khong dung framework SPA, khong dung ORM.

## 2. Tech Stack

- Runtime: Node.js
- Backend: Express 4, body-parser, cors
- Database: SQLite3 (`datcom.db`)
- Frontend: HTML/CSS/Vanilla JavaScript
- Thanh toan: PayOS qua HTTPS API tu viet
- Deploy thuc te: PM2 tren Linux server

Dependencies trong `package.json`:

- `express`
- `body-parser`
- `sqlite3`
- `cors`

## 3. Entry points chinh

- Backend server: `src/server.js`
- Database layer: `src/database.js`
- PayOS integration: `src/payos.js`
- Env loader noi bo: `src/load-env.js`
- Public homepage: `public/index.html`
- Admin page: `public/admin.html`
- Admin login page: `public/admin-login.html`

Script npm:

- `npm start` -> `node src/server.js`
- `npm run dev` -> cung chay `node src/server.js`

## 4. Cau truc thu muc

```text
datcom/
|- src/
|  |- server.js        # Express app, auth/session, API routes, PayOS sync
|  |- database.js      # SQLite schema + toan bo truy van/nghiep vu
|  |- payos.js         # Goi API PayOS, ky request, verify webhook
|  |- load-env.js      # Doc file .env khong can dotenv
|- public/
|  |- index.html       # Trang khach
|  |- admin.html       # Trang admin
|  |- admin-login.html # Dang nhap admin
|  |- assets/
|     |- js/
|     |  |- common.js  # Utilities chung, popup, format
|     |  |- trangchu.js# Logic trang public
|     |  |- admin.js   # Logic trang admin
|     |- styles/
|        |- index.css
|        |- admin.css
|- datcom.db           # SQLite database chay that
|- README.md           # Huong dan chay/deploy/backup
|- DESIGN.md           # Dinh huong design/UI
|- setup.sh            # Script setup Linux + Node + PM2
```

## 5. Kien truc tong quan

### Backend

- `server.js` vua serve static files trong `public/`, vua expose REST API.
- Session dang nhap admin va user duoc luu trong RAM:
  - `adminSessions: Set`
  - `userSessions: Map`
- Cookie duoc set bang tay, khong dung `express-session`.
- Khi restart process, session dang nhap se mat.

### Frontend

- Frontend la multi-page nhe:
  - `/` -> trang khach
  - `/admin-login` -> login admin
  - `/admin` -> dashboard admin
- JS goi truc tiep REST API bang `fetch`.
- UI dung modal la chinh, khong co router client.

### Database

- SQLite mo file `../datcom.db`.
- Khi app start:
  - Tao bang neu chua ton tai
  - Them cot moi bang `ALTER TABLE ... ADD COLUMN` neu can
  - Dam bao co record cho ngay hom nay trong bang `days`
  - Seed admin mac dinh neu chua co
  - Seed app settings mac dinh

## 6. Domain model va bang du lieu

### `days`

Luu thong tin theo ngay:

- `date`
- `menu`
- `quantity`
- `price`

Moi ngay co 1 record duy nhat. App tu dong `INSERT OR IGNORE` cho ngay hien tai.

### `orders`

Luu don dat com:

- `day_id`
- `name`
- `quantity`
- `description`
- `discount_percent`
- `promo_code`
- `user_id`
- `created_at`

### `payment_requests`

Luu yeu cau thanh toan da tao voi PayOS:

- `order_code`
- `customer_name`
- `amount`
- `payment_link_id`
- `checkout_url`
- `qr_code`
- `status` (`PENDING`, `PAID`, `CANCELLED`, `EXPIRED`, ...)

### `payment_transactions`

Luu giao dich da ghi nhan:

- `order_code`
- `customer_name`
- `amount`
- `status`
- `reference`
- `transaction_date`
- `raw_payload`

Co unique `(order_code, status)`.

### `promo_codes`

- `code`
- `discount_percent`
- `used_by`
- `used_at`
- `order_id`

### `users`

- `phone`
- `name`
- `password_hash`
- `salt`
- `role` (`user` hoac `admin`)

### `app_settings`

Dang key-value. Hien tai dung cho:

- `debt_limit_enabled`
- `debt_limit_servings`
- `debt_limit_message`
- `consecutive_promo_enabled`
- `consecutive_promo_days`
- `consecutive_promo_discount`

## 7. Nghiep vu chinh

### 7.1 Dat com

Luong:

1. Frontend goi `POST /api/orders`
2. Backend normalize ten
3. Kiem tra debt limit neu bat
4. Kiem tra con du so luong trong ngay
5. Ap promo code neu co
6. Tao order
7. Neu bat consecutive promo thi co the tu tang ma khuyen mai

### 7.2 User auth

Public co auth tuy chon:

- Dang ky: `POST /api/auth/register`
- Dang nhap: `POST /api/auth/login`
- Dang xuat: `POST /api/auth/logout`
- Kiem tra session: `GET /api/auth/me`

Neu user da login:

- Co the sua/xoa don cua chinh minh
- Chi duoc sua/xoa trong 30 phut
- Co the dung promo code

### 7.3 Admin auth

- Dang nhap: `POST /api/admin/login`
- Dang xuat: `POST /api/admin/logout`
- Admin page duoc bao ve bang cookie `admin_session`
- Fallback password mac dinh: `hachitu` neu DB chua co admin

Luu y quan trong:

- `database.js` se seed 1 admin mac dinh `phone=admin`, `name=Admin`, mat khau `hachitu` neu chua co admin.

### 7.4 Thanh toan PayOS

Luong tao thanh toan:

1. Frontend goi `POST /api/payments/create`
2. Backend tinh so tien con no cua khach
3. Tao `orderCode`
4. Goi PayOS tao payment link
5. Luu vao `payment_requests`
6. Frontend redirect thang sang `checkoutUrl`

Luong dong bo trang thai:

- Webhook: `POST /api/payments/webhook/payos`
- Verify return URL: `GET /api/payments/verify-return`
- Auto sync nen:
  - Khi co cau hinh PayOS, server chay job dinh ky
  - Mac dinh moi `30000ms`
  - Quet `payment_requests` dang `PENDING`
  - Goi `getPaymentLinkInformation`
  - Neu PayOS bao da tra, DB duoc cap nhat sang `PAID`

Admin co fallback thu cong:

- `POST /api/admin/payments/manual-paid`
- `POST /api/admin/payments/manual-cash`
- `DELETE /api/admin/payments/:orderCode`

### 7.5 Quan ly cong no

Cong no duoc tinh theo tong lich su:

- Tong order amount theo tung ngay
- Tong tien da thanh toan
- Ap dung logic FIFO cho cac khoan da tra

Frontend va admin deu co man hinh xem:

- Cong no hien tai
- Chi tiet don chua tra
- Lich su thanh toan
- Full history theo khach hang

### 7.6 Promo code

Co 2 kieu:

- Promo tao thu cong tu admin
- Promo auto tao khi dat lien tuc du so ngay cau hinh

Validation public:

- `POST /api/promo-codes/validate`

Admin CRUD:

- `GET /api/admin/promo-codes`
- `POST /api/admin/promo-codes`
- `DELETE /api/admin/promo-codes/:id`

### 7.7 Cai dat he thong

Admin co the bat/tat:

- Chan dat com neu no qua so suat
- Tang ma khuyen mai khi dat lien tuc

API:

- `GET /api/admin/settings`
- `PUT /api/admin/settings`

## 8. API groups

### Public/API khach

- `GET /api/today`
- `GET /api/orders/today`
- `POST /api/orders`
- `PUT /api/orders/:orderId`
- `DELETE /api/orders/:orderId`
- `GET /api/customers/names`
- `GET /api/payments/today`
- `GET /api/payments/today/:name/details`
- `POST /api/payments/create`
- `GET /api/payments/history`
- `GET /api/payments/verify-return`
- `POST /api/promo-codes/validate`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`

### Admin API

- `POST /api/admin/login`
- `POST /api/admin/logout`
- `GET /api/admin/all-days`
- `GET /api/admin/day/:date`
- `POST /api/admin/menu`
- `POST /api/admin/quantity`
- `PUT /api/admin/orders/:orderId`
- `DELETE /api/admin/orders/:orderId`
- `POST /api/admin/customers/rename`
- `GET /api/admin/customers/:name/orders`
- `GET /api/admin/customers/:name/full-history`
- `POST /api/admin/payments/manual-paid`
- `POST /api/admin/payments/manual-cash`
- `DELETE /api/admin/payments/:orderCode`
- `GET /api/admin/promo-codes`
- `POST /api/admin/promo-codes`
- `DELETE /api/admin/promo-codes/:id`
- `GET /api/admin/users`
- `POST /api/admin/users`
- `DELETE /api/admin/users/:id`
- `PUT /api/admin/users/:id/password`
- `GET /api/admin/settings`
- `PUT /api/admin/settings`

## 9. Bien moi truong

File `.env` duoc doc boi `src/load-env.js`, khong can `dotenv`.

Bien quan trong:

- `PORT`
- `PUBLIC_BASE_URL`
- `PAYOS_CLIENT_ID`
- `PAYOS_API_KEY`
- `PAYOS_CHECKSUM_KEY`
- `PAYOS_AUTO_SYNC_MS`
- `PAYOS_BASE_URL` (tuy chon, mac dinh `https://api-merchant.payos.vn`)

Vi du toi thieu khi chay local:

```env
PORT=3000
PUBLIC_BASE_URL=http://localhost:3000
```

Neu dung PayOS thi them:

```env
PAYOS_CLIENT_ID=...
PAYOS_API_KEY=...
PAYOS_CHECKSUM_KEY=...
PAYOS_AUTO_SYNC_MS=30000
```

## 10. Cach chay local

```bash
npm install
npm start
```

Mac dinh:

- Public: `http://localhost:3000`
- Admin: `http://localhost:3000/admin`
- Admin login: `http://localhost:3000/admin-login`

Khong co build step rieng.

## 11. Cach deploy thuc te

Deploy kieu don gian tren Linux + PM2.

### Cai dat may moi

Repo da co `setup.sh` de:

- update/upgrade he thong
- cai Node.js 18
- cai PM2 global
- tao thu muc `/var/www/datcom`

### Quy trinh deploy / update code

Theo `README.md`, flow hien tai la:

```bash
cd /var/www/datcom
git pull
npm ci --omit=dev
pm2 restart datcom
pm2 logs datcom --lines 100
```

Lenh start PM2 ban dau:

```bash
pm2 start src/server.js --name datcom
```

Luu y deploy:

- App phu thuoc vao file SQLite local `datcom.db`
- Khi deploy khong duoc de mat DB neu la server production
- Neu clone repo moi/toan trang moi, can dam bao file DB duoc copy/restore dung

## 12. Backup va restore database

Vi DB la file SQLite local, backup chi la copy file:

```bash
cp /var/www/datcom/datcom.db /var/www/datcom/datcom.db.backup-$(date +%F-%H%M%S)
```

Restore:

```bash
cp /var/www/datcom/datcom.db.backup-YYYY-MM-DD-HHMMSS /var/www/datcom/datcom.db
pm2 restart datcom
```

Kiem tra nhanh:

```bash
sqlite3 /var/www/datcom/datcom.db ".tables"
```

## 13. Cac dac diem ky thuat can nho

- Khong co test suite, khong co lint config, khong co CI config trong repo.
- Session luu trong memory, restart app la mat session.
- SQLite la single-file DB; can can than khi deploy, backup, restore.
- `orders.created_at`/SQLite timestamp dang o UTC kieu `CURRENT_TIMESTAMP`; frontend co util convert sang gio local.
- Admin va user auth deu tu viet, khong dung framework auth.
- `body-parser` duoc dung cho JSON/urlencoded, rieng webhook PayOS dung `express.raw`.
- Frontend public refresh thong tin hom nay moi 5 giay.
- Menu duoc luu trong DB o cot `days.menu`, thuong la JSON string, nhung code van co fallback parse string cu.

## 14. File nao can doc neu muon sua nhanh

Neu AI/dev sau muon thay doi nhanh, thu tu uu tien:

1. `src/server.js`  
   De hieu route, auth, webhook, flow app.
2. `src/database.js`  
   De hieu schema, nghiep vu, cach tinh cong no/promo/payment.
3. `public/assets/js/trangchu.js`  
   De hieu UX va API usage o trang public.
4. `public/assets/js/admin.js`  
   De hieu dashboard admin va cac thao tac van hanh.
5. `README.md`  
   De hieu deploy/backup/van hanh.

## 15. Tom tat sieu ngan cho AI

- Day la app dat com theo ngay dung Node.js + Express + SQLite + frontend thuong.
- Backend nam o `src/`, frontend static nam o `public/`.
- DB that la file `datcom.db`.
- Khong co build step.
- Deploy bang PM2 tren Linux.
- Thanh toan dung PayOS, co webhook + verify-return + auto-sync pending payments.
- Admin co cac module: orders, menu, payments, promo codes, users, settings.
- Auth/session deu luu trong RAM, khong persistent qua restart.

