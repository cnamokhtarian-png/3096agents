import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  tasks,
  messages,
  transactions,
  agentLogs,
  toolRuns,
  agents,
} from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { ensureSeed, getMasterWallet, requireAdmin } from "@/lib/seed";

const map: Record<string, any> = {
  tasks,
  messages,
  transactions,
  logs: agentLogs,
  tools: toolRuns,
  agents,
};

export async function GET(req: NextRequest) {
  await ensureSeed();
  const t = new URL(req.url).searchParams.get("type") || "tasks";
  const table = map[t];
  if (!table) {
    return NextResponse.json({ error: "bad type" }, { status: 400 });
  }
  const rows = await db.select().from(table).orderBy(desc(table.id));
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  await ensureSeed();
  const b = await req.json();
  const t = b._type;
  const table: any = map[t];
  if (!table) {
    return NextResponse.json({ error: "bad" }, { status: 400 });
  }
  const { _type, ...data } = b;
  if (data.amountUsdt !== undefined) {
    data.amountUsdt = Number(data.amountUsdt);
  }
  if (t === "transactions" && !data.destinationWallet) {
    const mw = await getMasterWallet();
    data.destinationWallet = mw.address;
  }
  const rows: any = await db.insert(table).values(data).returning();
  return NextResponse.json(rows[0]);
}

export async function PUT(req: NextRequest) {
  await ensureSeed();
  if (!requireAdmin(req)) {
    return NextResponse.json({ error: "نیاز به ورود مدیر" }, { status: 401 });
  }
  const b = await req.json();
  const t = b._type;
  const table: any = map[t];
  if (!table) {
    return NextResponse.json({ error: "bad" }, { status: 400 });
  }
  const { _type, id, ...data } = b;
  const rows: any = await db
    .update(table)
    .set(data)
    .where(eq(table.id, Number(id)))
    .returning();
  // تأیید پاداش از داشبورد هم مثل تلگرام در درآمدها ثبت می‌شود (B7)
  if (t === "tasks" && (data as any).status === "approved" && rows[0]?.actionType === "bounty") {
    let p: any = {};
    try {
      p = JSON.parse(rows[0].payload || "{}");
    } catch {}
    const { transactions } = await import("@/db/schema");
    const dup: any = await db.select().from(transactions).where(eq(transactions.title, `🎁 پاداش تأییدشده: ${(rows[0].title || "").replace("🎁 پاداش: ", "").slice(0, 80)}`));
    if (dup.length === 0) {
      await db.insert(transactions).values({
        title: `🎁 پاداش تأییدشده: ${(rows[0].title || "").replace("🎁 پاداش: ", "").slice(0, 80)}`,
        projectTitle: "شکار پاداش",
        agentName: rows[0].agent || "B7 · شکارچی پاداش",
        destinationWallet: "",
        amountUsdt: Number(p.reward_usdt) || 0,
        network: "—",
        txHash: "",
        kind: "income",
        status: "confirmed",
      });
    }
  }
  return NextResponse.json(rows[0]);
}

export async function DELETE(req: NextRequest) {
  await ensureSeed();
  const u = new URL(req.url);
  const t = u.searchParams.get("type") || "";
  const id = Number(u.searchParams.get("id"));
  const table = map[t];
  if (!table) {
    return NextResponse.json({ error: "bad" }, { status: 400 });
  }
  await db.delete(table).where(eq(table.id, id));
  return NextResponse.json({ ok: true });
}
