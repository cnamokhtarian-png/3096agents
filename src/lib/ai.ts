import { db } from "@/db";
import { settings } from "@/db/schema";
import { conf } from "@/lib/config";
import { ENV } from "@/lib/env";

const FALLBACK_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.5-flash",
  "gemini-2.5-flash",
  "gemini-2.0-flash-lite",
  "gemini-1.5-flash",
] as const;

const RETIRED_MODELS = new Set([
  "gemini-2.0-flash",
  "gemini-1.5-pro-001",
]);

async function resolveAiCredentials(): Promise<{
  apiKey: string;
  models: string[];
}> {
  let dbKey = "";
  let dbModel = "";
  try {
    const rows = await db.select().from(settings);
    const map = new Map(rows.map((r) => [r.key, r.value]));
    dbKey = (map.get("ai_api_key") || "").trim();
    dbModel = (map.get("ai_model") || "").trim();
  } catch {
    // در صورت عدم دسترسی موقت دیتابیس، فقط از conf خوانده می‌شود
  }

  const apiKey = ENV.geminiKey() || dbKey;
  const envModel = conf("GEMINI_MODEL").trim();

  const ordered: string[] = [];
  for (const candidate of [envModel, dbModel, ...FALLBACK_MODELS]) {
    const clean = candidate.replace(/^models\//, "").trim();
    if (!clean || RETIRED_MODELS.has(clean)) continue;
    if (!ordered.includes(clean)) ordered.push(clean);
  }
  if (ordered.length === 0) {
    ordered.push(...FALLBACK_MODELS);
  }

  return { apiKey, models: ordered };
}

export type AiGenerateResult =
  | { ok: true; text: string; model: string }
  | { ok: false; error: string; triedModels: string[] };

export async function generateGeminiText(
  prompt: string,
  opts: { temperature?: number; maxOutputTokens?: number; timeoutMs?: number } = {},
): Promise<AiGenerateResult> {
  const { apiKey, models } = await resolveAiCredentials();
  if (!apiKey) {
    return {
      ok: false,
      error: "کلید GEMINI_API_KEY پیکربندی نشده است",
      triedModels: [],
    };
  }

  const baseUrl = (
    conf("GEMINI_BASE_URL") || "https://generativelanguage.googleapis.com"
  )
    .replace(/\/v1beta\/?$/i, "")
    .replace(/\/$/, "");

  const queue = [...models];
  const tried: string[] = [];
  let lastError = "خطای نامشخص Gemini";

  while (queue.length > 0) {
    const model = queue.shift()!;
    if (tried.includes(model)) continue;
    tried.push(model);
    try {
      const res = await fetch(
        `${baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt.slice(0, 12000) }] }],
            generationConfig: {
              temperature: opts.temperature ?? 0.2,
              maxOutputTokens: opts.maxOutputTokens ?? 1100,
            },
          }),
          cache: "no-store",
          signal: AbortSignal.timeout(opts.timeoutMs ?? 18000),
        },
      );

      if (!res.ok) {
        const errBody = (await res.text().catch(() => "")).slice(0, 360);
        lastError = `Gemini (${model}) HTTP ${res.status}: ${errBody}`;
        // اگر گوگل در متن خطای 404 مدل جایگزین پیشنهاد داد، بلافاصله در ابتدای صف قرار بده
        const suggested = errBody.match(/models\/([a-zA-Z0-9._-]+)/)?.[1];
        if (suggested && suggested !== model && !tried.includes(suggested)) {
          queue.unshift(suggested);
        }
        if (res.status === 404 || res.status === 429 || res.status === 503) {
          continue;
        }
        return { ok: false, error: lastError, triedModels: tried };
      }

      const json: any = await res.json().catch(() => ({}));
      const text = json?.candidates?.[0]?.content?.parts
        ?.map((p: any) => (typeof p?.text === "string" ? p.text : ""))
        .filter(Boolean)
        .join("\n")
        ?.trim();

      if (!text) {
        lastError = `پاسخ مدل ${model} خالی بود`;
        continue;
      }

      return { ok: true, text, model };
    } catch (e: any) {
      lastError = `Gemini (${model}) unreachable: ${e?.message || e}`;
    }
  }

  return { ok: false, error: lastError, triedModels: tried };
}

export function geminiConfigured(): boolean {
  return Boolean(ENV.geminiKey());
}

export function activeGeminiModel(): string {
  const raw = conf("GEMINI_MODEL").replace(/^models\//, "").trim();
  if (!raw || RETIRED_MODELS.has(raw)) return FALLBACK_MODELS[0];
  return raw;
}

