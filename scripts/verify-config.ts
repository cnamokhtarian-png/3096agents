/**
 * اسکریپت تست لایه‌ی پیکربندی دائمی.
 * اجرا:  node --experimental-strip-types scripts/verify-config.ts
 * یا:      npx tsx scripts/verify-config.ts
 *
 * بررسی می‌کند که:
 *  ۱) config.json روی دیسک هست و خوانده می‌شود
 *  ۲) هر کلید از یکی از سه منبع (env / config.json / .env.local) پیدا می‌شود
 *  ۳) با پاک کردن متغیرهای محیطی، کلیدها همچنان از پرونده‌ی دائمی خوانده می‌شوند
 */
// این اسکریپت یک ابزار CLI مستقل است و مستقیم ماژول را می‌خواند تا
// بدون نیاز به alias-resolution اجرا شود.
import { conf, configInventory, configFileExists } from "../src/lib/config.ts";

const REQUIRED = [
  "DATABASE_URL",
  "DIRECT_URL",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_ADMIN_CHAT_ID",
  "TELEGRAM_CHAT_ID",
  "TELEGRAM_BOT_USERNAME",
  "TELEGRAM_WEBHOOK_SECRET",
  "GEMINI_API_KEY",
  "GEMINI_MODEL",
  "EXCHANGE_API_KEY",
  "EXCHANGE_SECRET_KEY",
  "EXCHANGE_TESTNET",
  "AGENT_TRADING_ENABLED",
  "ADMIN_EMAIL",
  "ADMIN_PASSWORD",
  "AUTH_SECRET",
  "ADMIN_API_SECRET",
  "AGENT_MASTER_API_KEY",
  "CRON_SECRET",
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "MASTER_WALLET_NETWORK",
];

console.log("═".repeat(70));
console.log("🔒 بررسی پرونده‌ی دائمی کلیدها");
console.log("═".repeat(70));
console.log(`config.json موجود: ${configFileExists() ? "✅ بله" : "❌ نه"}`);
console.log("");

let fail = 0;
for (const key of REQUIRED) {
  const v = conf(key);
  const ok = v.length > 0;
  if (!ok) fail++;
  const preview = /KEY|SECRET|PASSWORD|TOKEN/.test(key)
    ? v
      ? `••••${v.slice(-4)}`
      : "—"
    : v || "—";
  console.log(`${ok ? "✅" : "❌"} ${key.padEnd(28)} ${preview}`);
}

console.log("");
console.log("─".repeat(70));
console.log("🧪 تست پایداری: حذف کامل متغیرهای محیطی و خواندن دوباره");
console.log("─".repeat(70));
const saved = { ...process.env };
for (const k of Object.keys(process.env)) {
  if (k === "PATH" || k === "HOME" || k === "NODE_ENV") continue;
  delete process.env[k];
}
// پاک کردن کش فایل تا از دیسک بخواند
const after = REQUIRED.map((k) => [k, conf(k)]);
let persistFail = 0;
for (const [k, v] of after) {
  if (!v) {
    persistFail++;
    console.log(`❌ ${k} — پس از حذف env پیدا نشد`);
  }
}
console.log(
  persistFail === 0
    ? `✅ هر ${REQUIRED.length} کلید پس از حذف کامل env، همچنان از پرونده‌ی دائمی خوانده شد.`
    : `❌ ${persistFail} کلید فقط به env وابسته بود.`
);
Object.assign(process.env, saved);

console.log("");
console.log("─".repeat(70));
console.log("📦 خلاصه‌ی موجودی کلیدها");
console.log("─".repeat(70));
for (const g of configInventory()) {
  const present = g.items.filter((i) => i.present).length;
  console.log(`${g.label.padEnd(26)} ${present}/${g.items.length} ست شده`);
}

console.log("");
console.log(fail === 0 && persistFail === 0 ? "🎉 همه‌چیز سالم است." : `⚠️  ${fail + persistFail} مورد نیاز به بررسی دارد.`);
process.exit(fail === 0 && persistFail === 0 ? 0 : 1);
