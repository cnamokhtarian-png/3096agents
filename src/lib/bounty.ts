import { db } from "@/db";
import { settings } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { generateGeminiText } from "@/lib/ai";

export type RawFeedItem = {
  title: string;
  link: string;
  description: string;
  pubDate: string;
};

export type VerifiedBounty = {
  title: string;
  link: string;
  verdict: "ok" | "suspicious" | "scam";
  trustScore: number;
  rewardLabel: string;
  estimatedProfitUsdt: number;
  estimatedDuration: string;
  analysisReason: string;
  /** دارایی پاداش: BTC / USDT / ETH / … (خالی = نامشخص) */
  cryptoAsset?: string;
  /** آیا بدون سرمایه اولیه قابل انجام است؟ */
  freeToClaim?: boolean;
  /** مسیر دریافت و برداشت جایزه (شفافیت شرط برداشت) */
  claimPath?: string;
  /** دلیل رد شدن (برای شفافیت در لاگ و پنل) */
  rejection?: string;
};

/**
 * 🔎 منابع پیش‌فرض B7 — فقط منابع تخصصی ایردراپ/پاداش رمزارزی.
 * خبرهای عمومی رمزارز (decrypt/cointelegraph) عمداً حذف شدند چون هدف B7
 * «شکار جایزه رایگان» است، نه خواندن اخبار.
 * این فهرست فقط زمانی استفاده می‌شود که تنظیم `bounty_sources` در دیتابیس خالی باشد.
 */
const DEFAULT_SOURCES = [
  "https://airdrops.io/feed/",
  "https://airdropalert.com/feed/",
];

function stripTags(html: string): string {
  return html
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/&#038;|&amp;/g, "&")
    .replace(/&#8217;|&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export function parseRssFeed(xml: string): RawFeedItem[] {
  const out: RawFeedItem[] = [];
  const blocks = xml.split(/<(?:item|entry)[\s>]/i).slice(1, 14);
  for (const b of blocks) {
    const pick = (tag: string) => {
      const m = b.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
      return m ? stripTags(m[1]) : "";
    };
    let link = pick("link");
    if (!link) {
      const href = b.match(/<link[^>]+href=["']([^"']+)["']/i);
      if (href) link = href[1].trim();
    }
    const title = pick("title").slice(0, 200);
    const description = (pick("description") || pick("summary") || pick("content:encoded")).slice(0, 900);
    const pubDate = pick("pubDate") || pick("updated") || "";
    if (title && link && /^https?:\/\//i.test(link)) {
      out.push({ title, link: link.slice(0, 350), description, pubDate });
    }
  }
  return out;
}

/**
 * 🛡️ حقیقت‌سنجی قطعی ضداسکم + فیلتر «پاداش رایگان رمزارزی» (Deterministic Gate)
 *
 * پروتکل جدید B7 (دستور مدیرعامل، ۱۴۰۵/۰۸/۱۶):
 *  فاز ۱ — دروازه امنیتی: فیشینگ/کلید خصوصی/واریز اجباری → رد قطعی
 *  فاز ۲ — ربط رمزارزی: باید دارایی پاداش رمزارزی معتبر باشد
 *  فاز ۳ — رایگان‌بودن: نباید سرمایه‌گذاری اولیه لازم باشد
 *  فاز ۴ — شفافیت برداشت: مسیر دریافت/برداشت باید قابل توضیح باشد
 */

/** دارایی‌های مجاز: بیت‌کوین، تتر و رمزارزهای معتبر دیگر. */
const QUALIFIED_ASSETS: Array<{ re: RegExp; label: string }> = [
  { re: /bitcoin|\bbtc\b|satoshi|\bsats\b/i, label: "BTC" },
  { re: /tether|\busdt\b|\busdc\b/i, label: "USDT/USDC" },
  { re: /ethereum|\beth\b|\bwei\b/i, label: "ETH" },
  { re: /solana|\bsol\b/i, label: "SOL" },
  { re: /\bbnb\b|binance coin/i, label: "BNB" },
  { re: /\bton\b|toncoin|the open network/i, label: "TON" },
  { re: /\bxrp\b|ripple/i, label: "XRP" },
];

/** کلیدواژه‌های «پاداش رایگان» (بدون سرمایه اولیه). */
const FREE_REWARD_SIGNALS =
  /free (crypto|bitcoin|btc|airdrop|reward|tokens?|usdt)|no (deposit|investment|purchase) (required|needed)|0\$|zero cost|without (any )?(deposit|investment)|claim free|free to (join|participate|claim)|faucet|faucets|free spins?|learn.{0,20}earn|watch.{0,15}earn|sign[- ]?up (bonus|reward|airdrop)|signup bonus|referral (bonus|reward)|points program|campaign points|reward program|testnet reward|quest(s)? (reward|points)|daily (check[- ]?in|streak)|free airdrop/i;

/** نشانه‌های سرمایه‌گذاری اولیه / پرداخت برای دریافت جایزه. */
const PAID_SIGNALS =
  /(deposit|invest|buy|purchase|pay)\s+(at least|minimum|min\.?)\s*\$?\d|minimum (deposit|investment|purchase)|requires? (a )?(deposit|payment|purchase|investment)|paid (entry|tier)|pre-?sale|presale|ico\b|ido\b|token sale|staking (to )?(earn|receive)|locked liquidity|buy .{0,12}to (participate|claim|receive)|subscription (fee|required)/i;

/** نشانه‌های محتوای آموزشی/خبری که کمپین مستقیم نیست. */
const GUIDE_SIGNALS =
  /explained|what is |how to |guide|tutorial|review|top \d+|best \d+|biggest|list of|opinion|analysis|price prediction|week in review/i;

/** مسیر دریافت جایزه بر اساس نوع کمپین (برای شفافیت شرط برداشت). */
function detectClaimPath(hay: string, link: string): string {
  if (/node|validator|miner/i.test(hay))
    return "نصب نود/کلاینت رسمی → اتصال کیف پول شخصی → شرط تسک‌های داشبورد → برداشت توکن در TGE (فقط کارمزد شبکه)";
  if (/quest|galxe|zealy|layer3|task/i.test(hay))
    return "اتصال کیف پول شخصی در داشبورد کمپین → انجام تسک‌ها → اسنپ‌شات امتیاز → کلایم رسمی در سایت پروژه";
  if (/faucet/i.test(hay))
    return "ثبت‌نام یا ورود با کیف پول → درخواست دوره‌ای از فاست → برداشت مستقیم به کیف پول شخصی";
  if (/sign[- ]?up|signup|register/i.test(hay))
    return "ثبت‌نام رایگان → انجام شرط (ورود روزانه/تسک) → کلایم در حساب کاربری → برداشت به کیف پول شخصی";
  if (/airdrop|points/i.test(hay))
    return "ثبت‌نام رایگان در کمپین → شرکت در تسک‌ها → کلایم در اسنپ‌شات اعلامی پروژه → برداشت به کیف پول شخصی";
  return `شرایط برداشت باید روی صفحه رسمی کمپین بررسی شود — ${link}`;
}

function detectAsset(hay: string): string | null {
  for (const a of QUALIFIED_ASSETS) if (a.re.test(hay)) return a.label;
  // کمپین‌های ایردراپ توکنی که دارایی نهایی آن اعلام نشده، «رمزارز» هستند ولی نامشخص
  if (/airdrop|token|crypto|web3|blockchain|defi/i.test(hay)) return "رمزارز (نامشخص)";
  return null;
}

function evaluateItemDeterministically(item: RawFeedItem): VerifiedBounty {
  const hay = `${item.title} ${item.description}`;
  const claimPath = detectClaimPath(hay, item.link);

  // ── فاز ۱: دروازه امنیتی ────────────────────────────────────────────────
  if (
    !/^https:\/\//i.test(item.link) ||
    /seed phrase|private key|recovery phrase|send .* eth to receive|send .* usdt to unlock|double your crypto|connect wallet and sign|airdrop checker|claim now before it'?s (too )?late|urgent: ?verify/i.test(
      hay,
    )
  ) {
    return {
      title: item.title,
      link: item.link,
      verdict: "scam",
      trustScore: 5,
      rewardLabel: "رد شده (ریسک فیشینگ/اسکم)",
      estimatedProfitUsdt: 0,
      estimatedDuration: "—",
      analysisReason:
        "رد خودکار توسط موتور ضداسکم: وجود کلیدواژه خطرناک یا لینک غیرامن.",
      rejection: "security_gate",
    };
  }

  if (/guaranteed 100x|instant free money|no task|risk[- ]?free profit|send funds/i.test(hay)) {
    return {
      title: item.title,
      link: item.link,
      verdict: "suspicious",
      trustScore: 35,
      rewardLabel: "مشکوک — نیازمند بررسی دستی",
      estimatedProfitUsdt: 0,
      estimatedDuration: "—",
      analysisReason: "وعده بازده غیرواقعی؛ امتیاز اعتماد زیر حد نصاب ایمنی شرکت.",
      rejection: "unrealistic_promise",
    };
  }

  // ── فاز ۲: رایگان بودن (بدون سرمایه اولیه) ───────────────────────────────
  const isFree = FREE_REWARD_SIGNALS.test(hay);
  const isPaid = PAID_SIGNALS.test(hay);
  if (isPaid && !isFree) {
    return {
      title: item.title,
      link: item.link,
      verdict: "suspicious",
      trustScore: 30,
      rewardLabel: "رد شده — نیازمند سرمایه‌گذاری اولیه",
      estimatedProfitUsdt: 0,
      estimatedDuration: "—",
      analysisReason:
        "طبق پروتکل B7 فقط کمپین‌های رایگان (بدون واریز/خرید) پذیرفته می‌شوند؛ این مورد پرداخت اولیه می‌خواهد.",
      rejection: "requires_investment",
    };
  }

  // ── فاز ۳: ربط رمزارزی ────────────────────────────────────────────────
  const asset = detectAsset(hay);
  if (!asset) {
    return {
      title: item.title,
      link: item.link,
      verdict: "suspicious",
      trustScore: 30,
      rewardLabel: "رد شده — پاداش رمزارزی نیست",
      estimatedProfitUsdt: 0,
      estimatedDuration: "—",
      analysisReason:
        "پاداش این مورد رمزارزی (BTC/USDT یا رمزارز معتبر) نیست؛ طبق دستور مدیرعامل کنار گذاشته شد.",
      rejection: "not_crypto_reward",
    };
  }

  // ── فاز ۴: محتوای آموزشی/خبری (کمپین مستقیم نیست) ─────────────────────
  if (GUIDE_SIGNALS.test(item.title) && !isFree) {
    return {
      title: item.title,
      link: item.link,
      verdict: "suspicious",
      trustScore: 55,
      rewardLabel: "مقاله آموزشی (کمپین مستقیم نیست)",
      estimatedProfitUsdt: 0,
      estimatedDuration: "۱۵ دقیقه مطالعه",
      analysisReason:
        "محتوای آموزشی/خبری است و کمپین پاداش مستقیم قابل مطالبه ندارد.",
      rejection: "editorial_content",
      cryptoAsset: asset,
    };
  }

  // ── قبول: کمپین رایگان رمزارزی ─────────────────────────────────────────
  let score = isFree ? 78 : 68;
  const signals: string[] = [`پاداش رمزارزی: ${asset}`];
  if (isFree) signals.push("بدون سرمایه‌گذاری اولیه (رایگان)");
  if (/testnet|node|points|quest|mainnet|season|incentivized|galxe|zealy|layer/i.test(hay)) {
    score += 8;
    signals.push("کمپین امتیازدهی/تست‌نت رسمی پروتکل");
  }
  if (/airdrops\.io|airdropalert/i.test(item.link)) {
    score += 4;
    signals.push("فهرست‌شده در مرجع پایش ایردراپ");
  }

  const usdMatch = hay.match(/\$\s*(\d{2,4})\b/);
  const estUsdt = usdMatch
    ? Math.min(250, Math.max(15, Number(usdMatch[1])))
    : /node|farm|perp|dex|airdrop/i.test(hay)
    ? 45
    : 25;

  const estDuration = /node|farming|strategy/i.test(hay)
    ? "۴۵ الی ۹۰ دقیقه راه‌اندازی اولیه"
    : "۲۰ الی ۳۵ دقیقه انجام تسک‌ها";

  return {
    title: item.title,
    link: item.link,
    verdict: "ok",
    trustScore: Math.min(95, score),
    rewardLabel: usdMatch
      ? `پاداش رایگان تخمینی ~${estUsdt} USDT (${asset})`
      : `پاداش رایگان ایردراپ (${asset}) — تخمین ~${estUsdt} USDT`,
    estimatedProfitUsdt: estUsdt,
    estimatedDuration: estDuration,
    analysisReason: signals.join(" + "),
    cryptoAsset: asset,
    freeToClaim: true,
    claimPath,
  };
}

async function getSettingMap(): Promise<Map<string, string>> {
  const rows = await db.select().from(settings);
  return new Map(rows.map((r) => [r.key, r.value]));
}

async function saveSetting(key: string, value: string) {
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value: sql`excluded.value` } });
}

export async function scanBountyFeeds(opts: {
  includeRecentIfAllSeen?: boolean;
  existingLinks?: Set<string>;
} = {}): Promise<{
  ok: boolean;
  sourcesChecked: string[];
  fetchedCount: number;
  verified: VerifiedBounty[];
  qualified: VerifiedBounty[];
  minScore: number;
  error?: string;
}> {
  const map = await getSettingMap();
  const minScore = Number(map.get("bounty_min_score") || 70);
  const rawSources = (map.get("bounty_sources") || "").trim();
  const sources = (rawSources ? rawSources.split(/[\n,]+/) : DEFAULT_SOURCES)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 4);

  let seen: string[] = [];
  try {
    seen = JSON.parse(map.get("bounty_seen") || "[]");
    if (!Array.isArray(seen)) seen = [];
  } catch {
    seen = [];
  }

  const allFetched: RawFeedItem[] = [];
  const fetchErrors: string[] = [];

  for (const src of sources) {
    try {
      const res = await fetch(src, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; AgentCompanyOS-B7/1.0)" },
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        fetchErrors.push(`${src}: HTTP ${res.status}`);
        continue;
      }
      const xml = (await res.text()).slice(0, 260_000);
      for (const item of parseRssFeed(xml)) {
        if (!allFetched.some((x) => x.link === item.link)) {
          allFetched.push(item);
        }
      }
    } catch (e: any) {
      fetchErrors.push(`${src}: ${e?.message || "network_error"}`);
    }
  }

  if (allFetched.length === 0) {
    return {
      ok: fetchErrors.length === 0,
      sourcesChecked: sources,
      fetchedCount: 0,
      verified: [],
      qualified: [],
      minScore,
      error: fetchErrors.join(" | ") || undefined,
    };
  }

  const existingLinks = opts.existingLinks ?? new Set<string>();
  let candidates = allFetched.filter(
    (it) => !seen.includes(it.link) && !existingLinks.has(it.link),
  );

  // اگر همه قبلاً دیده شده‌اند ولی در چرخه شروع رسمی هنوز پیشنهاد فعالی ثبت نشده، ۳ مورد آخر بررسی می‌شوند
  if (candidates.length === 0 && opts.includeRecentIfAllSeen) {
    candidates = allFetched
      .filter((it) => !existingLinks.has(it.link))
      .slice(0, 4);
  } else {
    candidates = candidates.slice(0, 5);
  }

  for (const c of candidates) {
    if (!seen.includes(c.link)) seen.push(c.link);
  }
  await saveSetting("bounty_seen", JSON.stringify(seen.slice(-250))).catch(() => {});

  // ۱) ارزیابی امنیتی قطعی
  const verified = candidates.map(evaluateItemDeterministically);

  // ۲) غنی‌سازی اختیاری دلیل حقیقت‌سنجی با Gemini (فقط روی موارد غیراسکم)
  const nonScam = verified.filter((v) => v.verdict !== "scam");
  if (nonScam.length > 0) {
    const ai = await generateGeminiText(
      [
        "تو تحلیلگر ضداسکم کمپین‌های پاداش رایگان رمزارزی (ایردراپ/بانتی/BTC و USDT) هستی.",
        "قانون شرکت: فقط پاداش رایگان رمزارزی معتبر قبول است؛ پاداش غیررمزارزی، فیشینگ، یا هر چیزی که واریز/خرید اولیه بخواهد باید رد شود.",
        "برای هر مورد زیر یک شیء JSON در آرایه خروجی بده (فقط JSON خالص):",
        ...nonScam.map(
          (v, idx) => `${idx + 1}. ${v.title} (${v.link}) — دارایی: ${v.cryptoAsset || "نامشخص"}`,
        ),
        'فرمت: [{"score": 0-100, "verdict": "ok"|"suspicious"|"scam", "asset": "BTC|USDT|ETH|…", "free": true|false, "withdrawal": "شرط برداشت در حداکثر ۱۵ کلمه", "reason": "دلیل حقیقت‌سنجی فارسی حداکثر ۲۰ کلمه"}]',
      ].join("\n"),
      { temperature: 0.1, maxOutputTokens: 700, timeoutMs: 12000 },
    );
    if (ai.ok) {
      try {
        const m = ai.text.match(/\[[\s\S]*\]/);
        const arr: any[] = m ? JSON.parse(m[0]) : [];
        nonScam.forEach((v, idx) => {
          const item = arr[idx];
          if (!item || typeof item !== "object") return;
          if (item.verdict === "scam") {
            v.verdict = "scam";
            v.trustScore = Math.min(v.trustScore, 20);
          } else if (item.verdict === "suspicious") {
            v.verdict = "suspicious";
            v.trustScore = Math.min(v.trustScore, 58);
          } else if (Number.isFinite(Number(item.score))) {
            v.trustScore = Math.round((v.trustScore + Number(item.score)) / 2);
          }
          if (typeof item.reason === "string" && item.reason.trim()) {
            v.analysisReason = item.reason.trim().slice(0, 220);
          }
          // پاداش غیررمزارزی یا پرداختی → کنار گذاشته می‌شود (پروتکل B7)
          if (item.free === false) {
            v.verdict = "suspicious";
            v.trustScore = Math.min(v.trustScore, 40);
            v.freeToClaim = false;
            v.rejection = "requires_investment";
          }
          if (typeof item.asset === "string" && item.asset.trim()) {
            v.cryptoAsset = item.asset.trim().slice(0, 24).toUpperCase();
          }
          if (typeof item.withdrawal === "string" && item.withdrawal.trim()) {
            v.claimPath = item.withdrawal.trim().slice(0, 240);
          }
        });
      } catch {
        // در صورت JSON غیراستاندارد، همان ارزیابی قطعی حفظ می‌شود
      }
    }
  }

  // اطمینان از هم‌ترازی نمره و حکم
  void eq;
  // فقط پاداش رایگان رمزارزی با حکم ok و امتیاز کافی عبور می‌کند
  const qualified = verified.filter(
    (v) =>
      v.verdict === "ok" &&
      v.trustScore >= minScore &&
      Boolean(v.cryptoAsset) &&
      v.freeToClaim !== false,
  );

  return {
    ok: true,
    sourcesChecked: sources,
    fetchedCount: allFetched.length,
    verified,
    qualified,
    minScore,
    error: fetchErrors.length ? fetchErrors.join(" | ") : undefined,
  };
}
