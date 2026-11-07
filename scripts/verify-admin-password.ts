/**
 * بررسی هم‌راستایی رمز مدیر بین منبع پایدار و پایگاه داده.
 *
 * ⚠️ این ابزار هیچ secret واقعی را چاپ نمی‌کند — فقط هش SHA-256 را
 * نشان می‌دهد تا بتوان آن را با DB مقایسه کرد.
 *
 * اجرا:  node --experimental-strip-types scripts/verify-admin-password.ts
 * (این اسکریپت فقط در محیطی کار می‌کند که به دیتابیس دسترسی دارد.)
 */
import { createHash } from "node:crypto";
import { conf } from "../src/lib/config.ts";

const email = (conf("ADMIN_EMAIL") || "admin@freelance.ir").toLowerCase();
const password = conf("ADMIN_PASSWORD") || "";

if (!password) {
  console.error("❌ ADMIN_PASSWORD در هیچ‌کدام از منابع پایدار پیدا نشد.");
  process.exit(1);
}

const hash = createHash("sha256").update(password).digest("hex");

console.log("🔐 بررسی هم‌راستایی رمز مدیر");
console.log("─".repeat(56));
console.log("ایمیل مدیر      :", email);
console.log("طول رمز         :", password.length);
console.log("SHA-256 رمز     :", hash);
console.log("SHA-256 (۱۲ رقم) :", hash.slice(0, 12));
console.log("─".repeat(56));
console.log("✅ این هش باید با مقدار agentos.users.password_hash در");
console.log("   دیتابیس برای همین ایمیل یکسان باشد.");
console.log("   (ensureSeed در هر اجرا رمز را با ADMIN_PASSWORD همگام می‌کند،");
console.log("    پس کافی است یک‌بار وارد صفحه‌ی ورود شوید تا همگامی انجام شود.)");
