import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { agents, agentLogs } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { ensureSeed, getMasterWallet, requireAdmin } from "@/lib/seed";
import { randomBytes } from "crypto";

export async function GET() {
  await ensureSeed();
  const [list, masterWallet] = await Promise.all([
    db.select().from(agents).orderBy(desc(agents.earnedUsdt)),
    getMasterWallet(),
  ]);
  return NextResponse.json({ agents: list, masterWallet });
}

export async function POST(req: NextRequest) {
  await ensureSeed();
  const b = await req.json();
  const slugBase = String(b.slug || b.name || "agent")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const slug = `${slugBase || "worker"}-${randomBytes(2).toString("hex")}`;
  const apiKey = `ag_live_${randomBytes(10).toString("hex")}`;

  const [created] = await db
    .insert(agents)
    .values({
      name: b.name || "کارمند دیجیتال جدید",
      slug,
      role: b.role || "ایجنت درآمدزای متصل به کیف پول واحد",
      specialty: b.specialty || "crypto",
      avatar:
        b.avatar ||
        (b.specialty === "crypto"
          ? "🪙"
          : b.specialty === "custom_api"
          ? "🔌"
          : "🤖"),
      status: b.status || "active",
      apiEndpoint: b.apiEndpoint || "/api/agents/ingest",
      apiKey,
      earnedUsdt: Number(b.earnedUsdt) || 0,
      tasksCompleted: Number(b.tasksCompleted) || 0,
      payoutMode: "auto_unified",
      strategy:
        b.strategy || "تولید درآمد خودکار و واریز مستقیم به کیف پول واحد",
    })
    .returning();

  await db.insert(agentLogs).values({
    agent: created.name,
    action: "استخدام کارمند / ساخت API ایجنت جدید",
    status: "success",
    detail: `کلید اختصاصی ${apiKey.slice(0, 14)}... ایجاد و به کیف پول واحد متصل شد`,
    durationMs: 140,
  });

  return NextResponse.json(created);
}

export async function PUT(req: NextRequest) {
  await ensureSeed();
  if (!requireAdmin(req)) {
    return NextResponse.json({ error: "نیاز به ورود مدیر" }, { status: 401 });
  }
  const b = await req.json();
  const [updated] = await db
    .update(agents)
    .set({
      name: b.name,
      role: b.role,
      specialty: b.specialty,
      status: b.status,
      strategy: b.strategy,
      apiEndpoint: b.apiEndpoint,
    })
    .where(eq(agents.id, Number(b.id)))
    .returning();
  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest) {
  await ensureSeed();
  const id = Number(new URL(req.url).searchParams.get("id"));
  await db.delete(agents).where(eq(agents.id, id));
  return NextResponse.json({ ok: true });
}
