# 🏢 Agent Company OS — ساختمان اداری ایجنت‌های درآمدزا

پلتفرم مدیریت مجموعه‌ای از **کارمندان دیجیتال** (تریدر رمزارز، توسعه‌دهنده، فروشنده تلگرام، تولید محتوا و ایجنت‌های وب‌هوک خارجی) که:

- هر کارمند **دفتر مستقل، هدف مشخص و گزارش واقعی** دارد؛
- همه‌ی درآمدها به **کیف پول واحد USDT** نسبت داده می‌شوند؛
- **هیچ داده‌ی ساختگی (Mock/Random) در کد نیست** — درآمد فقط با شاهد تراکنش، سفارش واقعی صرافی یا تأیید مدیرعامل ثبت می‌شود؛
- دستورهای حساس با **دکمه‌های شیشه‌ای تلگرام (Human-in-the-Loop)** تأیید و همان لحظه در دیتابیس و صرافی اجرا می‌شوند.

---

## ۱) چه چیزی «واقعی» شد؟ (حذف کامل Mock)

| قبل (نمایشی) | حالا (عملیاتی) |
| --- | --- |
| `Math.random()` برای مبلغ پاداش و مدت اجرا | مبلغ فقط از ورودی واقعی؛ مدت اجرا با اندازه‌گیری واقعی (`Date.now`) |
| هش تراکنش تصادفی `ab12...cd34` | هش واقعی اجباری + تأیید زنجیره‌ای (TronGrid / Etherscan) |
| «اجرای فوری کارمند رمزارز» که پول می‌ساخت | `market_scan` واقعی + سفارش واقعی صرافی فقط پس از تأیید |
| قیمت BTC/ETH با `Math.random()` | قیمت واقعی Binance با فالبک OKX و ذخیره در `market_snapshots` |
| نمودار درآمد با اعداد ثابت | `GROUP BY month` روی تراکنش‌های تأییدشده |
| ابزارها خروجی جعلی می‌ساختند | اجرای واقعی توسط ورکر (`AGENT_WORKER_URL`)؛ بدون ورکر → خطای صریح |
| سید با ۵ تراکنش و ۶ پروژه‌ی ساختگی | سید فقط «چارت سازمانی» با درآمد صفر |
| وبهوک تلگرام فقط لاگ می‌نوشت | وبهوک واقعی: `answerCallbackQuery` + اجرای Job + ویرایش پیام |
| تأیید از پنل، پیام جعلی به خود webhook می‌فرستاد | تأیید مستقیم از API واقعی `/api/jobs` |

نکته‌ی مهم: سیستم **هیچ‌وقت** عددی از خودش نمی‌سازد. اگر صرافی/تلگرام در دسترس یا پیکربندی نشده باشد، پاسخ صریح `503 / not_configured` با دلیل فارسی برمی‌گردد و در `system_events` ثبت می‌شود.

---

## ۲) نقشه‌ی معماری

```
Vercel Cron ──► /api/cron/tick ──► market_snapshots / agent_jobs / گزارش تلگرام
                                        │
Telegram (دکمه تأیید) ──► /api/telegram/webhook ──► approveJob()
                                        │
                                   اجرای واقعی
                        ┌───────────────┼────────────────┐
                        ▼               ▼                ▼
                 Binance Order   تأیید واریز زنجیره‌ای   گزارش/Gemini
                        │               │
                        └────► transactions + agent_activity_logs
                                        │
                          agentos.record_agent_revenue()  (اتمیک)
                                        │
                            agents.earned_usdt + هدف کارمند
```

### جدول‌های جدید (اسکیمای `agentos`)
| جدول | کارکرد |
| --- | --- |
| `agent_activity_logs` | دفتر رویدادهای واقعی هر کارمند (پاداش، خطا، منبع، هش) |
| `agent_jobs` | صف کار + گردش تأیید (`awaiting_approval → approved → running → succeeded/failed`) |
| `exchange_orders` | تمام سفارش‌های ارسال‌شده به صرافی با پاسخ خام |
| `market_snapshots` | تاریخچه‌ی قیمت واقعی |
| `telegram_updates` | ضدتکرار آپدیت‌های تلگرام (`update_id` یکتا) |
| `cron_runs` | نتیجه و مدت هر اجرای کرون |
| `system_events` | خطاها و هشدارهای واقعی برای دیباگ |

توابع دیتابیس: `agentos.record_agent_revenue(...)`، `agentos.increment_agent_success(...)`، `agentos.increment_agent_error(...)`.

---

## ۳) استقرار (Vercel + Supabase)

### گام ۱ — ساختار دیتابیس
در **Supabase → SQL Editor** کل `supabase/schema.sql` را اجرا کنید (idempotent است).
اگر از نسخه‌ی نمایشی قبلی داده دارید، یک‌بار `supabase/purge_demo_data.sql` را هم اجرا کنید تا داده‌های ساختگی حذف و درآمدها بازمحاسبه شوند.

### گام ۲ — متغیرهای محیطی (Vercel → Settings → Environment Variables)
حداقل‌های الزامی:

| کلید | توضیح |
| --- | --- |
| `DATABASE_URL` | رشته‌ی Pooler سوپابیس (پورت 6543) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | ورود مدیرعامل (رمز پیش‌فرض را عوض کنید) |
| `AUTH_SECRET` | رشته‌ی تصادفی ۶۴ کاراکتری برای امضای نشست |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_ADMIN_CHAT_ID` | ربات و چت‌آیدی شما |
| `CRON_SECRET` | کلید اجرای کرون |

توصیه‌شده: `MASTER_WALLET_ADDRESS`, `MASTER_WALLET_NETWORK`, `TELEGRAM_WEBHOOK_SECRET`, `NEXT_PUBLIC_APP_URL`, `EXCHANGE_API_KEY`, `EXCHANGE_SECRET_KEY` (نام قدیمی `EXCHANGE_API_SECRET` هم پذیرفته می‌شود), `EXCHANGE_TESTNET`, `AGENT_TRADING_ENABLED`, `TRONGRID_API_KEY`/`ETHERSCAN_API_KEY`, `GEMINI_API_KEY`, `AGENT_WORKER_URL`.

فایل کامل با توضیح هر کلید: [`.env.example`](./.env.example).
> `NEXT_PUBLIC_SUPABASE_URL` و `SUPABASE_SERVICE_ROLE_KEY` اختیاری‌اند؛ این پروژه مستقیم با Postgres کار می‌کند و برای امنیت، تنها یک مسیر دسترسی (Pooler + رول محدود) دارد.

### گام ۳ — Cron
`vercel.json` دو کرون دارد (سازگار با پلن Hobby = یک‌بار در روز):

```json
{ "path": "/api/cron/tick?job=full",    "schedule": "0 6 * * *" },
{ "path": "/api/cron/tick?job=reports", "schedule": "30 6 * * *" }
```

اگر پلن Pro دارید و اسکن هر ۱۰ دقیقه می‌خواهید، `schedule` را به `*/10 * * * *` تغییر دهید. جایگزین روی Hobby: یک سرویس Ping (مثل cron-job.org) با آدرس
`/api/cron/tick?job=full&secret=CRON_SECRET` و متد GET.

### گام ۴ — اتصال تلگرام
1. توکن ربات را از @BotFather بگیرید و `TELEGRAM_BOT_TOKEN` را ست کنید.
2. چت‌آیدی خود را با `/id` در ربات بگیرید و در `TELEGRAM_ADMIN_CHAT_ID` بگذارید.
3. در داشبورد → **🩺 دیباگ و لاگ سیستم** → دکمه‌ی **🔗 ثبت وبهوک تلگرام** را بزنید (یا در ترمینال):

```bash
curl -X POST "https://YOUR-APP.vercel.app/api/telegram/setup" \
  -H "Cookie: session=..." -H "Content-Type: application/json" \
  -d '{"action":"set"}'
```
4. تست: `/start` و `/status` در ربات.

**کجا نگهداری می‌شود (تا دیگر لازم نباشد توکن را دوباره پیدا/پیست کنید):**

| محل | چه چیزی | قابل commit است؟ |
| --- | --- | --- |
| Vercel → Settings → Environment Variables | `TELEGRAM_BOT_TOKEN` (نوع Sensitive)، `TELEGRAM_ADMIN_CHAT_ID`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET` | نه؛ فقط در پنل Vercel |
| فایل `.env.local` در ریشه پروژه | همان کلیدها برای اجرای محلی | نه؛ در `.gitignore` |
| GitHub Actions Secrets (اختیاری) | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` برای ثبت وبهوک از CI | نه؛ رمزنگاری‌شده |

- توکن هرگز داخل کد یا فایل ترک‌شده قرار نمی‌گیرد (ریپو عمومی است). کد فقط `process.env.TELEGRAM_BOT_TOKEN` را می‌خواند.
- **تعویض توکن** (Rotate): توکن جدید را از @BotFather بگیرید → در Vercel (هر سه محیط) و در `.env.local` به‌روزرسانی کنید → Redeploy → دوباره دکمه‌ی **🔗 ثبت وبهوک تلگرام** را بزنید (چون توکن عوض شده، وبهوک قبلی باطل است).
- اگر محیطی (مثل sandbox توسعه) به `api.telegram.org` دسترسی ندارد، ثبت وبهوک را از داشبورد همان دیپلوی یا مستقیماً با این آدرس در مرورگر انجام دهید:
  `https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://YOUR-APP.vercel.app/api/telegram/webhook&secret_token=<TELEGRAM_WEBHOOK_SECRET>`
  پاسخ `{"ok":true,...}` یعنی توکن معتبر است و وبهوک ثبت شد؛ برای بررسی: `.../getWebhookInfo`.

### گام ۵ — اتصال صرافی (آریا)
1. ابتدا کلیدهای **Testnet** بایننس (`https://testnet.binance.vision`) را بسازید.
2. `EXCHANGE_TESTNET=true`, `AGENT_TRADING_ENABLED=false` → برای تست، `true` کنید.
3. در دفتر آریا → «📡 اسکن واقعی بازار» و «🪙 درخواست معامله» → تأیید در تلگرام/پنل.
4. بعد از موفقیت در Testnet، کلیدهای Mainnet را جایگزین کنید.

قفل ایمنی: بدون `AGENT_TRADING_ENABLED=true` هیچ سفارشی ارسال نمی‌شود (خطای `exchange_trading_disabled`).

---

## ۴) APIهای عملیاتی

| مسیر | متد | کارکرد |
| --- | --- | --- |
| `/api/agents` | GET/POST/PUT/DELETE | چارت سازمانی و استخدام کارمند (کلید API واقعی) |
| `/api/agents/ingest` | POST | دریافت درآمد خارجی با **الزام** `x-agent-key` + `amountUsdt` + `txHash` |
| `/api/agents/{id}/office` | GET | تمام داده‌ی دفتر: هدف، فعالیت، صف کار، درآمد، زیرساخت |
| `/api/agents/{id}/report` | POST | گزارش وضعیت از داده‌ی واقعی (+ ارسال تلگرام + Gemini اختیاری) |
| `/api/agents/{id}/command` | POST | `market_scan` / `request_trade` / `tool_run` / `toggle` / `set_focus` |
| `/api/jobs` | GET/POST/PATCH | صف کار و تأیید/رد/تلاش دوباره |
| `/api/jobs` PATCH `{action:"approve"}` | | اجرای واقعی (سفارش صرافی یا تأیید واریز) |
| `/api/telegram/webhook` | POST | وبهوک واقعی (ضدتکرار + سکرت) |
| `/api/telegram/setup` | GET/POST | وضعیت و ثبت/حذف وبهوک |
| `/api/telegram/send` | POST | پیام واقعی / گزارش روزانه همه کارمندان |
| `/api/cron/tick` | GET/POST | کرون واقعی (`market`,`queue`,`approvals`,`expire`,`reports`,`cleanup`) |
| `/api/market` | GET/POST | قیمت واقعی و ذخیره اسنپ‌شات |
| `/api/system/status` | GET | چک‌لیست env، دیتابیس، صرافی، تلگرام، کرون، خطاها |
| `/api/health` | GET | سلامت دیتابیس + وجود جدول‌ها |

### نمونه‌ی اتصال ربات بیرونی

```bash
curl -X POST https://YOUR-APP.vercel.app/api/agents/ingest \
  -H "Content-Type: application/json" \
  -H "x-agent-key: ag_live_xxxxxxxx" \
  -d '{
    "amountUsdt": 55.25,
    "txHash": "0x9f41c0d2b7a8e6f5d4c3b2a1908f7e6d5c4b3a2910f8e7d6c5b4a39281706f5e",
    "network": "BEP20",
    "title": "سود واقعی آربیتراژ"
  }'
```

پاسخ‌ها:
- `confirmed` → واریز روی زنجیره تأیید شد و درآمد ثبت شد؛
- `pending_verification` → درآمد ثبت نشد، Job تأیید ساخته و به تلگرام ارسال شد؛
- `duplicate: true` → همین هش قبلاً ثبت شده (ضد درآمد تکراری).
- `422` → بدون `txHash` هیچ درآمدی پذیرفته نمی‌شود.

---

## ۵) چک‌لیست دیباگ (صفحه‌ی 🩺 در داشبورد)
1. **دیتابیس**: `GET /api/health` → `{ok:true}` و `missingTables: []`.
2. **Environment Variables**: صفحه‌ی دیباگ حضور همه‌ی کلیدها را نشان می‌دهد (فقط présence، هرگز مقدار).
3. **Runtime Logs**: در Vercel → Deployments → Logs؛ همچنین `system_events` در صفحه‌ی دیباگ.
4. **وبهوک تلگرام**: دکمه‌ی ثبت وبهوک + `/webhook` در ربات.
5. **صرافی**: دکمه‌ی «تست اتصال صرافی» (قیمت + موجودی واقعی).
6. **کرون**: دکمه‌ی «اجرای دستی کرون» و جدول `cron_runs`.

خطاهای رایج:

| نشانه | علت | راه‌حل |
| --- | --- | --- |
| `relation "agentos.agent_jobs" does not exist` | schema.sql اجرا نشده | SQL Editor → اجرای کامل `supabase/schema.sql` |
| `SELF_SIGNED_CERT_IN_CHAIN` | `sslmode` در DATABASE_URL | آن را حذف کنید (اپ TLS را خودش مدیریت می‌کند) |
| `message text is empty` تلگرام | پیام خالی/HTML نامعتبر | متن غیرخالی بفرستید؛ escape خودکار است |
| `exchange_trading_disabled` | قفل ایمنی | `AGENT_TRADING_ENABLED=true` + کلیدها |
| `worker_not_configured` | ورکر ابزار ست نشده | `AGENT_WORKER_URL` را ست کنید |
| واریز «در انتظار تأیید» ماند | تأیید زنجیره‌ای ندارید | کلید TronGrid/Etherscan یا تأیید دستی از صف تأیید |
| قیمت بازار خالی است | دسترسی به Binance/OKX ندارید | قیمت قبلی با برچسب «قدیمی» نمایش داده می‌شود؛ فالبک OKX فعال است |

### ۵.۱) پاسخ خطای همیشه-JSON (رفع خطای «Unexpected end of JSON input»)

هر endpoint این پروژه — چه GET و چه POST/PUT/DELETE — از یک لایه‌ی مشترک
(`src/lib/api-response.ts` → `safeRoute`) عبور می‌کند. بنابراین **بدنه‌ی پاسخ هرگز خالی نیست**
و همیشه JSON معتبر با پیام فارسی برمی‌گردد:

| وضعیت | `code` | معنی |
| --- | --- | --- |
| `400` | `bad_request` / `missing_fields` | بدنه‌ی ورودی نامعتبر یا خالی |
| `401` | `invalid_credentials` | ایمیل یا رمز اشتباه |
| `429` | `rate_limited` | بیش از ۱۲ تلاش ورود در ۱۰ دقیقه |
| `503` | `database_unavailable` | دیتابیس یا سرویس بیرونی در دسترس نیست |
| `503` | `auth_secret_missing` | `AUTH_SECRET` روی سرور ست نشده |
| `500` | `internal_error` | خطای داخلی ناشناخته |

> اگر قبلاً در مرورگر «Failed to execute 'json' on 'Response': Unexpected end of JSON input»
> می‌دیدید، آن خطا دیگر رخ نمی‌دهد: هم سرور JSON معتبر برمی‌گرداند و هم
> `src/app/login/page.tsx` پاسخ را با `res.text()` می‌خواند و در صورت خالی‌بودن
> پیام فارسی «سرویس موقتاً در دسترس نیست» نشان می‌دهد.

**همگام‌سازی خودکار رمز مدیر:** `ensureSeed()` در هر اجرا رمز کاربران با نقش `admin` را با
`ADMIN_PASSWORD` همگام می‌کند. بنابراین اگر رمز را در Vercel یا `config.json` عوض کنید،
نیازی به ویرایش دستی دیتابیس نیست — کافی است یک‌بار وارد صفحه‌ی ورود شوید.

---

## ۶) داشبورد «محیط شرکت»

- **🏢 ساختمان مرکزی**: هر کارمند یک کارت-دفتر با پنجره، میز، صندلی، درِ اتاق، چراغ وضعیت و **هدف ماه**؛ کلیک → ورود به دفتر.
- **دفتر هر کارمند** (`/control/office/{id}`): صحنه‌ی سه‌بعدی‌نمای اتاق (دیوار، منظره شهر، مانیتور با لاگ زنده، تابلوی هدف، درِ دفتر)، شش KPI، صف کار و تأییدها، تراکنش‌های واقعی، گزارش وضعیت، خطاها و وضعیت زیرساخت.
- **🩺 دیباگ**: چک‌لیست env، جدول‌های دیتابیس، تست صرافی/وبهوک، اجرای دستی کرون و خطاهای ۲۴ ساعت.

---

## ۷) پرونده‌ی دائمی کلیدها (لحظه‌ای گم نمی‌شوند)

این پروژه یک **لایه‌ی پیکربندی پایدار** دارد تا کلیدهای API با هر بازنویسی کد از بیرون نروند.

### منبع حقیقت واحد: `config.json`

فایل `config.json` در ریشه‌ی پروژه، **پرونده‌ی دائمی کلیدها** است. تمام ماژول‌ها از طریق `conf()` در `src/lib/config.ts` مقدارها را می‌خوانند و **هرگز مستقیماً `process.env` را صدا نمی‌زنند**.

### ترتیب اولویت خواندن (اولین مقدار معتبر برنده است)

```
۱) متغیر محیطی Vercel / سیستم‌عامل   ← پایدار بین همه‌ی دیپلوی‌ها
۲) config.json                          ← پرونده‌ی دائمی داخل مخزن
۳) .env.local / .env                   ← فقط توسعه‌ی محلی
```

بنابراین تا وقتی `config.json` یا متغیرهای محیطی دست‌نخورده باشند، **هیچ کلیدی با تغییر کد از کار نمی‌افتد**.

### ثبت کامل کلیدها

| کلید | کارکرد | وضعیت |
| --- | --- | --- |
| `GEMINI_API_KEY` | مغز متفکر: نوشتن گزارش وضعیت ایجنت‌ها | ✅ ست شده |
| `GEMINI_MODEL` | مدل پیش‌فرض جمینای | ✅ `gemini-2.0-flash` |
| `TELEGRAM_BOT_TOKEN` | پل ارتباطی با تلگرام + دکمه‌های تأیید | ✅ ست شده |
| `TELEGRAM_ADMIN_CHAT_ID` | مقصد ارسال درخواست‌های تأیید | ✅ `7590237754` |
| `TELEGRAM_CHAT_ID` | چت‌آیدی اصلی | ✅ `7590237754` |
| `TELEGRAM_BOT_USERNAME` | نام ربات | ✅ `sina_freelance_agent_bot` |
| `TELEGRAM_WEBHOOK_SECRET` | سکرت وبهوک (رد درخواست جعلی) | ✅ ست شده |
| `DATABASE_URL` | اتصال Pooler سوپابیس (پورت ۶۵۴۳) | ✅ ست شده |
| `DIRECT_URL` | اتصال مستقیم برای migration (پورت ۵۴۳۲) | ✅ ست شده |
| `NEXT_PUBLIC_SUPABASE_URL` | آدرس پروژه‌ی سوپابیس | ✅ ست شده |
| `SUPABASE_SERVICE_ROLE_KEY` | Service Role Key | ✅ ست شده |
| `EXCHANGE_API_KEY` | کلید API صرافی برای ایجنت تریدر (آریا) | ✅ ست شده |
| `EXCHANGE_SECRET_KEY` | سکرت امضای HMAC سفارش‌ها | ✅ ست شده |
| `EXCHANGE_API_SECRET` | نام جایگزین همان سکرت | ✅ ست شده |
| `EXCHANGE_TESTNET` | `true` → سفارش‌ها روی Testnet | ✅ `true` (امن) |
| `AGENT_TRADING_ENABLED` | قفل ایمنی ارسال سفارش واقعی | ✅ `false` (قفل) |
| `ADMIN_EMAIL` | ایمیل مدیرعامل | ✅ `admin@freelance.ir` |
| `ADMIN_PASSWORD` | رمز ورود مدیر | ✅ ست شده |
| `AUTH_SECRET` | کلید امضای نشست (HMAC) | ✅ ست شده |
| `ADMIN_API_SECRET` | دسترسی ماشین‌به‌ماشین (هدر `x-admin-secret`) | ✅ ست شده |
| `AGENT_MASTER_API_KEY` | کلید سراسری ربات‌های بیرونی | ✅ ست شده |
| `CRON_SECRET` | اجازه‌ی اجرای `/api/cron/tick` | ✅ ست شده |
| `MASTER_WALLET_ADDRESS` | مقصد واریز درآمد همه‌ی کارمندان | ✅ ست شده |
| `MASTER_WALLET_NETWORK` | شبکه‌ی کیف پول واحد | ✅ `BEP20` |
| `TRONGRID_API_KEY` | تأیید خودکار واریز TRC20 | ⚪️ اختیاری |
| `ETHERSCAN_API_KEY` | تأیید خودکار واریز ERC20/BEP20 | ⚪️ اختیاری |
| `AGENT_WORKER_URL` | وبهوک اجرای واقعی ابزارها (n8n) | ⚪️ اختیاری |
| `AGENT_WORKER_TOKEN` | توکن احراز هویت ورکر | ⚪️ اختیاری |
| `NEXT_PUBLIC_APP_URL` | دامنه‌ی عمومی (ساخت آدرس وبهوک) | ✅ ست شده |

### چطور تغییرشان بدهیم؟

```bash
# ۱) ویرایش پرونده‌ی دائمی (ساختارش در config.example.json است)
nano config.json

# ۲) بررسی اینکه همه‌چیز درست resolve می‌شود
npm run verify:config

# ۳) اگر Vercel را هم به‌روز کردی، یک Redeploy لازم است
```

`npm run verify:config` همه‌ی کلیدها را چک می‌کند و **با پاک کردن کامل `process.env` دوباره می‌خواند** تا ثابت شود که کلیدها فقط به env وابسته نیستند.

### ⚠️ نکته‌ی امنیتی (مهم)

`config.json` در `.gitignore` است و **نباید** به گیت commit شود. ساختار آن در `config.example.json` (بدون هیچ مقدار واقعی) نگهداری می‌شود.

برای اینکه کلیدها در هیچ شرایطی از بین نروند، **هر دو لایه** را نگه دار:

1. **Vercel Environment Variables** (نوع `sensitive`) — پایدار بین همه‌ی دیپلوی‌ها و بکاپ‌شده در حساب Vercel.
2. **`config.json`** — پرونده‌ی دائمی داخل مخزن، برای وقتی که می‌خواهی کلیدها در پروژه «میخکوب» بمانند.

اگر یکی پاک شود، دیگری کار را ادامه می‌دهد. چون `config.json` در گیت نیست، توصیه می‌شود یک کپی رمزگذاری‌شده از آن جدا از گیت نگه داری.

### چرخش (Rotation) کلیدها

- **تلگرام**: `@BotFather` → `/token` → کلید جدید → مقدار جدید در `config.json` **و** Vercel → Redeploy → `POST /api/telegram/setup`.
- **صرافی**: Binance → API Management → کلید جدید → `EXCHANGE_API_KEY` + `EXCHANGE_SECRET_KEY` → Redeploy.
- **جمینای**: Google AI Studio → کلید جدید → `GEMINI_API_KEY` → Redeploy.

---

## ۸) اجرای محلی

```bash
cp config.example.json config.json   # پرونده‌ی دائمی کلیدها (ساختار را کپی کنید)
cp .env.example .env.local           # فقط برای توسعه‌ی محلی
npm install
npm run verify:config                # مطمئن شوید همه‌ی کلیدها resolve می‌شوند
npm run dev                          # http://localhost:3000
```

- `DATABASE_URL` لوکال: `postgres://user:pass@127.0.0.1:5432/postgres`
- ساخت جدول‌ها: `psql "$DIRECT_URL" -f supabase/schema.sql`
- ورود: `ADMIN_EMAIL` / `ADMIN_PASSWORD`
- **نکته:** کلیدها از `config.json` خوانده می‌شوند؛ `.env.local` فقط لایه‌ی کمکی توسعه است.

---

## ساختار کد

```
src/lib/
  config.ts          ⭐ لایه‌ی پیکربندی پایدار: conf() → env → config.json → .env.local
  env.ts             چک‌لیست متغیرها + ConfigError + موجودی پرونده‌ی دائمی
  auth.ts            نشست HttpOnly + محافظت از عملیات حساس
  telegram.ts        کلاینت واقعی Bot API (کیبورد شیشه‌ای، ویرایش، وبهوک)
  exchange.ts        Binance Spot/Testnet (امضا HMAC، سفارش، موجودی، قیمت)
  market.ts          قیمت واقعی + اسنپ‌شات در دیتابیس
  onchain.ts         تأیید واریز TRC20/ERC20/BEP20
  agent-execution.ts ثبت درآمد واقعی، ضدتکرار، تأیید واریز، ثبت خطا
  jobs.ts            صف کار، تأیید/اجرا، یادآوری، کرون
  report.ts          گزارش وضعیت از داده واقعی (+ Gemini اختیاری)
  seed.ts            چارت سازمانی و تنظیمات اولیه (بدون داده ساختگی)
src/app/api/...      اندپوینت‌های واقعی (فهرست بالا)
src/app/control/     داشبورد ساختمان، دفتر هر کارمند، صفحه دیباگ
```
