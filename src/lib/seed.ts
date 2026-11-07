import { db } from "@/db";
import { users, agents, settings } from "@/db/schema";
import { createHash, createHmac, randomBytes } from "crypto";
import { eq } from "drizzle-orm";
import { conf } from "@/lib/config";

/**
 * راه‌اندازی اولیه — بدون هیچ داده‌ی ساختگی.
 *
 * فقط سه چیز ساخته می‌شود:
 *   ۱. کاربر مدیرعامل (از ADMIN_EMAIL / ADMIN_PASSWORD)
 *   ۲. تنظیمات کیف پول واحد
 *   ۳. «چارت سازمانی» کارمندان با هدف و اتاق اختصاصی و درآمد صفر
 *
 * درآمد، تراکنش، تسک و لاگ فقط با رویداد واقعی (وبهوک تأییدشده، سفارش
 * صرافی یا تأیید مدیرعامل) ساخته می‌شوند.
 */

export const hashPw = (p: string) => createHash("sha256").update(p).digest("hex");

const AUTH_SECRET = () => conf("AUTH_SECRET") || "freelance-agent-os-default-secret-key";

export function signSession(payload: { id: number; email: string; name: string }) {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", AUTH_SECRET()).update(data).digest("base64url");
  return `${data}.${sig}`;
}

export function verifySession(token: string) {
  try {
    const [data, sig] = token.split(".");
    if (!data || !sig) return null;
    const expected = createHmac("sha256", AUTH_SECRET()).update(data).digest("base64url");
    if (sig !== expected) return null;
    return JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export async function getMasterWallet(): Promise<{
  address: string;
  network: string;
  autoSweep: boolean;
}> {
  const fallback = {
    address: conf("MASTER_WALLET_ADDRESS"),
    network: conf("MASTER_WALLET_NETWORK") || "USDT-TRC20",
    autoSweep: true,
  };
  try {
    const rows = await db.select().from(settings);
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return {
      address: map.master_wallet_address ?? fallback.address,
      network: map.master_wallet_network ?? fallback.network,
      autoSweep: map.auto_sweep_enabled !== "false",
    };
  } catch {
    return fallback;
  }
}

function agentKey(slug: string) {
  const envKey = process.env[`AGENT_KEY_${slug.toUpperCase().replace(/-/g, "_")}`];
  return envKey?.trim() || `ag_live_${randomBytes(12).toString("hex")}`;
}

const ROSTER = [
  {
    name: "آریا کریپتو (کارمند تخصصی رمزارز)",
    slug: "crypto-employee",
    role: "کارمند رمزارز، تحلیل آن‌چین و آربیتراژ DEX/CEX",
    specialty: "crypto",
    avatar: "🪙",
    department: "دپارتمان بازار سرمایه",
    officeRoom: "۱۰۱",
    officeFloor: "۱",
    goalTitle: "رساندن سود محقق‌شده ماهانه به ۵٬۰۰۰ USDT از طریق آربیتراژ و کپی‌ترید",
    goalTargetUsdt: 5000,
    currentFocus: "آماده دریافت مجوز معامله واقعی (کلید صرافی)",
    strategy:
      "رصد اختلاف قیمت صرافی‌ها، تحلیل جریان نهنگ‌ها و ارسال سفارش واقعی فقط پس از تأیید مدیرعامل",
  },
  {
    name: "ایجنت شکار و ساخت Next.js",
    slug: "nextjs-builder",
    role: "توسعه‌دهنده فول‌استک پروژه‌های وب و کریپتو",
    specialty: "freelance",
    avatar: "⚛️",
    department: "دپارتمان مهندسی",
    officeRoom: "۱۰۲",
    officeFloor: "۱",
    goalTitle: "تحویل ۴ پروژه Next.js در ماه با تسویه کامل USDT",
    goalTargetUsdt: 4000,
    currentFocus: "منتظر پروژه تأییدشده",
    strategy: "اجرای پروژه‌های Next.js از طریق ورکر واقعی و تسویه USDT پس از تحویل",
  },
  {
    name: "ایجنت فروش و مذاکره تلگرام",
    slug: "telegram-closer",
    role: "مسئول فروش ۲۴/۷ و صدور پیش‌فاکتور",
    specialty: "bot",
    avatar: "🤖",
    department: "دپارتمان فروش",
    officeRoom: "۱۰۳",
    officeFloor: "۱",
    goalTitle: "بستن ۱۰ قرارداد در ماه از کانال تلگرام",
    goalTargetUsdt: 3000,
    currentFocus: "گوش به زنگ وبهوک تلگرام",
    strategy: "پاسخ فوری به مشتریان، ساخت پیش‌فاکتور و ارسال آن برای تأیید مدیرعامل",
  },
  {
    name: "ایجنت ساخت ارائه Pitch Deck",
    slug: "pptx-designer",
    role: "طراح اسلاید سرمایه‌گذاری و توکنومیکس",
    specialty: "content",
    avatar: "📊",
    department: "دپارتمان محتوا",
    officeRoom: "۲۰۱",
    officeFloor: "۲",
    goalTitle: "تولید ۸ ارائه حرفه‌ای در ماه",
    goalTargetUsdt: 1500,
    currentFocus: "اگر ورکر ابزار ست شده باشد، اجرای واقعی انجام می‌شود",
    strategy: "ساخت PPTX از طریق ورکر بیرونی (n8n) و ثبت خروجی واقعی",
  },
  {
    name: "ایجنت مترجم تخصصی وایت‌پیپر",
    slug: "web3-translator",
    role: "مترجم متون بلاک‌چین و قراردادهای هوشمند",
    specialty: "content",
    avatar: "🌐",
    department: "دپارتمان محتوا",
    officeRoom: "۲۰۲",
    officeFloor: "۲",
    goalTitle: "ترجمه ۲۰٬۰۰۰ کلمه تخصصی در ماه",
    goalTargetUsdt: 1200,
    currentFocus: "آماده واکشی سفارش",
    strategy: "ترجمه FA↔EN با حفظ اصطلاحات DeFi و ثبت خروجی واقعی ورکر",
  },
  {
    name: "ایجنت وب‌هوک خارجی (Custom API)",
    slug: "custom-webhook-worker",
    role: "دریافت درآمد از ربات ترید / n8n / TradingView",
    specialty: "custom_api",
    avatar: "🔌",
    department: "دپارتمان یکپارچه‌سازی",
    officeRoom: "۲۰۳",
    officeFloor: "۲",
    goalTitle: "اتصال ۵ منبع درآمد بیرونی با شاهد تراکنش",
    goalTargetUsdt: 2500,
    currentFocus: "منتظر آموزش وبهوک توسط مدیرعامل",
    strategy: "دریافت سیگنال سود از سرویس بیرونی و ثبت پس از تأیید زنجیره‌ای",
  },
];

let seeded = false;

export async function ensureSeed() {
  if (seeded) return;
  try {
    const adminEmail = (conf("ADMIN_EMAIL") || "admin@freelance.ir").toLowerCase();
    const adminPassword = conf("ADMIN_PASSWORD");
    const existingUsers = await db.select().from(users).limit(1);
    if (existingUsers.length === 0) {
      await db
        .insert(users)
        .values({
          email: adminEmail,
          passwordHash: hashPw(adminPassword || "admin123"),
          name: "مدیرعامل",
          role: "admin",
        })
        .onConflictDoNothing();
    } else if (adminPassword) {
      // ⭐ همگام‌سازی رمز مدیر با ADMIN_PASSWORD.
      // بدون این، اگر رمز در Vercel عوض شود ولی کاربر از قبل در دیتابیس
      // باشد، ورود همیشه با رمز قدیمی رد می‌شود و کاربر فکر می‌کند
      // پرونده‌ی کلیدها مشکل دارد.
      //
      // اگر ADMIN_EMAIL تغییر کند ولی کاربر قدیمی با نقش admin باقی مانده
      // باشد، هر دو همگام می‌شوند تا ورود با ایمیل جدید هم ممکن باشد.
      const desiredHash = hashPw(adminPassword);
      const adminRows = existingUsers.filter(
        (u) =>
          u.email.toLowerCase() === adminEmail ||
          (u.role === "admin" && u.email.toLowerCase() !== adminEmail)
      );
      for (const row of adminRows) {
        if (row.passwordHash !== desiredHash) {
          await db
            .update(users)
            .set({ passwordHash: desiredHash })
            .where(eq(users.id, row.id));
          console.log(
            `seed: رمز کاربر مدیر (${row.email}) با ADMIN_PASSWORD همگام شد`
          );
        }
      }
    }

    const defaults: Array<{ key: string; value: string }> = [
      { key: "master_wallet_address", value: conf("MASTER_WALLET_ADDRESS") },
      { key: "master_wallet_network", value: conf("MASTER_WALLET_NETWORK") || "USDT-TRC20" },
      { key: "auto_sweep_enabled", value: "true" },
      { key: "webhook", value: "/api/telegram/webhook" },
    ];
    for (const d of defaults) {
      const exists = await db.select().from(settings).where(eq(settings.key, d.key));
      if (exists.length === 0) await db.insert(settings).values(d).onConflictDoNothing();
    }

    const existingAgents = await db.select().from(agents).limit(1);
    if (existingAgents.length === 0) {
      for (const r of ROSTER) {
        await db
          .insert(agents)
          .values({
            name: r.name,
            slug: r.slug,
            role: r.role,
            specialty: r.specialty,
            avatar: r.avatar,
            status: "active",
            apiEndpoint: "/api/agents/ingest",
            apiKey: agentKey(r.slug),
            earnedUsdt: 0,
            tasksCompleted: 0,
            successCount: 0,
            errorCount: 0,
            payoutMode: "auto_unified",
            strategy: r.strategy,
            department: r.department,
            goalTitle: r.goalTitle,
            goalTargetUsdt: r.goalTargetUsdt,
            officeFloor: r.officeFloor,
            officeRoom: r.officeRoom,
            currentFocus: r.currentFocus,
          })
          .onConflictDoNothing();
      }
    }
    seeded = true;
  } catch (e) {
    console.error("seed error:", e);
  }
}
