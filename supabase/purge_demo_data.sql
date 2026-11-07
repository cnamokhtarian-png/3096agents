-- =========================================================================
-- پاک‌سازی داده‌های نمایشی نصب‌های قبلی (Mock / Random)
-- =========================================================================
-- نسخه‌ی قبلی این پروژه در اولین اجرا داده‌های ساختگی (پروژه‌ها، پیام‌ها،
-- تراکنش‌های با هش کوتاه و درآمدهای ثابت) می‌ساخت. این فایل آن‌ها را حذف
-- می‌کند و درآمد هر کارمند را از روی تراکنش‌های واقعیِ باقی‌مانده بازمحاسبه
-- می‌کند. ساختار جدول‌ها و کارمندان و تنظیمات دست‌نخورده می‌مانند.
--
-- اجرا: یک‌بار در SQL Editor سوپابیس. قبل از اجرا از دیتابیس بکاپ بگیرید.
-- =========================================================================

BEGIN;

-- ۱) تراکنش‌های ساختگی: هش کوتاه یا دارای «...» (هش واقعی ۶۴ کاراکتر هگز است)
DELETE FROM agentos.transactions
 WHERE kind = 'income'
   AND (
     tx_hash = ''
     OR tx_hash LIKE '%...%'
     OR tx_hash !~ '^[0-9a-fA-F]{16,}$'
   );

-- ۲) سفارش‌ها/لاگ‌های نمایشی
DELETE FROM agentos.tool_runs
 WHERE output ILIKE '%اسکلت Next.js ساخته شد%'
    OR output ILIKE '%ارائه PPTX آماده شد%';

DELETE FROM agentos.agent_logs
 WHERE detail LIKE '%...%'
    OR action IN ('اسکن آربیتراژ و واریز به کیف پول واحد', 'دریافت پیام جدید');

DELETE FROM agentos.agent_activity_logs
 WHERE reward_usdt = 0
   AND tx_hash = ''
   AND source IN ('system', 'panel')
   AND action ILIKE '%واریز%';

-- ۳) پیام‌ها/تسک‌های نمونه‌ی قدیمی (اگر می‌خواهید نگه دارید این دو خط را حذف کنید)
DELETE FROM agentos.messages WHERE chat_id IN ('1001', '1002', '1003', '1004') AND source = 'telegram';
DELETE FROM agentos.tasks
 WHERE project_title LIKE '%لندینگ پیج Next.js برای صرافی%'
    OR project_title LIKE '%ترجمه وایت‌پیپر%';

DELETE FROM agentos.projects
 WHERE title IN (
   'لندینگ پیج Next.js برای صرافی رمزارز',
   'ارائه PPTX سرمایه‌گذاری Web3',
   'ترجمه وایت‌پیپر FA→EN',
   'ربات تلگرام فروش اشتراک USDT',
   'ایجنت AI پشتیبانی فروشگاه',
   'داشبورد آنالیتیکس NFT'
 );

-- ۴) بازمحاسبه درآمد و شمارنده هر کارمند فقط از تراکنش‌های تأییدشده‌ی واقعی
UPDATE agentos.agents a
   SET earned_usdt = COALESCE((
         SELECT SUM(t.amount_usdt)
           FROM agentos.transactions t
          WHERE t.agent_name = a.name
            AND t.kind = 'income'
            AND t.status = 'confirmed'
       ), 0),
       tasks_completed = COALESCE((
         SELECT COUNT(*)
           FROM agentos.transactions t
          WHERE t.agent_name = a.name
            AND t.kind = 'income'
            AND t.status = 'confirmed'
       ), 0);

-- ۵) اگر می‌خواهید کل شمارنده‌ها صفر شوند (شروع کاملاً تازه):
-- UPDATE agentos.agents SET earned_usdt = 0, tasks_completed = 0, success_count = 0, error_count = 0;

COMMIT;

-- بررسی نتیجه:
-- SELECT name, earned_usdt, tasks_completed, success_count, error_count FROM agentos.agents ORDER BY id;
-- SELECT COUNT(*) AS confirmed_income_rows FROM agentos.transactions WHERE status = 'confirmed' AND kind = 'income';
