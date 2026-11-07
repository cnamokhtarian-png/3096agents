import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { toolRuns, agentLogs } from "@/db/schema";
import { ensureSeed } from "@/lib/seed";
import { getAiConfig, geminiGenerate, aiErrorFa } from "@/lib/gemini";

async function mymemoryFallback(input: string): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    const url =
      "https://api.mymemory.translated.net/get?q=" +
      encodeURIComponent(input.slice(0, 450)) +
      "&langpair=fa|en";
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    clearTimeout(t);
    if (!res.ok) return null;
    const d = await res.json();
    return d?.responseData?.translatedText || null;
  } catch {
    return null;
  }
}

function promptFor(tool: string, input: string): string {
  if (tool.includes("مترجم") || tool.includes("ترجمه")) {
    return (
      "You are a professional Persian-to-English translator for blockchain/Web3 texts. " +
      "Translate precisely and naturally. Keep DeFi/crypto terms in English. " +
      "Return ONLY the translation, no explanations.\n\nPersian text:\n" + input
    );
  }
  if (tool.includes("PPT") || tool.includes("ارائه") || tool.includes("pitch")) {
    return (
      "تو یک مشاور جذب سرمایه Web3 هستی. برای موضوع زیر یک ساختار ارائه ۱۰ اسلایدی " +
      "به فارسی بنویس: هر اسلاید یک تیتر + ۳ نکته کلیدی + پیشنهاد نمودار. " +
      "کاربردی و مختصر.\n\nموضوع:\n" + input
    );
  }
  if (tool.includes("فروش") || tool.includes("پاسخ") || tool.includes("مذاکره")) {
    return (
      "تو فروشنده حرفه‌ای خدمات فریلنسری هستی. برای پیام مشتری زیر یک پاسخ فارسی " +
      "صمیمی و کوتاه بنویس که اعتماد بسازد، یک سؤال هوشمند بپرسد و به سمت " +
      "پیش‌فاکتور USDT هدایت کند. فقط متن پاسخ را بده.\n\nپیام مشتری:\n" + input
    );
  }
  if (tool.includes("Next")) {
    return (
      "تو معمار ارشد Next.js هستی. برای پروژه زیر یک پلن اجرایی فارسی بنویس: " +
      "ساختار پوشه‌ها، کامپوننت‌های اصلی، APIهای لازم و ترتیب ساخت. مختصر و عملی.\n\nپروژه:\n" + input
    );
  }
  return (
    "به فارسی، دقیق و کاربردی جواب بده:\n\n" + input
  );
}

function titleFor(tool: string): string {
  if (tool.includes("مترجم") || tool.includes("ترجمه")) return "ترجمه تخصصی FA→EN";
  if (tool.includes("PPT") || tool.includes("ارائه") || tool.includes("pitch")) return "ساختار ارائه سرمایه‌گذاری";
  if (tool.includes("فروش") || tool.includes("پاسخ") || tool.includes("مذاکره")) return "پیش‌نویس پاسخ فروش";
  if (tool.includes("Next")) return "پلن اجرایی Next.js";
  return "پاسخ AI";
}

export async function POST(req: NextRequest) {
  await ensureSeed();
  const { tool, input } = await req.json();
  const toolName = String(tool || "");
  const text = String(input || "");
  let output = "";
  let status = "done";
  let model = "";

  if (!text.trim()) {
    output = "ورودی خالی است.";
    status = "error";
  } else {
    const cfg = await getAiConfig();
    if (!cfg.apiKey) {
      output =
        `برای اجرای واقعی «${toolName}» ابتدا کلید AI لازم است.\n` +
        `از داشبورد ← «⚙️ اتصال‌ها» کلید را وارد کنید، بعد دوباره تلاش کنید.`;
      status = "needs_key";
    } else {
      try {
        const r = await geminiGenerate(promptFor(toolName, text));
        model = r.model;
        output = `✅ ${titleFor(toolName)} (مدل: ${model})\n\n${r.text}`;
      } catch (e: any) {
        const code = e?.message || "UNKNOWN";
        if (toolName.includes("مترجم") || toolName.includes("ترجمه")) {
          const fb = await mymemoryFallback(text);
          if (fb) {
            output = `✅ ترجمه واقعی FA→EN (سرویس پشتیبان)\nورودی: «${text}»\nخروجی: «${fb}»`;
          } else {
            output = aiErrorFa(code);
            status = "error";
          }
        } else {
          output = aiErrorFa(code);
          status = "error";
        }
      }
    }
  }

  const rows: any = await db
    .insert(toolRuns)
    .values({ tool: toolName, input: text.slice(0, 500), output, status })
    .returning();
  await db.insert(agentLogs).values({
    agent: toolName,
    action: "اجرای ابزار AI",
    status: status === "done" ? "success" : status,
    detail: (model ? `مدل ${model} • ` : "") + text.slice(0, 100),
    durationMs: 0,
  });
  return NextResponse.json(rows[0]);
}
