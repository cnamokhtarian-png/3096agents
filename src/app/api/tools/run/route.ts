import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { toolRuns, agentLogs, settings } from "@/db/schema";
import { ensureSeed } from "@/lib/seed";

async function realTranslate(input: string): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const url =
      "https://api.mymemory.translated.net/get?q=" +
      encodeURIComponent(input.slice(0, 450)) +
      "&langpair=fa|en";
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    clearTimeout(t);
    if (!res.ok) throw new Error("translate api " + res.status);
    const d = await res.json();
    const out = d?.responseData?.translatedText;
    if (!out) throw new Error("empty translation");
    return out;
  } finally {
    clearTimeout(t);
  }
}

export async function POST(req: NextRequest) {
  await ensureSeed();
  const { tool, input } = await req.json();
  const toolName = String(tool || "");
  const text = String(input || "");
  let output = "";
  let status = "done";

  if (toolName.includes("مترجم") || toolName.includes("ترجمه")) {
    if (!text.trim()) {
      output = "متنی برای ترجمه وارد نشده است.";
      status = "error";
    } else {
      try {
        const tr = await realTranslate(text);
        output = `✅ ترجمه واقعی FA→EN\nورودی: «${text}»\nخروجی: «${tr}»`;
      } catch {
        output =
          "سرویس ترجمه موقتاً در دسترس نیست. کمی بعد دوباره تلاش کنید.";
        status = "error";
      }
    }
  } else {
    // بدون کلید AI نمی‌شود فایل واقعی تولید کرد — صادقانه می‌گوییم چه لازم است.
    const rows = await db.select().from(settings);
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    if (map.ai_api_key) {
      output =
        `ابزار «${toolName}» کلید AI دارد ولی موتور تولید آن در قدم بعدی ساخته می‌شود. ` +
        `فعلاً از بخش «اتصال‌ها» وضعیت را دنبال کنید.`;
      status = "queued";
    } else {
      output =
        `برای اجرای واقعی «${toolName}» ابتدا کلید AI لازم است.\n` +
        `از داشبورد → بخش «⚙️ اتصال‌ها» کلید OpenAI یا Gemini را وارد کنید، بعد دوباره تلاش کنید.`;
      status = "needs_key";
    }
  }

  const rows: any = await db
    .insert(toolRuns)
    .values({ tool: toolName, input: text, output, status })
    .returning();
  await db.insert(agentLogs).values({
    agent: toolName,
    action: "اجرای ابزار",
    status: status === "done" ? "success" : status,
    detail: text.slice(0, 120),
    durationMs: 0,
  });
  return NextResponse.json(rows[0]);
}
