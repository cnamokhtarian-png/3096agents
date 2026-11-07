import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { settings, agents, transactions, agentLogs } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { ensureSeed, getMasterWallet } from "@/lib/seed";

export async function GET() {
  await ensureSeed();
  const [masterWallet, agentList, txList] = await Promise.all([
    getMasterWallet(),
    db.select().from(agents).orderBy(desc(agents.earnedUsdt)),
    db.select().from(transactions).orderBy(desc(transactions.id)),
  ]);

  const incomes = txList.filter(
    (t: any) =>
      t.kind === "income" &&
      (t.status === "confirmed" || t.status === "completed") &&
      Number(t.amountUsdt) > 0
  );
  const payouts = txList.filter(
    (t: any) =>
      t.kind === "payout" &&
      ["approved", "completed"].includes(t.status) &&
      Number(t.amountUsdt) > 0
  );
  const totalIncome = incomes.reduce(
    (s: number, t: any) => s + Number(t.amountUsdt || 0),
    0
  );
  const totalPaidOut = payouts.reduce(
    (s: number, t: any) => s + Number(t.amountUsdt || 0),
    0
  );
  const available = Math.max(0, totalIncome - totalPaidOut);

  const fleetTotal = agentList.reduce(
    (s, a) => s + Number(a.earnedUsdt || 0),
    0
  );

  return NextResponse.json({
    masterWallet,
    fleetTotal,
    totalIncome,
    totalPaidOut,
    available,
    pendingPayouts: txList.filter(
      (t: any) => t.kind === "payout" && t.status === "pending"
    ).length,
    agentsCount: agentList.length,
    deployment: {
      databaseConnected: true,
      isVercel: Boolean(process.env.VERCEL),
      isSupabaseUrl: Boolean(
        process.env.DATABASE_URL?.includes("supabase") ||
          process.env.NEXT_PUBLIC_SUPABASE_URL
      ),
      telegramConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
      region: process.env.VERCEL_REGION || "local",
    },
  });
}

function validateAddress(addr: string): string | null {
  if (!addr) return "آدرس کیف پول خالی است.";
  if (addr.startsWith("0x")) {
    if (!/^0x[a-fA-F0-9]{40}$/.test(addr))
      return "آدرس EVM (متامسک) باید با 0x شروع شود و ۴۰ کاراکتر هگز داشته باشد.";
    return null;
  }
  if (addr.startsWith("T") && addr.length === 34)
    return null; // TRON — توجه: متامسک ترون ندارد
  return "فرمت آدرس معتبر نیست. آدرس متامسک (0x...) یا ترون (T...) وارد کنید.";
}

export async function PUT(req: NextRequest) {
  await ensureSeed();
  const b = await req.json();
  const address = String(b.address || "").trim();
  const network = String(b.network || "USDT-BEP20").trim();

  const err = validateAddress(address);
  if (err) {
    return NextResponse.json({ error: err }, { status: 400 });
  }
  if (address.startsWith("T") && !network.includes("TRC")) {
    return NextResponse.json(
      { error: "آدرس ترون (T...) فقط با شبکه TRC20 سازگار است." },
      { status: 400 }
    );
  }

  const updates: [string, string][] = [
    ["master_wallet_address", address],
    ["master_wallet_network", network],
    ["auto_sweep_enabled", String(b.autoSweep === true)],
    ["wallet", `${address} (${network})`],
  ];

  for (const [key, value] of updates) {
    const existing = await db
      .select()
      .from(settings)
      .where(eq(settings.key, key));
    if (existing.length > 0) {
      await db.update(settings).set({ value }).where(eq(settings.key, key));
    } else {
      await db.insert(settings).values({ key, value });
    }
  }

  await db.insert(agentLogs).values({
    agent: "کیف پول برداشت",
    action: "ثبت آدرس برداشت متامسک",
    status: "success",
    detail: `مقصد برداشت همه ایجنت‌ها: ${address} (${network})`,
    durationMs: 0,
  });

  const masterWallet = await getMasterWallet();
  return NextResponse.json({ ok: true, masterWallet });
}
