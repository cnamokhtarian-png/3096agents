import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { settings, agents, transactions, agentActivityLogs } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { ensureSeed, getMasterWallet } from "@/lib/seed";
import { actorOf, guardAdmin } from "@/lib/auth";
import { exchangeStatus, getAccountBalances } from "@/lib/exchange";
import { normalizeNetwork } from "@/lib/onchain";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = guardAdmin(req);
  if (denied) return denied;
  await ensureSeed();
  const [masterWallet, agentList, txList] = await Promise.all([
    getMasterWallet(),
    db.select().from(agents).orderBy(desc(agents.earnedUsdt)),
    db.select().from(transactions).orderBy(desc(transactions.createdAt), desc(transactions.id)),
  ]);

  const fleetTotal = agentList.reduce((s, a) => s + Number(a.earnedUsdt || 0), 0);
  const confirmedDeposits = txList
    .filter((t) => t.kind === "income" && Number(t.amountUsdt) > 0 && t.status === "confirmed")
    .reduce((s, t) => s + Number(t.amountUsdt), 0);
  const pendingDeposits = txList
    .filter((t) => t.status === "pending_verification")
    .reduce((s, t) => s + Number(t.amountUsdt), 0);
  const withdrawals = txList
    .filter((t) => t.kind === "withdraw")
    .reduce((s, t) => s + Math.abs(Number(t.amountUsdt)), 0);

  // موجودی واقعی صرافی فقط اگر کلید و اجازه معامله/خواندن باشد
  const ex = exchangeStatus();
  let exchangeBalance: { asset: string; total: number; free: number; locked: number }[] | null = null;
  let exchangeError: string | null = null;
  if (ex.keysConfigured) {
    try {
      const acc = await getAccountBalances(["USDT"]);
      exchangeBalance = acc.balances;
    } catch (e: any) {
      exchangeError = e?.message || "خواندن موجودی صرافی ناموفق بود";
    }
  }

  return NextResponse.json({
    masterWallet,
    fleetTotal,
    confirmedDeposits,
    pendingDeposits,
    withdrawals,
    netBalance: confirmedDeposits - withdrawals,
    agentsCount: agentList.length,
    exchange: { ...ex, balance: exchangeBalance, error: exchangeError },
    deployment: {
      // این مقادیر واقعاً بررسی می‌شوند، نه true ثابت
      databaseConnected: true,
      isVercel: Boolean(process.env.VERCEL),
      region: process.env.VERCEL_REGION || "local",
      telegramConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_ADMIN_CHAT_ID),
      cronConfigured: Boolean(process.env.CRON_SECRET),
      tradingEnabled: ex.tradingEnabled,
    },
    transactions: txList.slice(0, 50),
  });
}

export async function PUT(req: NextRequest) {
  const denied = guardAdmin(req);
  if (denied) return denied;
  await ensureSeed();

  const b = await req.json().catch(() => ({}));
  const address = String(b.address || "").trim();
  const network = normalizeNetwork(String(b.network || "TRC20"));
  const autoSweep = b.autoSweep !== false;

  if (!address) {
    return NextResponse.json({ error: "آدرس کیف پول واحد الزامی است" }, { status: 400 });
  }
  if (address.length < 20) {
    return NextResponse.json({ error: "آدرس کیف پول معتبر نیست" }, { status: 400 });
  }

  const updates: Array<[string, string]> = [
    ["master_wallet_address", address],
    ["master_wallet_network", `USDT-${network}`],
    ["auto_sweep_enabled", String(autoSweep)],
    ["wallet", `${address} (USDT-${network})`],
  ];

  for (const [key, value] of updates) {
    const existing = await db.select().from(settings).where(eq(settings.key, key));
    if (existing.length > 0) {
      await db.update(settings).set({ value }).where(eq(settings.key, key));
    } else {
      await db.insert(settings).values({ key, value });
    }
  }

  await db.insert(agentActivityLogs).values({
    agentName: "کیف پول واحد مرکزی",
    action: "به‌روزرسانی آدرس کیف پول واحد",
    status: "success",
    detail: `آدرس جدید: ${address} (${network}) • توسط ${actorOf(req)}`,
    source: "panel",
  });

  const masterWallet = await getMasterWallet();
  return NextResponse.json({ ok: true, masterWallet });
}
