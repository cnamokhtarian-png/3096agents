import { db } from "@/db";
import { reportDeliveries } from "@/db/schema";
import { and, eq, lt, or } from "drizzle-orm";

export type ReportDeliveryClaim =
  | { claimed: true; id: number }
  | { claimed: false; reason: "already_sent" | "in_progress" };

const STALE_MS = 10 * 60_000;

/**
 * Claim اتمیک برای ارسال گزارش UNIQUE delivery_key جلوی ارسال هم‌زمان
 * چند کرون/دپلوی را می‌گیرد. وضعیت failed یا sendingِ قدیمی قابل تلاش مجدد است.
 */
export async function claimReportDelivery(input: {
  deliveryKey: string;
  chatId: string;
  agentId?: number | null;
  scope?: string;
}): Promise<ReportDeliveryClaim> {
  const inserted = await db
    .insert(reportDeliveries)
    .values({
      deliveryKey: input.deliveryKey,
      chatId: input.chatId,
      agentId: input.agentId ?? null,
      scope: input.scope ?? "daily",
      status: "sending",
    })
    .onConflictDoNothing({ target: reportDeliveries.deliveryKey })
    .returning({ id: reportDeliveries.id });

  if (inserted[0]) return { claimed: true, id: inserted[0].id };

  const staleBefore = new Date(Date.now() - STALE_MS);
  const retry = await db
    .update(reportDeliveries)
    .set({ status: "sending", error: "", createdAt: new Date(), sentAt: null })
    .where(
      and(
        eq(reportDeliveries.deliveryKey, input.deliveryKey),
        or(
          eq(reportDeliveries.status, "failed"),
          and(eq(reportDeliveries.status, "sending"), lt(reportDeliveries.createdAt, staleBefore)),
        ),
      ),
    )
    .returning({ id: reportDeliveries.id });

  if (retry[0]) return { claimed: true, id: retry[0].id };

  const rows = await db
    .select({ status: reportDeliveries.status })
    .from(reportDeliveries)
    .where(eq(reportDeliveries.deliveryKey, input.deliveryKey))
    .limit(1);
  return {
    claimed: false,
    reason: rows[0]?.status === "sent" ? "already_sent" : "in_progress",
  };
}

export async function markReportSent(id: number, telegramMessageId?: number) {
  await db
    .update(reportDeliveries)
    .set({ status: "sent", sentAt: new Date(), telegramMessageId: telegramMessageId ?? null, error: "" })
    .where(eq(reportDeliveries.id, id));
}

export async function markReportFailed(id: number, error: string) {
  await db
    .update(reportDeliveries)
    .set({ status: "failed", error: error.slice(0, 1000) })
    .where(eq(reportDeliveries.id, id));
}
