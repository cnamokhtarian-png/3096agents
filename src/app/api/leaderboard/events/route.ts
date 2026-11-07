import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { agents, agentScoreEvents } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { ensureSeed } from "@/lib/seed";
import { isOutcome, recordScoreEvent } from "@/lib/leaderboard";

export const dynamic = "force-dynamic";

/** GET /api/leaderboard/events?period=YYYY-MM → دفترچهٔ نتایج */
export async function GET(req: NextRequest) {
  await ensureSeed();
  const period = new URL(req.url).searchParams.get("period");
  const rows = await db
    .select()
    .from(agentScoreEvents)
    .where(period ? eq(agentScoreEvents.period, period) : undefined)
    .orderBy(desc(agentScoreEvents.id))
    .limit(100);
  return NextResponse.json(rows);
}

/**
 * POST /api/leaderboard/events
 * ثبت نتیجهٔ یک پروژه: { agentId, outcome, projectTitle, durationMinutes, note }
 * هدر اختیاری x-agent-key: ایجنت خارجی فقط می‌تواند برای خودش نتیجه ثبت کند.
 */
export async function POST(req: NextRequest) {
  try {
    await ensureSeed();
    const b = await req.json().catch(() => ({}));
    const agentId = Number(b.agentId || b.id);
    if (!agentId || !isOutcome(b.outcome)) {
      return NextResponse.json(
        { error: "agentId و outcome (success|failure|error) الزامی است" },
        { status: 400 }
      );
    }

    const headerKey =
      req.headers.get("x-agent-key") ||
      req.headers.get("authorization")?.replace("Bearer ", "") ||
      "";
    let source = "manual";
    if (headerKey) {
      const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
      const masterKey = process.env.AGENT_MASTER_API_KEY;
      if (!agent || (agent.apiKey !== headerKey && headerKey !== masterKey)) {
        return NextResponse.json(
          { error: "کلید API ایجنت نامعتبر است (Unauthorized)" },
          { status: 401 }
        );
      }
      source = "api";
    }

    const result = await recordScoreEvent({
      agentId,
      outcome: b.outcome,
      projectTitle: b.projectTitle || b.title,
      durationMinutes: Number(b.durationMinutes) || 0,
      note: b.note,
      period: b.period,
      source,
      sourceRef: b.sourceRef ? String(b.sourceRef) : null,
    });
    return NextResponse.json({
      ok: true,
      ...result,
      message: result.duplicate
        ? "این نتیجه قبلاً ثبت شده بود (جلوگیری از دوباره‌شماری) ⛔"
        : "نتیجه در دفترچهٔ لیگ ثبت شد ✅",
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "خطا در ثبت نتیجه" },
      { status: 400 }
    );
  }
}

/**
 * DELETE /api/leaderboard/events?id=12  یا  ?source=seed
 * حذف یک رویداد اشتباهی یا پاک کردن کامل داده‌های نمونه.
 */
export async function DELETE(req: NextRequest) {
  await ensureSeed();
  const u = new URL(req.url);
  const id = Number(u.searchParams.get("id"));
  const source = u.searchParams.get("source");
  const period = u.searchParams.get("period");
  if (id) {
    await db.delete(agentScoreEvents).where(eq(agentScoreEvents.id, id));
    return NextResponse.json({ ok: true, deleted: "event" });
  }
  if (source) {
    await db
      .delete(agentScoreEvents)
      .where(
        period
          ? and(eq(agentScoreEvents.source, source), eq(agentScoreEvents.period, period))
          : eq(agentScoreEvents.source, source)
      );
    return NextResponse.json({ ok: true, deleted: "source", source, period });
  }
  return NextResponse.json({ error: "id یا source الزامی است" }, { status: 400 });
}
