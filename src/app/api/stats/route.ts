import { NextResponse } from "next/server";
import { db } from "@/db";
import { projects, tasks, messages, transactions, agents } from "@/db/schema";
import { ensureSeed, getMasterWallet } from "@/lib/seed";

export const dynamic = "force-dynamic";

async function fetchPrices(): Promise<{ btc: number | null; eth: number | null }> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(
      'https://api.binance.com/api/v3/ticker/price?symbols=["BTCUSDT","ETHUSDT"]',
      { signal: ctrl.signal, cache: "no-store" }
    );
    clearTimeout(t);
    if (!res.ok) return { btc: null, eth: null };
    const arr = (await res.json()) as { symbol: string; price: string }[];
    const get = (s: string) => {
      const f = arr.find((x) => x.symbol === s);
      return f ? Math.round(Number(f.price)) : null;
    };
    return { btc: get("BTCUSDT"), eth: get("ETHUSDT") };
  } catch {
    return { btc: null, eth: null };
  }
}

export async function GET() {
  await ensureSeed();
  const [p, t, m, tx, ag, masterWallet, prices] = await Promise.all([
    db.select().from(projects),
    db.select().from(tasks),
    db.select().from(messages),
    db.select().from(transactions),
    db.select().from(agents),
    getMasterWallet(),
    fetchPrices(),
  ]);

  const incomes = tx.filter(
    (x: any) =>
      x.kind === "income" &&
      (x.status === "confirmed" || x.status === "completed") &&
      Number(x.amountUsdt) > 0
  );
  const payouts = tx.filter(
    (x: any) =>
      x.kind === "payout" &&
      (x.status === "approved" || x.status === "completed") &&
      Number(x.amountUsdt) > 0
  );
  const income = incomes.reduce(
    (s: number, x: any) => s + Number(x.amountUsdt || 0),
    0
  );
  const paidOut = payouts.reduce(
    (s: number, x: any) => s + Number(x.amountUsdt || 0),
    0
  );
  const available = Math.max(0, income - paidOut);

  const totalBudget = p.reduce(
    (s: number, x: any) => s + Number(x.budgetUsdt || 0),
    0
  );
  const received = p.reduce(
    (s: number, x: any) => s + Number(x.receivedUsdt || 0),
    0
  );
  const fleetTotal = ag.reduce(
    (s: number, x: any) => s + Number(x.earnedUsdt || 0),
    0
  );

  // نمودار واقعی: جمع درآمد ۶ ماه اخیر از روی تراکنش‌های ثبت‌شده
  const buckets = new Map<string, { m: string; v: number; key: string }>();
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    buckets.set(key, {
      m: d.toLocaleDateString("fa-IR", { month: "long" }),
      v: 0,
      key,
    });
  }
  for (const x of incomes as any[]) {
    const dt = x.createdAt ? new Date(x.createdAt) : null;
    if (!dt || isNaN(dt.getTime())) continue;
    const key = `${dt.getFullYear()}-${dt.getMonth()}`;
    const b = buckets.get(key);
    if (b) b.v += Number(x.amountUsdt || 0);
  }

  return NextResponse.json({
    projects: p.length,
    active: p.filter((x: any) => x.status === "in_progress").length,
    pendingTasks: t.filter((x: any) => x.status === "pending").length,
    unread: m.filter((x: any) => x.status === "unread").length,
    totalBudget,
    received,
    income,
    paidOut,
    available,
    fleetTotal,
    activeAgents: ag.filter((x: any) => x.status === "active").length,
    totalAgents: ag.length,
    masterWallet,
    pendingAmount: Math.max(0, totalBudget - received),
    pendingPayouts: tx.filter(
      (x: any) => x.kind === "payout" && x.status === "pending"
    ).length,
    byStatus: Object.fromEntries(
      ["new", "negotiating", "approved", "in_progress", "delivered", "paid"].map(
        (s) => [s, p.filter((x: any) => x.status === s).length]
      )
    ),
    btc: prices.btc,
    eth: prices.eth,
    pricesLive: prices.btc !== null,
    chart: [...buckets.values()].map(({ m, v }) => ({ m, v: Math.round(v) })),
  });
}
