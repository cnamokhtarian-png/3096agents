import { db } from "@/db";
import { settings } from "@/db/schema";

export const DEFAULT_AI_MODEL = "gemini-3.5-flash";

export async function getAiConfig() {
  const rows = await db.select().from(settings);
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    provider: map.ai_provider || "gemini",
    apiKey: map.ai_api_key || "",
    model: map.ai_model || DEFAULT_AI_MODEL,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function geminiGenerate(
  prompt: string,
  opts?: { maxTokens?: number; temperature?: number }
): Promise<{ text: string; model: string }> {
  const cfg = await getAiConfig();
  if (!cfg.apiKey) throw new Error("NO_KEY");
  let lastCode = "UNKNOWN";
  // دو تلاش: اگر گوگل شلوغ بود (503/429) یک بار دیگر صبر و تلاش
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 25000);
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${cfg.model}:generateContent?key=${cfg.apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: ctrl.signal,
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt.slice(0, 8000) }] }],
            generationConfig: {
              temperature: opts?.temperature ?? 0.7,
              maxOutputTokens: opts?.maxTokens ?? 1500,
            },
          }),
        }
      );
      clearTimeout(t);
      if (res.status === 503 || res.status === 429) {
        lastCode = res.status === 429 ? "QUOTA" : "BUSY";
        await sleep(2500);
        continue;
      }
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        if (res.status === 400 && /api key/i.test(txt)) throw new Error("BAD_KEY");
        if (res.status === 404) throw new Error("BAD_MODEL");
        throw new Error("GEMINI_" + res.status);
      }
      const d = await res.json();
      const text =
        d?.candidates?.[0]?.content?.parts
          ?.map((p: any) => p.text || "")
          .join("") || "";
      if (!text.trim()) throw new Error("EMPTY");
      return { text: text.trim(), model: cfg.model };
    } catch (e: any) {
      clearTimeout(t);
      if (e?.message && !["QUOTA", "BUSY"].includes(lastCode) && e.message !== "UNKNOWN") {
        throw e;
      }
      lastCode = e?.message || lastCode;
      if (attempt === 0 && (lastCode === "QUOTA" || lastCode === "BUSY")) {
        await sleep(2500);
        continue;
      }
      throw e;
    }
  }
  throw new Error(lastCode);
}

export function aiErrorFa(code: string): string {
  switch (code) {
    case "NO_KEY":
      return "کلید AI ثبت نشده — از داشبورد ← «اتصال‌ها» وارد کنید.";
    case "BAD_KEY":
      return "کلید AI معتبر نیست. از AI Studio کلید تازه بسازید و جایگزین کنید.";
    case "QUOTA":
      return "سهمیه AI تمام شد. کمی بعد تلاش کنید یا پلن را ارتقا دهید.";
    case "BUSY":
      return "سرور AI گوگل موقتاً شلوغ است. یک دقیقه بعد دوباره تلاش کنید.";
    case "BAD_MODEL":
      return "مدل AI نامعتبر است. از بخش «اتصال‌ها» نام مدل را اصلاح کنید.";
    default:
      return `سرویس AI موقتاً در دسترس نیست (${code}). کمی بعد تلاش کنید.`;
  }
}
