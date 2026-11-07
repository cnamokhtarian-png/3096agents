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
};

const DEFAULT_SOURCES = [
  "https://airdrops.io/feed/",
  "https://decrypt.co/feed",
  "https://cointelegraph.com/rss",
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

/** حقیقت‌سنجی قطعی ضداسکم (Deterministic Security Gate) */
function evaluateItemDeterministically(item: RawFeedItem): VerifiedBounty {
  const hay = `${item.title} ${item.description}`.toLowerCase();

  if (
    !/^https:\/\//i.test(item.link) ||
    /seed phrase|private key|recovery phrase|send .* eth to receive|send .* usdt to unlock|double your crypto/i.test(
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
    };
  }

  if (/guaranteed 100x|instant free money|no task百万/i.test(hay)) {
    return {
      title: item.title,
      link: item.link,
      verdict: "suspicious",
      trustScore: 35,
      rewardLabel: "مشکوک — نیازمند بررسی دستی",
      estimatedProfitUsdt: 0,
      estimatedDuration: "—",
      analysisReason: "وعده بازده غیرواقعی؛ امتیاز اعتماد زیر حد نصاب ایمنی شرکت.",
    };
  }

  const isGuideOrListicle =
    /explained|biggest airdrops ever|what is a crypto airdrop/i.test(item.title);
  if (isGuideOrListicle) {
    return {
      title: item.title,
      link: item.link,
      verdict: "suspicious",
      trustScore: 55,
      rewardLabel: "مقاله آموزشی (کمپین مستقیم نیست)",
      estimatedProfitUsdt: 0,
      estimatedDuration: "۱۵ دقیقه مطالعه",
      analysisReason: "محتوای آموزشی عمومی است و کمپین پاداش مستقیم قابل مطالبه ندارد.",
    };
  }

  let score = 74;
  const signals: string[] = ["دامنه معتبر HTTPS بدون درخواست کلید خصوصی یا واریز اجباری"];

  if (/testnet|node|points|quest|mainnet|season|incentivized|galxe|zealy|layer/i.test(hay)) {
    score += 10;
    signals.push("کمپین امتیازدهی/تست‌نت رسمی پروتکل");
  }
  if (/airdrops\.io/i.test(item.link)) {
    score += 4;
    signals.push("فهرست‌شده در مرجع پایش ایردراپ (airdrops.io)");
  }

  // استخراج مبلغ دلاری در صورت ذکر صریح در متن؛ در غیر این صورت تخمین محافظه‌کارانه پاداش تسک
  const usdMatch = hay.match(/\$\s*(\d{2,4})\b/);
  const estUsdt = usdMatch
    ? Math.min(250, Math.max(15, Number(usdMatch[1])))
    : /node|farm|perp|dex/i.test(hay)
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
      ? `پاداش تخمینی ~${estUsdt} USDT (بر اساس کمپین اعلامی)`
      : `امتیاز ایردراپ / پاداش تخمینی ~${estUsdt} USDT`,
    estimatedProfitUsdt: estUsdt,
    estimatedDuration: estDuration,
    analysisReason: signals.join(" + "),
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
        "تو تحلیلگر ضداسکم کمپین‌های Web3 هستی. برای هر مورد زیر یک شیء JSON در آرایه خروجی بده (فقط JSON خالص):",
        ...nonScam.map((v, idx) => `${idx + 1}. ${v.title} (${v.link})`),
        'فرمت: [{"score": عدد ۰ تا ۱۰۰, "verdict": "ok"|"suspicious"|"scam", "reason": "دلیل حقیقت‌سنجی فارسی حداکثر ۲۰ کلمه"}]',
      ].join("\n"),
      { temperature: 0.1, maxOutputTokens: 600, timeoutMs: 12000 },
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
        });
      } catch {
        // در صورت JSON غیراستاندارد، همان ارزیابی قطعی حفظ می‌شود
      }
    }
  }

  // اطمینان از هم‌ترازی نمره و حکم
  void eq;
  const qualified = verified.filter(
    (v) => v.verdict === "ok" && v.trustScore >= minScore,
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
