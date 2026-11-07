# 🤖 مرکز کنترل ناوگان ایجنت‌ها و فریلنسری خودکار (Freelance & Crypto Agent OS)

پلتفرم جامع مدیریت **مجموعه‌ای از ایجنت‌های درآمدزا** (از جمله **کارمند تخصصی رمزارز**، ایجنت شکار پروژه Next.js، ایجنت فروش تلگرام، ایجنت ساخت PPTX، ایجنت مترجم Web3 و ایجنت‌های وب‌هوک خارجی) که همگی درآمد USDT خود را به **یک کیف پول واحد مرکزی (Unified Master Wallet)** واریز می‌کنند.

---

## ✨ قابلیت‌های کلیدی
- **🪙 کارمند تخصصی رمزارز (Crypto Employee Agent):** رصد آربیتراژ DEX/CEX، تحلیل جریان نهنگ‌ها، شکار ایردراپ و کپی‌ترید با گزارش کامل و واریز سود به کیف پول واحد.
- **🤖 ناوگان ایجنت‌ها + ایجنت‌ساز و API اختصاصی:** ساخت ایجنت/کارمند دیجیتال جدید با کلید API اختصاصی (`x-agent-key`) و اندپوینت استاندارد `POST /api/agents/ingest` برای اتصال ربات‌های پایتون، TradingView، n8n یا هر سرویس خارجی دیگر.
- **💳 کیف پول واحد مرکزی (Unified Master Vault):** تنظیم آدرس کیف پول واحد (TRC20 / TON / BEP20 / ERC20) و تجمیع خودکار درآمد تمام ایجنت‌ها و پروژه‌ها در یک مقصد واحد.
- **📩 ربات تلگرام و تأیید انسانی (HITL):** همگام‌سازی Webhook تلگرام با دکمه‌های شیشه‌ای (`Inline Keyboard`) برای تأیید یا رد تسک‌ها.
- **💼 مدیریت کامل پروژه‌های کریپتویی (CRUD):** جستجو، فیلتر وضعیت، پیگیری پرداخت USDT و چت تعاملی با مشتریان.

---

## 🚀 راهنمای گام‌به‌گام استقرار (GitHub + Supabase + Vercel)

### گام ۱: آپلود در GitHub
فایل `.gitignore` طوری تنظیم شده که فایل‌های حساس مثل `.env` و `node_modules` هرگز به گیت‌هاب ارسال نشوند.
```bash
git init
git add .
git commit -m "Initial commit: Freelance & Crypto Agent Control Center"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

### گام ۲: ساخت دیتابیس در Supabase
1. وارد [Supabase](https://supabase.com) شوید و یک پروژه جدید بسازید.
2. از مسیر **Project Settings → Database → Connection string** دو آدرس زیر را کپی کنید:
   - **Transaction Pooler (Port 6543):** برای متغیر `DATABASE_URL` در Vercel
   - **Session Pooler / Direct (Port 5432):** برای متغیر `DIRECT_URL`
3. برای ساخت جدول‌ها یکی از دو روش زیر را انجام دهید:
   - **روش الف (سریع‌ترین روش):** محتوای فایل `supabase/schema.sql` را در **SQL Editor** سوپابیس کپی و **Run** کنید.
   - **روش ب (از ترمینال):** مقدار `DIRECT_URL` را در `.env` بگذارید و اجرا کنید:
     ```bash
     npx drizzle-kit push
     ```

### گام ۳: دیپلوی در Vercel
1. وارد [Vercel](https://vercel.com) شوید، **Add New Project** را بزنید و ریپازیتوری GitHub خود را انتخاب کنید.
2. در بخش **Environment Variables** متغیرهای زیر را وارد کنید (مطابق فایل `.env.example`):
   - `DATABASE_URL` ← رشته اتصال Pooler سوپابیس (پورت 6543)
   - `DIRECT_URL` ← رشته اتصال Direct سوپابیس (پورت 5432)
   - `ADMIN_EMAIL` ← ایمیل ورود مدیر (پیش‌فرض: `admin@freelance.ir`)
   - `ADMIN_PASSWORD` ← رمز عبور مدیر (پیش‌فرض: `admin123`)
   - `AUTH_SECRET` ← یک رشته تصادفی امن
   - `MASTER_WALLET_ADDRESS` ← آدرس کیف پول واحد USDT شما
   - `MASTER_WALLET_NETWORK` ← مثلاً `USDT-TRC20`
   - `TELEGRAM_BOT_TOKEN` ← (اختیاری) توکن ربات از BotFather
3. دکمه **Deploy** را بزنید! در اولین ورود به `/control` تمام داده‌های پایه به صورت خودکار ساخته می‌شوند.

---

## 🔌 نحوه اتصال ایجنت خارجی یا کارمند رمزارز به API کیف پول واحد

هر زمان که ربات ترید، اسکریپت پایتون یا ایجنت خارجی شما سودی کسب کرد، کافیست یک درخواست `POST` به آدرس زیر ارسال کند تا سود مستقیم به **کیف پول واحد** واریز و در داشبورد ثبت شود:

```bash
curl -X POST https://YOUR-DOMAIN.vercel.app/api/agents/ingest \
  -H "Content-Type: application/json" \
  -H "x-agent-key: ag_live_crypto_arya_9821" \
  -d '{
    "amountUsdt": 65,
    "title": "سود آربیتراژ جفت ارز TON/USDT",
    "strategy": "arbitrage"
  }'
```

## Deployment (Supabase + Vercel)

- Database: existing Supabase project `auralis` — tables live in the isolated
  `agentos` schema (the shared `public` schema belongs to another app).
  Apply `supabase/schema.sql` once in the SQL Editor (idempotent).
- Connect via the pooler as the limited role (transaction mode, port 6543):
  `postgres://agentos.<project-ref>:<password>@aws-1-eu-central-1.pooler.supabase.com:6543/postgres`
  (Note: this project's tenant is served by the `aws-1` pooler host, and the
  connection string must NOT contain `sslmode=` — the app manages TLS itself.)
- Vercel project `freelance-agent-os` env vars: `DATABASE_URL`, `DIRECT_URL`,
  `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `AUTH_SECRET`, `MASTER_WALLET_NETWORK`,
  `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_ADMIN_CHAT_ID`.
- Health check: `GET /api/health` → `{ "ok": true }`.
