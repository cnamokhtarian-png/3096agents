import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { ensureSeed } from "@/lib/seed";
import { guardAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = guardAdmin(req);
  if (denied) return denied;
  await ensureSeed();
  const rows = await db.select().from(projects).orderBy(desc(projects.id));
  return NextResponse.json(rows);
}

function normalize(b: any) {
  return {
    title: String(b.title || "").trim(),
    clientName: String(b.clientName || "").trim(),
    telegramUser: String(b.telegramUser || "").trim(),
    source: String(b.source || "تلگرام"),
    type: String(b.type || "nextjs"),
    status: String(b.status || "new"),
    priority: String(b.priority || "medium"),
    budgetUsdt: Math.max(0, Number(b.budgetUsdt) || 0),
    receivedUsdt: Math.max(0, Number(b.receivedUsdt) || 0),
    wallet: String(b.wallet || ""),
    deadline: String(b.deadline || ""),
    description: String(b.description || ""),
  };
}

export async function POST(req: NextRequest) {
  const denied = guardAdmin(req);
  if (denied) return denied;
  await ensureSeed();
  const data = normalize(await req.json().catch(() => ({})));
  if (!data.title || !data.clientName) {
    return NextResponse.json({ error: "عنوان پروژه و نام مشتری الزامی است" }, { status: 422 });
  }
  const [r] = await db.insert(projects).values(data).returning();
  return NextResponse.json(r);
}

export async function PUT(req: NextRequest) {
  const denied = guardAdmin(req);
  if (denied) return denied;
  await ensureSeed();
  const b = await req.json().catch(() => ({}));
  const id = Number(b.id);
  if (!id) return NextResponse.json({ error: "شناسه پروژه الزامی است" }, { status: 400 });
  const data = normalize(b);
  const [r] = await db.update(projects).set(data).where(eq(projects.id, id)).returning();
  return NextResponse.json(r);
}

export async function DELETE(req: NextRequest) {
  const denied = guardAdmin(req);
  if (denied) return denied;
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "شناسه الزامی است" }, { status: 400 });
  await db.delete(projects).where(eq(projects.id, id));
  return NextResponse.json({ ok: true });
}
