import { NextResponse } from "next/server";
import { db } from "@/db";
import { projects, tasks, messages, transactions, agents } from "@/db/schema";
import { ensureSeed, getMasterWallet } from "@/lib/seed";

export const dynamic = "force-dynamic";

export async function GET() {
  await ensureSeed();
  const [p, t, m, tx, ag, masterWallet] = await Promise.all([
    db.select().from(projects),
    db.select().from(tasks),
    db.select().from(messages),
    db.select().from(transactions),
    db.select().from(agents),
    getMasterWallet(),
  ]);

  const totalBudget = p.reduce((s: number, x: any) => s + Number(x.budgetUsdt || 0), 0);
  const received = p.reduce((s: number, x: any) => s + Number(x.receivedUsdt || 0), 0);
  const income = tx
    .filter((x: any) => Number(x.amountUsdt) > 0)
    .reduce((s: number, x: any) => s + Number(x.amountUsdt || 0), 0);
  const fleetTotal = ag.reduce((s: number, x: any) => s + Number(x.earnedUsdt || 0), 0);

  return NextResponse.json({
    projects: p.length,
    active: p.filter((x: any) => x.status === "in_progress").length,
    pendingTasks: t.filter((x: any) => x.status === "pending").length,
    unread: m.filter((x: any) => x.status === "unread").length,
    totalBudget,
    received,
    income,
    fleetTotal,
    activeAgents: ag.filter((x: any) => x.status === "active").length,
    totalAgents: ag.length,
    masterWallet,
    pendingAmount: Math.max(0, totalBudget - received),
    byStatus: Object.fromEntries(
      ["new", "negotiating", "approved", "in_progress", "delivered", "paid"].map(
        (s) => [s, p.filter((x: any) => x.status === s).length]
      )
    ),
    livePrice: 1.0 + Math.random() * 0.002,
    btc: 97400 + Math.round(Math.random() * 800),
    eth: 3420 + Math.round(Math.random() * 60),
    chart: [
      { m: "فروردین", v: 420 },
      { m: "اردیبهشت", v: 780 },
      { m: "خرداد", v: 640 },
      { m: "تیر", v: 1120 },
      { m: "مرداد", v: 980 },
      { m: "شهریور", v: Math.round(income) || 3125 },
    ],
  });
}
