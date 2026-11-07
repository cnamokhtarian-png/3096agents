import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { agentActivityLogs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { agents } from "@/db/schema";
import { generateAgentReport } from "@/lib/report";
import { actorOf, guardAdmin } from "@/lib/auth";
import { escapeHtml, notifyAdmin } from "@/lib/telegram";
import { ENV } from "@/lib/env";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** گزارش وضعیت کارمند بر پایه داده واقعی (اختیاری: ارسال به تلگرام). */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = guardAdmin(req);
  if (denied) return denied;

  const { id } = await ctx.params;
  const agentId = Number(id);
  const body = await req.json().catch(() => ({}));
  const sendToTelegram = body?.sendToTelegram !== false;
  const useAi = body?.useAi !== false;

  const rows = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  const agent = rows[0];
  if (!agent) return NextResponse.json({ error: "کارمند پیدا نشد" }, { status: 404 });

  const report = await generateAgentReport(agentId, { useAi });
  if (!report.ok) return NextResponse.json({ error: report.error }, { status: 500 });

  let telegram: Record<string, unknown> = { sent: false, reason: "not_requested" };
  if (sendToTelegram) {
    if (!ENV.telegramToken() || !ENV.telegramAdminChat()) {
      telegram = {
        sent: false,
        reason: "TELEGRAM_BOT_TOKEN یا TELEGRAM_ADMIN_CHAT_ID ست نشده است",
      };
    } else {
      const lines = report.text.split("\n");
      const res = await notifyAdmin(
        `<b>${escapeHtml(lines[0] || "گزارش وضعیت")}</b>\n\n${escapeHtml(lines.slice(1).join("\n"))}`
      );
      telegram = res.ok
        ? { sent: true, messageId: (res as any).result?.message_id }
        : { sent: false, reason: (res as any).description || (res as any).error };
    }
  }

  await db.insert(agentActivityLogs).values({
    agentId: agent.id,
    agentName: agent.name,
    action: "گزارش وضعیت توسط مدیرعامل درخواست شد",
    status: report.error ? "pending" : "success",
    detail: `منبع: ${report.source} • ارسال تلگرام: ${telegram.sent ? "انجام شد" : String(telegram.reason || "خیر")}${
      report.error ? ` • هشدار: ${report.error}` : ""
    }`,
    source: "panel",
    meta: { actor: actorOf(req), reportSource: report.source, telegram },
  });

  return NextResponse.json({
    ok: true,
    report: report.text,
    source: report.source,
    warning: report.error || null,
    telegram,
    facts: report.facts,
  });
}
