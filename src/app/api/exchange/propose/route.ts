import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { tasks, agentLogs } from "@/db/schema";
import { ensureSeed, requireAdmin } from "@/lib/seed";
import {
  getExchangeConfig,
  getAccount,
  getDepth,
  parseBalances,
  parseDepth,
  splitSymbol,
  exErrorFa,
} from "@/lib/exchange";

async function notifyAdmin(text: string, taskId: number) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const adminChat = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!token || !adminChat) return { sent: false };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: adminChat,
        text,
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "✅ تأیید و اجرا", callback_data: `approve:${taskId}` },
              { text: "❌ رد", callback_data: `reject:${taskId}` },
            ],
          ],
        },
      }),
    });
    return { sent: res.ok };
  } catch {
    return { sent: false };
  }
}

// پیشنهاد سفارش → فقط تسک تأیید می‌سازد؛ اجرا فقط بعد از تأیید تلگرام/پنل
export async function POST(req: NextRequest) {
  await ensureSeed();
  if (!requireAdmin(req)) {
    return NextResponse.json({ error: "نیاز به ورود مدیر" }, { status: 401 });
  }
  const b = await req.json().catch(() => ({}));
  const cfg = await getExchangeConfig();
  if (!cfg.apiKey || !cfg.apiSecret) {
    return NextResponse.json({ error: exErrorFa("NO_EXCHANGE_KEYS") }, { status: 400 });
  }
  const symbol = String(b.symbol || "BTC_IRT").toUpperCase();
  const side = String(b.side || "").toUpperCase();
  const type = String(b.type || "").toUpperCase();
  const quantity = Number(b.quantity);
  const price = b.price !== undefined && b.price !== "" ? Number(b.price) : undefined;
  if (!["BUY", "SELL"].includes(side)) {
    return NextResponse.json({ error: "جهت سفارش باید BUY یا SELL باشد." }, { status: 400 });
  }
  if (!["MARKET", "LIMIT"].includes(type)) {
    return NextResponse.json({ error: "فعلاً فقط سفارش MARKET و LIMIT پشتیبانی می‌شود." }, { status: 400 });
  }
  if (!(quantity > 0)) {
    return NextResponse.json({ error: "مقدار باید بزرگ‌تر از صفر باشد." }, { status: 400 });
  }
  if (type === "LIMIT" && !(price && price > 0)) {
    return NextResponse.json({ error: "برای LIMIT قیمت لازم است." }, { status: 400 });
  }
  if (cfg.requireSL && type === "MARKET") {
    return NextResponse.json(
      { error: "چون «حد ضرر اجباری» روشن است، سفارش MARKET مجاز نیست — از LIMIT با قیمت مشخص استفاده کنید." },
      { status: 400 }
    );
  }

  // قیمت واقعی بازار + موجودی واقعی
  let mid = 0;
  try {
    const p = parseDepth(await getDepth(symbol, 5));
    if (!p) throw new Error("no-price");
    mid = p.mid;
  } catch {
    return NextResponse.json({ error: `قیمت زنده ${symbol} از صرافی خوانده نشد.` }, { status: 502 });
  }
  const execPrice = type === "LIMIT" ? (price as number) : mid;
  const notional = quantity * execPrice;
  const { base, quote } = splitSymbol(symbol);

  let bals: { asset: string; free: number }[] = [];
  try {
    bals = parseBalances(await getAccount());
  } catch (e: any) {
    return NextResponse.json(
      { error: "موجودی صرافی خوانده نشد (کلید باید دسترسی خواندن داشته باشد): " + exErrorFa(e?.message || "") },
      { status: 502 }
    );
  }
  const freeOf = (a: string) => bals.find((x) => x.asset.toUpperCase() === a.toUpperCase())?.free || 0;
  if (side === "BUY") {
    const qFree = freeOf(quote);
    if (notional > qFree) {
      return NextResponse.json(
        { error: `موجودی ${quote} کافی نیست (لازم: ${notional.toLocaleString("fa-IR")}، موجود: ${qFree.toLocaleString("fa-IR")}).` },
        { status: 400 }
      );
    }
    const maxAllowed = (qFree * cfg.riskPct) / 100;
    if (notional > maxAllowed) {
      return NextResponse.json(
        { error: `سقف ریسک رد کرد: حداکثر ${cfg.riskPct}٪ موجودی (${maxAllowed.toLocaleString("fa-IR")} ${quote}) در هر معامله مجاز است.` },
        { status: 400 }
      );
    }
  } else {
    const bFree = freeOf(base);
    if (quantity > bFree) {
      return NextResponse.json(
        { error: `موجودی ${base} کافی نیست (لازم: ${quantity}، موجود: ${bFree}).` },
        { status: 400 }
      );
    }
    const maxQty = ((bFree * execPrice * cfg.riskPct) / 100 / execPrice);
    if (quantity > maxQty) {
      return NextResponse.json(
        { error: `سقف ریسک رد کرد: حداکثر ${maxQty} ${base} در هر معامله مجاز است (${cfg.riskPct}٪).` },
        { status: 400 }
      );
    }
  }

  const [task] = await db
    .insert(tasks)
    .values({
      title: `سفارش ${side} ${quantity} ${base} (${symbol})`,
      agent: "A1 · آریا — کارمند رمزارز",
      actionType: "order",
      description:
        `پیشنهاد ${side === "BUY" ? "خرید" : "فروش"} ${quantity} ${base} در بازار ${symbol} به قیمت ${type === "LIMIT" ? execPrice.toLocaleString("fa-IR") : "بازار (تخمینی " + Math.round(mid).toLocaleString("fa-IR") + ")"} — ارزش حدودی ${Math.round(notional).toLocaleString("fa-IR")} ${quote}. اجرا فقط با تأیید شما.`,
      projectTitle: "صرافی تبدیل (اسپات)",
      status: "pending",
      risk: "high",
      payload: JSON.stringify({ symbol, side, type, quantity: String(quantity), price: price ? String(price) : undefined }),
    })
    .returning();

  const tg = await notifyAdmin(
    `📈 <b>پیشنهاد سفارش صرافی</b>\n• ${side} ${quantity} ${base} (${symbol})\n• نوع: ${type}${type === "LIMIT" ? ` @ ${execPrice.toLocaleString("fa-IR")}` : " (بازار)"}\n• ارزش حدودی: ${Math.round(notional).toLocaleString("fa-IR")} ${quote}\n\nبا دکمه زیر تأیید (اجرا) یا رد کنید:`,
    task.id
  );

  await db.insert(agentLogs).values({
    agent: "A1 · آریا — کارمند رمزارز",
    action: `پیشنهاد سفارش ${side} ${symbol}`,
    status: "success",
    detail: `تسک #${task.id} • اعلان تلگرام: ${tg.sent ? "ارسال شد" : "ارسال نشد"}`,
    durationMs: 0,
  });

  return NextResponse.json({ ok: true, task, telegramSent: tg.sent, estimate: { price: execPrice, notional } });
}
