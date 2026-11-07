# شناسنامه و معماری پروژه — Freelance Agent OS

> تاریخ: ۲۰۲۶/۱۱/۰۷ | وضعیت: واقعی و مستقر (Production)

| مورد | مقدار |
|---|---|
| ریپو | `cnamokhtarian-png/3096agents` |
| آدرس زنده | `https://freelance-agent-os.vercel.app` |
| فرانت + بک‌اند | Next.js 16 (App Router) + React 19 |
| دیتابیس | Supabase Postgres (پروژه `auralis`، اسکیمای ایزوله `agentos`) |
| ORM | Drizzle ORM + درایور `pg` |
| استایل | Tailwind CSS 4 |
| میزبانی | Vercel (ریجن `fra1`) |
| ربات تلگرام | `@sina_freelance_agent_bot` (وب‌هوک واقعی) |
| زبان رابط کاربری | فارسی (راست‌به‌چپ) |

## ۱. ساختار پروژه (Directory Tree)

```text
3096agents/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── agents/
│   │   │   │   ├── route.ts            # CRUD ایجنت‌ها
│   │   │   │   └── ingest/route.ts     # ثبت درآمد واقعی ایجنت‌ها
│   │   │   ├── auth/login/route.ts     # ورود/خروج مدیر (کوکی نشست)
│   │   │   ├── chats/reply/route.ts    # ارسال واقعی در تلگرام
│   │   │   ├── health/route.ts         # سلامت سرویس + دیتابیس
│   │   │   ├── projects/route.ts       # CRUD محصولات/پروژه‌ها
│   │   │   ├── rest/route.ts           # CRUD عمومی: tasks/messages/transactions/logs/tools
│   │   │   ├── settings/route.ts       # تنظیمات و اتصال‌ها (ادمین)
│   │   │   ├── stats/route.ts          # آمار + قیمت زنده + نمودار واقعی
│   │   │   ├── telegram/webhook/route.ts # وب‌هوک تلگرام + دکمه تأیید/رد
│   │   │   ├── tools/run/route.ts      # اجرای ابزارها (مترجم واقعی)
│   │   │   └── wallet/
│   │   │       ├── route.ts            # کیف پول برداشت + موجودی
│   │   │       └── payout/route.ts     # درخواست/تکمیل برداشت
│   │   ├── control/page.tsx            # داشبورد مدیر (۷ بخش)
│   │   ├── login/page.tsx              # صفحه ورود
│   │   ├── page.tsx                    # صفحه اصلی (معرفی)
│   │   ├── layout.tsx                  # قالب سراسری + فونت
│   │   └── globals.css                 # استایل سراسری
│   ├── db/
│   │   ├── index.ts                    # اتصال پولر Postgres
│   │   └── schema.ts                   # تعریف ۹ جدول (Drizzle)
│   └── lib/
│       └── seed.ts                     # سید اولیه + نشست + کیف پول
├── supabase/
│   └── schema.sql                      # اسکیمای SQL (۹ جدول + دسترسی‌ها)
├── docs/
│   └── ARCHITECTURE-FA.md              # همین فایل
├── drizzle.config.ts                   # کانفیگ Drizzle Kit
├── next.config.ts / tsconfig.json      # کانفیگ Next و TypeScript
├── vercel.json                         # ریجن + تایم‌اوت توابع
├── package.json                        # وابستگی‌ها و اسکریپت‌ها
├── .env.example                        # نمونه متغیرها (بدون مقدار)
└── README.md                           # راهنمای راه‌اندازی
```

## ۲. مدل پایگاه داده (Supabase Schema — اسکیمای `agentos`)

> اسکیمای `public` متعلق به اپ دیگری است؛ همه جداول ما در `agentos` هستند.
> رول اتصال: `agentos` (فقط همین اسکیما، دسترسی CRUD حداقلی).

### ۲.۱ `users` — کاربران (مدیر)

```sql
CREATE TABLE agentos.users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,        -- ایمیل ورود (admin@freelance.ir)
  password_hash TEXT NOT NULL,       -- هش SHA-256 رمز
  name TEXT NOT NULL,                -- نام نمایشی
  role TEXT NOT NULL DEFAULT 'admin',
  created_at TIMESTAMP DEFAULT NOW()
);
```

### ۲.۲ `agents` — ایجنت‌ها (A1 تا A6)

```sql
CREATE TABLE agentos.agents (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,                -- مثال: A1 · آریا — کارمند رمزارز
  slug TEXT NOT NULL UNIQUE,         -- شناسه فنی: crypto-employee و...
  role TEXT NOT NULL,                -- نقش فارسی
  specialty TEXT NOT NULL DEFAULT 'crypto', -- crypto|freelance|bot|content|custom_api
  avatar TEXT NOT NULL DEFAULT '🤖', -- ایموجی
  status TEXT NOT NULL DEFAULT 'active',     -- active|paused
  api_endpoint TEXT NOT NULL DEFAULT '/api/agents/ingest',
  api_key TEXT NOT NULL,             -- کلید اختصاصی (ag_live_...)
  earned_usdt REAL NOT NULL DEFAULT 0,       -- درآمد واقعی ثبت‌شده
  tasks_completed INTEGER NOT NULL DEFAULT 0,
  payout_mode TEXT NOT NULL DEFAULT 'manual_approval',
  strategy TEXT NOT NULL DEFAULT '', -- استراتژی فارسی
  created_at TIMESTAMP DEFAULT NOW()
);
```

### ۲.۳ `projects` — محصولات و پروژه‌ها (S1 تا S6 + پروژه‌های مشتری)

```sql
CREATE TABLE agentos.projects (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,               -- مثال: S1 · لندینگ Next.js
  client_name TEXT NOT NULL,         -- خالی = خدمت آماده فروش
  telegram_user TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'تلگرام',     -- یا: کاتالوگ خدمات
  type TEXT NOT NULL DEFAULT 'nextjs',       -- nextjs|pptx|translation|bot|ai_agent|other
  status TEXT NOT NULL DEFAULT 'new',        -- new|negotiating|approved|in_progress|delivered|paid
  priority TEXT NOT NULL DEFAULT 'medium',
  budget_usdt REAL NOT NULL DEFAULT 0,
  received_usdt REAL NOT NULL DEFAULT 0,
  wallet TEXT NOT NULL DEFAULT '',
  deadline TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP DEFAULT NOW()
);
```

### ۲.۴ `tasks` — تسک‌ها و تأییدهای انسانی ✅/❌

```sql
CREATE TABLE agentos.tasks (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  agent TEXT NOT NULL DEFAULT 'ایجنت مذاکره',
  action_type TEXT NOT NULL DEFAULT 'send_message', -- send_message|payout|accept_project|...
  description TEXT NOT NULL DEFAULT '',
  project_title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',  -- pending|approved|rejected
  risk TEXT NOT NULL DEFAULT 'medium',     -- low|medium|high
  payload TEXT NOT NULL DEFAULT '',        -- جزئیات؛ برای برداشت: payout_tx:<id>
  created_at TIMESTAMP DEFAULT NOW()
);
```

### ۲.۵ `messages` — پیام‌های تلگرام/پنل

```sql
CREATE TABLE agentos.messages (
  id SERIAL PRIMARY KEY,
  chat_id TEXT NOT NULL DEFAULT '',  -- عددی واقعی = قابل پاسخ در تلگرام
  client_name TEXT NOT NULL,
  username TEXT NOT NULL DEFAULT '',
  direction TEXT NOT NULL DEFAULT 'in',     -- in|out
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'read',      -- read|unread
  source TEXT NOT NULL DEFAULT 'telegram',  -- telegram|panel|panel_telegram
  created_at TIMESTAMP DEFAULT NOW()
);
```

### ۲.۶ `transactions` — درآمدها و برداشت‌ها

```sql
CREATE TABLE agentos.transactions (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  project_title TEXT NOT NULL DEFAULT '',
  agent_name TEXT NOT NULL DEFAULT 'سیستم مرکزی',
  destination_wallet TEXT NOT NULL DEFAULT '', -- مقصد (متامسک)
  amount_usdt REAL NOT NULL DEFAULT 0,
  network TEXT NOT NULL DEFAULT 'TRC20',       -- BEP20|ERC20|Polygon|Arbitrum|TRC20
  tx_hash TEXT NOT NULL DEFAULT '',            -- مدرک آن‌چین (یا manual-admin)
  kind TEXT NOT NULL DEFAULT 'income',         -- income|payout
  status TEXT NOT NULL DEFAULT 'confirmed',    -- pending|approved|completed|rejected|confirmed
  created_at TIMESTAMP DEFAULT NOW()
);
```

### ۲.۷ `agent_logs` — لاگ رویدادها

```sql
CREATE TABLE agentos.agent_logs (
  id SERIAL PRIMARY KEY,
  agent TEXT NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'success',
  detail TEXT NOT NULL DEFAULT '',
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### ۲.۸ `tool_runs` — اجراهای ابزارها

```sql
CREATE TABLE agentos.tool_runs (
  id SERIAL PRIMARY KEY,
  tool TEXT NOT NULL,
  input TEXT NOT NULL DEFAULT '',
  output TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'done',  -- done|error|needs_key|queued
  created_at TIMESTAMP DEFAULT NOW()
);
```

### ۲.۹ `settings` — تنظیمات کلید/مقدار

```sql
CREATE TABLE agentos.settings (
  id SERIAL PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL DEFAULT ''
);
-- کلیدها: bot_username, bot_status, master_wallet_address, master_wallet_network,
-- auto_sweep_enabled(false), wallet, webhook, exchange_name, exchange_api_key,
-- exchange_api_secret, ai_provider, ai_api_key, ai_model,
-- risk_max_leverage, risk_require_sl
```

### ۲.۱۰ دسترسی‌ها (حداقلی)

```sql
GRANT USAGE ON SCHEMA agentos TO agentos;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA agentos TO agentos;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA agentos TO agentos;
-- + ALTER DEFAULT PRIVILEGES مشابه برای جداول آینده
```

## ۳. مسیرهای API و توابع سرور

همه APIها Next.js Route Handler هستند و روی Vercel به‌صورت سرورلس
(Fluid، حداکثر ۳۰ ثانیه) اجرا می‌شوند. ورکر دائمی/کرون وجود ندارد —
هر کاری با درخواست HTTP یا وب‌هوک تلگرام شروع می‌شود.

| متد | مسیر | کار | احراز هویت |
|---|---|---|---|
| GET/POST/PUT/DELETE | `/api/agents` | ساخت/ویرایش/حذف/لیست ایجنت‌ها + تولید `apiKey` | باز |
| GET/POST | `/api/agents/ingest` | ثبت درآمد واقعی؛ مبلغ اجباری، از بیرون `txHash` اجباری | کلید ایجنت یا نشست ادمین |
| GET/POST/DELETE | `/api/auth/login` | ورود (کوکی `session`)، وضعیت، خروج | رمز مدیر |
| POST | `/api/chats/reply` | ارسال واقعی پیام در تلگرام (فقط `chatId` عددی) | نشست ادمین |
| GET | `/api/health` | سلامت + اتصال دیتابیس | باز |
| GET/POST/PUT/DELETE | `/api/projects` | CRUD محصولات/پروژه‌ها | باز |
| GET/POST/PUT/DELETE | `/api/rest?type=` | CRUD عمومی `tasks`/`messages`/`transactions`/`logs`/`tools` | باز |
| GET/PUT | `/api/settings` | خواندن/ذخیره اتصال‌ها (محرمانه‌ها ماسک می‌شوند) + چک‌لیست نیازها | نشست ادمین |
| GET | `/api/stats` | آمار، قیمت زنده BTC/ETH (بایننس)، نمودار واقعی، موجودی | باز |
| GET/POST | `/api/telegram/webhook` | دریافت پیام/دکمه تلگرام؛ تأیید/رد تسک و برداشت در دیتابیس | سکرت وب‌هوک تلگرام |
| POST | `/api/tools/run` | مترجم واقعی (MyMemory)؛ بقیه ابزارها صادقانه `needs_key` | باز |
| GET/PUT | `/api/wallet` | موجودی (درآمد/برداشت/قابل‌برداشت) + ثبت آدرس متامسک با اعتبارسنجی | باز |
| POST/PUT | `/api/wallet/payout` | درخواست برداشت (تسک + پیام تلگرام) / تکمیل با هش | نشست ادمین |

### صفحات (Pages)

| مسیر | کار |
|---|---|
| `/` | صفحه معرفی |
| `/login` | ورود مدیر |
| `/control` | داشبورد: خانه، ایجنت‌ها، محصولات، برداشت، تأییدها، گفتگوها، اتصال‌ها |

### ایجنت‌های فعال (دیتابیس، نه کد جدا)

| کد | نام | تخصص | ورودی درآمد |
|---|---|---|---|
| A1 | آریا — کارمند رمزارز | crypto | `/api/agents/ingest` (کلید `ag_live_crypto_arya_9821`) |
| A2 | سازنده وب — Next.js | freelance | دستی از داشبورد |
| A3 | فروشنده تلگرام | bot | وب‌هوک تلگرام + دستی |
| A4 | طراح ارائه | content | دستی |
| A5 | مترجم | content | دستی |
| A6 | وب‌هوک خارجی | custom_api | ربات/n8n/TradingView بیرونی |

### جریان‌های اصلی داده

```text
درآمد واقعی:  ایجنت/ربات بیرونی --(مبلغ+هش)--> /api/agents/ingest --> transactions + agents
برداشت:      داشبورد --> /api/wallet/payout --> تسک pending + پیام تلگرام --(✅)--> approved
              --> انتقال دستی در متامسک --> ثبت هش --> completed
پیام تلگرام:  کاربر --> وب‌هوک --> messages + تسک پاسخ --> ادمین تأیید --> /api/chats/reply
تنظیمات:     داشبورد --> /api/settings --> settings (محرمانه‌ها فقط ماسک‌شده خوانده می‌شوند)
```

## ۴. متغیرهای محیطی (فقط نام کلیدها — بدون مقدار)

در Vercel روی هر سه محیط (`production`/`preview`/`development`) ست شده‌اند.
موارد `sensitive` حتی از API ورسل هم قابل خواندن نیستند.

| کلید | نوع | کاربرد |
|---|---|---|
| `DATABASE_URL` | sensitive | اتصال پولر (6543، بدون `sslmode`) |
| `DIRECT_URL` | sensitive | اتصال مستقیم (5432، مایگریشن) |
| `ADMIN_EMAIL` | عادی | ایمیل ورود مدیر |
| `ADMIN_PASSWORD` | sensitive | رمز ورود مدیر |
| `AUTH_SECRET` | sensitive | امضای کوکی نشست |
| `MASTER_WALLET_ADDRESS` | عادی | پیش‌فرض آدرس برداشت (خالی) |
| `MASTER_WALLET_NETWORK` | عادی | پیش‌فرض شبکه (`USDT-BEP20`) |
| `TELEGRAM_BOT_TOKEN` | sensitive | توکن ربات تلگرام |
| `TELEGRAM_CHAT_ID` | عادی | چت پیش‌فرض |
| `TELEGRAM_ADMIN_CHAT_ID` | عادی | چت ادمین (اعلان‌ها) |
| `TELEGRAM_WEBHOOK_SECRET` | sensitive | سکرت راستی‌آزمایی وب‌هوک |
| `AGENT_MASTER_API_KEY` | (اختیاری، فعلاً ست نشده) | کلید مادر ingest |

## ۵. فایل‌های کانفیگ اصلی

### ۵.۱ `package.json`

```json
{
  "name": "nextjs-postgresql-template",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "dotenv": "17.3.1",
    "drizzle-orm": "0.45.2",
    "next": "16.2.6",
    "pg": "8.20.0",
    "react": "19.2.6",
    "react-dom": "19.2.6"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "4.1.17",
    "@types/node": "22.19.15",
    "@types/pg": "8.18.0",
    "@types/react": "19.2.14",
    "@types/react-dom": "19.2.3",
    "drizzle-kit": "0.31.10",
    "eslint": "9.39.4",
    "eslint-config-next": "16.2.6",
    "postcss": "8.5.8",
    "tailwindcss": "4.1.17",
    "typescript": "5.9.3"
  }
}
```

### ۵.۲ `vercel.json`

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "nextjs",
  "regions": ["fra1"],
  "functions": {
    "src/app/api/**/*.ts": {
      "maxDuration": 30
    }
  }
}
```

## ۶. اجرای محلی و استقرار (خلاصه)

```bash
cp .env.example .env   # پر کردن مقادیر واقعی (هرگز کامیت نشود)
npm ci
npm run typecheck      # کنترل تایپ
npm run dev            # اجرای محلی
```

- استقرار: دستی از همین شاخه گیت به پروژه `freelance-agent-os` (تولید).
- قراردادها: اسم ایجنت `A<n> · ...`، محصول `S<n> · ...`؛ هیچ عدد مالی
  بدون مدرک ثبت نمی‌شود؛ هیچ برداشتی بدون تأیید تلگرام انجام نمی‌شود.
