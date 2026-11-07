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

  const fleetTotal = agentList.reduce(
    (s, a) => s + Number(a.earnedUsdt || 0),
    0
  );
  const confirmedDeposits = txList
    .filter((t) => Number(t.amountUsdt) > 0 && t.status === "confirmed")
    .reduce((s, t) => s + Number(t.amountUsdt), 0);

  return NextResponse.json({
    masterWallet,
    fleetTotal,
    confirmedDeposits,
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

export async function PUT(req: NextRequest) {
  await ensureSeed();
  const b = await req.json();
  const updates: [string, string][] = [
    ["master_wallet_address", String(b.address || "").trim()],
    ["master_wallet_network", String(b.network || "USDT-TRC20").trim()],
    ["auto_sweep_enabled", String(b.autoSweep !== false)],
    [
      "wallet",
      `${String(b.address || "").trim()} (${String(
        b.network || "USDT-TRC20"
      ).trim()})`,
    ],
  ];

  for (const [key, value] of updates) {
    if (!value && key === "master_wallet_address") continue;
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
    agent: "کیف پول واحد مرکزی",
    action: "به‌روزرسانی آدرس کیف پول واحد",
    status: "success",
    detail: `تمام ایجنت‌ها به آدرس ${b.address} (${b.network}) متصل شدند`,
    durationMs: 110,
  });

  const masterWallet = await getMasterWallet();
  return NextResponse.json({ ok: true, masterWallet });
}
