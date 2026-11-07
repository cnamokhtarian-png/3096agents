# 🤖 مرکز کنترل ناوگان ایجنت‌ها و فریلنسری خودکار (Freelance & Crypto Agent OS)

پلتفرم جامع مدیریت **مجموعه‌ای از ایجنت‌های درآمدزا** (از جمله **کارمند تخصصی رمزارز**، ایجنت شکار پروژه Next.js، ایجنت فروش تلگرام، ایجنت ساخت PPTX، ایجنت مترجم Web3 و ایجنت‌های وب‌هوک خارجی) که همگی درآمد USDT خود را به **یک کیف پول واحد مرکزی (Unified Master Wallet)** واریز می‌کنند.

---

## ✨ قابلیت‌های کلیدی
- **🪙 کارمند تخصصی رمزارز (Crypto Employee Agent):** رصد آربیتراژ DEX/CEX، تحلیل جریان نهنگ‌ها، شکار ایردراپ و کپی‌ترید با گزارش کامل و واریز سود به کیف پول واحد.
- **🤖 ناوگان ایجنت‌ها + ایجنت‌ساز و API اختصاصی:** ساخت ایجنت/کارمند دیجیتال جدید با کلید API اختصاصی (`x-agent-key`) و اندپوینت استاندارد `POST /api/agents/ingest` برای اتصال ربات‌های پایتون، TradingView، n8n یا هر سرویس خارجی دیگر.
- **💳 کیف پول واحد مرکزی (Unified Master Vault):** تنظیم آدرس کیف پول واحد (TRC20 / TON / BEP20 / ERC20) و تجمیع خودکار درآمد تمام ایجنت‌ها و پروژه‌ها در یک مقصد واحد.
- **📩 ربات تلگرام و تأیید انسانی (HITL):** همگام‌سازی Webhook تلگرام با دکمه‌های شیشه‌ای (`Inline Keyboard`) برای تأیید یا رد تسک‌ها.
- **💼 مدیریت کامل پروژه‌های کریپتویی (CRUD):** جستجو، فیلتر وضعیت، پیگیری پرداخت USDT و چت تعاملی با مشتریان.
- **🏆 لیگ کارمندان (Agent Leaderboard):** سیستم ارزیابی و رقابت بین ایجنتها با KPI وزندار، «کارمند برتر ماه»، گزارش خودکار تلگرام و پاداش ساختاری (اولویت تخصیص منابع).
- **🪙 میز کار آریا (A1) در `/agents/crypto-arya`:** تریدر حرفهای با دادهٔ واقعی صرافی/ترس و طمع، موتور ریسک اهرمدار، پیشنهاد معامله با تأیید انسانی، پوزیشن زنده، بستن خودکار TP/SL و دفترچه خاطرات تحلیل.

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

## 🏆 لیگ کارمندان / کارمند برتر ماه (Gamification)

هر ایجنت یک پروفایل عملکردی دارد. بهجای «تعداد کار»، **کیفیت، ارزش خروجی و سرعت بدون خطا** امتیاز میگیرد:

| شاخص | وزن پیشفرض | منبع داده | محاسبه |
| --- | --- | --- | --- |
| نرخ موفقیت | ۶۰٪ | `agent_score_events` | `(موفقیت + ۱) / (کل پروژهها + ۲)` — هموارسازی لاپلاس؛ جلوی صدرنشینی با یک پروژه را میگیرد |
| حجم و ارزش خروجی | ۳۰٪ | `transactions` | `min(1, درآمد تأییدشدهٔ دوره / هدف ۱۰۰۰ USDT)` |
| سرعت و دقت | ۱۰٪ | `agent_score_events` | `min(1, زمان هدف ۶۰ دقیقه / میانگین زمان پیشنهاد←تأیید پروژههای موفق)` |

`Score = 100 × (w₁·SR + w₂·RS + w₃·SS)` — وزنها، هدف درآمد، زمان هدف و ضریب پاداش از داشبورد
(تب «🏆 لیگ کارمندان») قابل تغییرند و در جدول `settings` ذخیره میشوند.

**جریان ثبت امتیاز (ضد تقلب):**

1. تأیید/رد انسانی (HITL) از پنل یا دکمههای شیشهای تلگرام → `POST /api/telegram/webhook` یک ردیف در دفترچهٔ نتایج میسازد: موفقیت `+10`، شکست `-5`، خطای اجرایی `-8`.
2. واریز سود توسط هر ایجنت (`POST /api/agents/ingest`) هم یک «موفقیت» ثبت میکند و رتبهٔ لحظهای ایجنت را در پاسخ برمیگرداند.
3. کلید یکتای `source_ref` (مثلاً `task:12:approve` یا `ingest:88`) تضمین میکند یک رویداد دوبار شمرده نشود.
4. درآمد فقط از `transactions` خوانده میشود، بنابراین «ثبت نتیجه» و «واریز پول» دوبار در KPI درآمد اثر نمیگذارند.
5. ایجنتی که در یک دوره حداقل ۳ پروژه داشته و نرخ موفقیتش زیر ۶۰٪ باشد، بهصورت خودکار در لاگها «⚠️ نیازمند بازبینی پرامپت» علامت میخورد.

**گزارش ماهانه و پاداش:**

- `POST /api/leaderboard/close` برنده را در `agent_monthly_awards` ذخیره میکند، پیام
  «🏆 کارمند برتر ماه … با ۹۴٪ پروژه موفق و ۱۲۰ تتر سود خالص» را به `TELEGRAM_ADMIN_CHAT_ID` میفرستد
  و **اولویت ۲ برابری اسکن بازار / تخصیص مأموریت** را برای دورهٔ بعد فعال میکند.
- `GET /api/leaderboard/close?period=YYYY-MM` یک پیشنمایش خشک (dry-run) بدون هیچ نوشتن یا ارسالی میدهد.
- Vercel Cron (`vercel.json` → `0 0 1 * *`) اول هر ماه `GET /api/leaderboard/cron` را صدا میزند
  (امنیت با `CRON_SECRET`، و idempotent است تا پیام تکراری ارسال نشود).

**اندپوینتهای لیگ:**

| متد | مسیر | کاربرد |
| --- | --- | --- |
| `GET` | `/api/leaderboard?period=YYYY-MM` | جدول رتبهبندی، تفکیک امتیاز، برنده، رویدادها، تاریخچه، پاداش فعال |
| `PUT` | `/api/leaderboard` | تغییر وزنها/اهداف فرمول |
| `POST` | `/api/leaderboard/events` | ثبت نتیجهٔ دستی یا از ایجنت خارجی (هدر `x-agent-key`) |
| `DELETE` | `/api/leaderboard/events?id=..` یا `?source=seed` | حذف نتیجهٔ اشتباهی / پاک کردن دادههای نمونه |
| `GET`/`POST` | `/api/leaderboard/close` | پیشنمایش / اعلام برنده و ارسال تلگرام |
| `GET` | `/api/leaderboard/cron` | اجرای خودکار ماهانه |

```bash
# ثبت یک شکست توسط ایجنت خارجی
curl -X POST https://YOUR-DOMAIN.vercel.app/api/leaderboard/events \
  -H "Content-Type: application/json" \
  -H "x-agent-key: ag_live_crypto_arya_9821" \
  -d '{"agentId":1,"outcome":"failure","projectTitle":"سیگنال آربیتراژ رد شد","durationMinutes":35,"note":"اسپرد کمتر از حد آستانه"}'
```

**استقرار روی دیتابیس موجود:** فایل `supabase/leaderboard_migration.sql` (یا کل `supabase/schema.sql`
که idempotent است) را یکبار در SQL Editor سوپابیس Run کنید تا دو جدول
`agentos.agent_score_events` و `agentos.agent_monthly_awards` به همراه Grantهای رول `agentos`
ساخته شوند. در اولین بارگذاری، دادههای نمونهٔ دو دوره و پیکربندی پیشفرض بهصورت خودکار
(idempotent) seed میشوند و از تب لیگ با دکمهٔ «🧹 حذف دادههای نمونه» قابل پاک کردناند.

## 🪙 میز کار اختصاصی ایجنت تریدر «آریا - A1» (`/agents/crypto-arya`)

با کلیک روی پروفایل کارمند رمزارز (یا لینک «🖥 میز کار آریا» در هدر/ناوگان) وارد
داشبورد اختصاصی او میشوید: تابلو وضعیت زنده 🟢 رصد / ⚔️ معامله / 💤 استراحت،
سرمایهٔ تخصیصیافته از کیف پول واحد، کارت معاملات فعال با **Unrealized PnL** و دکمهٔ
«🚨 خروج اضطراری»، کارنامه (Win Rate، سود خالص، میانگین سود هر معامله، رتبهٔ لیگ)،
دفترچه خاطرات تحلیل (Brain Dump) و تنظیمات اختصاصی (فعال/غیرفعال، سقف سرمایه،
حداکثر اهرم، R/R، آستانهٔ اطمینان، بستن خودکار). صفحه هر ۱۵ ثانیه زنده میشود.

### منابع دادهٔ واقعی (بدون کلید)

| منبع | اندپوینت | خروجی |
| --- | --- | --- |
| Binance Spot | `/api/v3/klines?interval=4h` | RSI(14)، MACD(12/26/9)، MA20/MA50، ATR، حمایت/مقاومت |
| Binance Spot | `/api/v3/ticker/price` | قیمت لحظهای و Mark-to-Market |
| Binance Spot | `/api/v3/depth` | عدم تعادل عمق دفتر سفارشات |
| Binance Spot | `/api/v3/aggTrades` | جریان سفارشات >۱۰۰هزار تتر (**پروکسی نهنگ صرافی**) |
| alternative.me | `/fng/` | شاخص ترس و طمع |
| CryptoPanic | اختیاری `CRYPTOPANIC_API_KEY` | احساسات اخبار |

اندیکاتورها بهصورت خالص TypeScript در `src/lib/indicators.ts` پیادهمسازی شدهاند
(بدون وابستگی بومی TA-Lib). TradingView API رسمی رایگان ندارد؛ همان کندلهای صرافی
مبنای محاسبهاند. اگر محیط (سندباکس/تحریم IP) به صرافی دسترسی نداشته باشد،
`source=fallback` با برچسب صریح «آفلاین/نمونه» برمیگردد — **هرگز دادهٔ ساختگی
بهعنوان زنده نشان داده نمیشود**. دادهٔ درونزنجیرهای واقعی (Whale Alert/Glassnode)
نیازمند کلید API است و تا آن زمان پروکسی دفتر سفارشات با همین نام نمایش مییابد.

### موتور ریسک و الگوی پیشنهاد معامله

- اهرم پویا بر اساس فاصلهٔ حد ضرر (≤۱٪→5x، ≤۲٪→3x، بیشتر→2x)، محدود به
  `trader_max_leverage` و سقف ریسک ریالی `trader_max_risk_usdt` (پیشفرض ۵۰ USDT).
- حداقل **R/R = ۱ به ۲**؛ SL/TP از حمایت/مقاومت واقعی استخراج میشوند. اگر برقرار
  نشود ایجنت پیشنهاد نمیدهد.
- دروازههای ضدهیجان: ترس/طمع خارج از ۱۵–۸۰، نوسان >۴٪، RSI اشباع، اخبار منفی،
  اطمینان <۶۵٪ یا پوزیشن باز ⇒ **صرفنظر + ثبت دلیل در دفترچه** (مثل: «ساعت ۱۲:۳۰
  بهدلیل نوسان شدید اخبار از ورود صرفنظر کردم»).
- کارت دقیق ارسالی به تلگرام: جفتارز، LONG/SHORT، نقطهٔ ورود، تخمین سود و زمان،
  اهرم، Stop-Loss، Take-Profit، R/R، دلیل تحلیل و دکمههای شیشهای
  `trade_approve:<id>` / `trade_reject:<id>`.

### چرخهٔ اجرا و بستن خودکار

```
اسکن → دروازههای ریسک → پیشنهاد (pending) → ✅ HITL (تلگرام/میز کار)
     → باز شدن پوزیشن → Mark-to-Market → 🎯 TP / 🛑 SL / ⏰ 24h / 🚨 اضطراری
     → گزارش نهایی تلگرام + ثبت نتیجه در لیگ کارمندان + دفترچه خاطرات
```

`GET/POST /api/trader/tick` و Cron روزانهٔ `GET /api/company/tick` پوزیشنها را
بروز و خودکار میبندند؛ همچنین **هر بار باز کردن میز کار** `syncPositions()` اجرا
میشود تا بستن خودکار وابسته به Cron نباشد. Cron ماهانهٔ لیگ هم سر جای خود باقی است.

### اندپوینتهای A1

| متد | مسیر | کاربرد |
| --- | --- | --- |
| `GET` | `/api/trader/desk` | همهٔ دادههای میز کار + sync پوزیشنها |
| `POST` | `/api/trader/scan` | اسکن بازار، ساخت پیشنهاد، ارسال تلگرام |
| `GET`/`POST` | `/api/trader/signals` | تاریخچه / تأیید و رد انسانی |
| `GET`/`POST` | `/api/trader/positions` | پوزیشنها / خروج اضطراری |
| `GET`/`PUT` | `/api/trader/settings` | تنظیمات اختصاصی ایجنت |
| `GET`/`POST` | `/api/trader/tick` | Mark-to-Market + بستن خودکار + اسکن |
| `GET`/`POST` | `/api/company/tick` | تپش روزانهٔ کل شرکت |

### ⚠️ صداقت اجرا (مهم)

دادهٔ بازار، اندیکاتورها، کارت HITL و PnL قیمتی **واقعی**اند، ولی حالت پیشفرض
`trader_mode=paper` است: سفارشی به صرافی فرستاده نمیشود و سودی به کیف پول واحد
واریز نمیشود. اجرای زنده فقط با هر سه شرط زیر فعال است:

1. `EXCHANGE_API_KEY` + `EXCHANGE_API_SECRET` در متغیرهای محیطی،
2. `trader_mode=live` (در UI در صورت نبودن کلیدها غیرفعال است)،
3. تأیید انسانی تکبهتک پیشنهادها.

در حالت live، `src/lib/exchange.ts` سفارشات MARKET را با امضای HMAC-SHA256 روی
Binance USD-M Futures میفرستد و فقط سود محققشدهٔ زنده به `transactions` و
`agents.earned_usdt` اضافه میشود. معاملات اهرمدار میتوانند کل سرمایه را از بین
ببرند؛ کلیدها هرگز در DB/پاسخ API ذخیره نمیشوند.

**استقرار دیتابیس موجود:** `supabase/trader_migration.sql` (یا کل
`supabase/schema.sql` که idempotent است) را یکبار در SQL Editor اجرا کنید تا
`trade_signals`، `trade_positions`، `agent_journal` و `market_snapshots` ساخته
شوند. دادهٔ نمونهٔ اولیه (کارنامه، خاطرات و یک پیشنهاد منتظر تأیید) بهصورت خودکار
و idempotent seed میشود.

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
