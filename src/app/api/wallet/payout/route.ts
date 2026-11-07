import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { transactions, tasks, agentLogs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureSeed, getMasterWallet, requireAdmin } from "@/lib/seed";

async function availableBalance(): Promise<number> {
  const tx = await db.select().from(transactions);
  const income = tx
    .filter(
      (x: any) =>
        x.kind === "income" &&
        (x.status === "confirmed" || x.status === "completed") &&
        Number(x.amountUsdt) > 0
    )
    .reduce((s: number, x: any) => s + Number(x.amountUsdt || 0), 0);
  const locked = tx
    .filter(
      (x: any) =>
        x.kind === "payout" &&
        ["pending", "approved", "completed"].includes(x.status) &&
        Number(x.amountUsdt) > 0
    )
    .reduce((s: number, x: any) => s + Number(x.amountUsdt || 0), 0);
  return Math.max(0, income - locked);
}

async function notifyAdmin(text: string, taskId?: number) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const adminChat = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!token || !adminChat) return { sent: false };
  try {
    const body: any = { chat_id: adminChat, text, parse_mode: "HTML" };
    if (taskId) {
      body.reply_markup = {
        inline_keyboard: [
          [
            { text: "✅ تأیید برداشت", callback_data: `approve:${taskId}` },
            { text: "❌ رد", callback_data: `reject:${taskId}` },
          ],
        ],
      };
    }
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { sent: res.ok };
  } catch {
    return { sent: false };
  }
}

// درخواست برداشت جدید → تسک تأیید + پیام تلگرام با دکمه
export async function POST(req: NextRequest) {
  await ensureSeed();
  const admin = requireAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "نیاز به ورود مدیر" }, { status: 401 });
  }
  const b = await req.json().catch(() => ({}));
  const amount = Number(b.amountUsdt);
  if (!(amount > 0)) {
    return NextResponse.json({ error: "مبلغ برداشت باید بزرگ‌تر از صفر باشد" }, { status: 400 });
  }
  const wallet = await getMasterWallet();
  if (!wallet.address) {
    return NextResponse.json(
      { error: "ابتدا آدرس برداشت (متامسک) را ثبت کنید.", need: "payout_address" },
      { status: 400 }
    );
  }
  const avail = await availableBalance();
  if (amount > avail) {
    return NextResponse.json(
      { error: `موجودی قابل برداشت فقط ${avail} USDT است.` },
      { status: 400 }
    );
  }

  const [payout] = await db
    .insert(transactions)
    .values({
      title: `برداشت به متامسک${b.note ? " — " + String(b.note).slice(0, 80) : ""}`,
      projectTitle: "",
      agentName: admin.name || "مدیر",
      destinationWallet: wallet.address,
      amountUsdt: amount,
      network: wallet.network.replace("USDT-", ""),
      txHash: "",
      kind: "payout",
      status: "pending",
    })
    .returning();

  const [task] = await db
    .insert(tasks)
    .values({
      title: `برداشت ${amount} USDT به متامسک`,
      agent: "سیستم برداشت",
      actionType: "payout",
      description: `درخواست برداشت ${amount} USDT به آدرس ${wallet.address} (${wallet.network})`,
      projectTitle: "",
      status: "pending",
      risk: amount > 500 ? "high" : "medium",
      payload: `payout_tx:${payout.id}`,
    })
    .returning();

  const tg = await notifyAdmin(
    `💸 <b>درخواست برداشت جدید</b>\n• مبلغ: ${amount} USDT\n• مقصد: <code>${wallet.address}</code>\n• شبکه: ${wallet.network}\n\nبا دکمه زیر تأیید یا رد کنید:`,
    task.id
  );

  await db.insert(agentLogs).values({
    agent: "سیستم برداشت",
    action: `درخواست برداشت ${amount} USDT`,
    status: "success",
    detail: `تسک تأیید #${task.id} ساخته شد • اعلان تلگرام: ${tg.sent ? "ارسال شد" : "ارسال نشد"}`,
    durationMs: 0,
  });

  return NextResponse.json({ ok: true, payout, task, telegramSent: tg.sent });
}

// ثبت هش تراکنش بعد از انتقال واقعی → تکمیل برداشت
export async function PUT(req: NextRequest) {
  await ensureSeed();
  if (!requireAdmin(req)) {
    return NextResponse.json({ error: "نیاز به ورود مدیر" }, { status: 401 });
  }
  const b = await req.json().catch(() => ({}));
  const id = Number(b.id);
  const txHash = String(b.txHash || "").trim();
  if (!id || txHash.length < 16) {
    return NextResponse.json(
      { error: "شناسه برداشت و هش معتبر تراکنش لازم است." },
      { status: 400 }
    );
  }
  const rows: any = await db
    .select()
    .from(transactions)
    .where(eq(transactions.id, id));
  const row = rows[0];
  if (!row || row.kind !== "payout") {
    return NextResponse.json({ error: "برداشت پیدا نشد" }, { status: 404 });
  }
  if (row.status !== "approved") {
    return NextResponse.json(
      { error: "فقط برداشت تأییدشده را می‌توان با هش، تکمیل کرد." },
      { status: 400 }
    );
  }
  const [updated] = await db
    .update(transactions)
    .set({ txHash, status: "completed" })
    .where(eq(transactions.id, id))
    .returning();
  await db.insert(agentLogs).values({
    agent: "سیستم برداشت",
    action: `تکمیل برداشت #${id}`,
    status: "success",
    detail: `هش ثبت شد: ${txHash.slice(0, 20)}...`,
    durationMs: 0,
  });
  return NextResponse.json({ ok: true, payout: updated });
}
