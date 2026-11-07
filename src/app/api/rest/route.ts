import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  tasks,
  messages,
  transactions,
  agentLogs,
  toolRuns,
  agents,
  projects,
  agentActivityLogs,
  agentJobs,
  exchangeOrders,
  cronRuns,
  systemEvents,
  marketSnapshots,
} from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { ensureSeed } from "@/lib/seed";
import { actorOf, guardAdmin } from "@/lib/auth";
import { recordRealAgentExecution } from "@/lib/agent-execution";
import { safeRoute } from "@/lib/api-response";

export const dynamic = "force-dynamic";

/**
 * CRUD عمومی داشبورد.
 *  • خواندن: همه جدول‌ها (شامل دفتر فعالیت و صف کار)
 *  • نوشتن: فقط جدول‌های مجاز و فقط فیلدهای مجاز
 *  • تراکنش درآمد: همیشه از مسیر recordRealAgentExecution با الزام هش عبور می‌کند
 */

const readMap: Record<string, any> = {
  tasks,
  messages,
  transactions,
  logs: agentLogs,
  tools: toolRuns,
  agents,
  projects,
  activity: agentActivityLogs,
  jobs: agentJobs,
  orders: exchangeOrders,
  cron: cronRuns,
  events: systemEvents,
  market: marketSnapshots,
};

const writeMap: Record<string, { table: any; fields: string[] }> = {
  tasks: {
    table: tasks,
    fields: [
      "title",
      "agent",
      "actionType",
      "description",
      "projectTitle",
      "status",
      "risk",
      "payload",
    ],
  },
  messages: {
    table: messages,
    fields: [
      "chatId",
      "clientName",
      "username",
      "direction",
      "text",
      "status",
      "source",
    ],
  },
  logs: {
    table: agentLogs,
    fields: ["agent", "action", "status", "detail", "durationMs"],
  },
};

export async function GET(req: NextRequest) {
  return safeRoute(
    async () => {
      const denied = guardAdmin(req);
      if (denied) return denied;
      await ensureSeed();
      const t = new URL(req.url).searchParams.get("type") || "tasks";
      const table = readMap[t];
      if (!table)
        return NextResponse.json(
          { error: "نوع داده نامعتبر است" },
          { status: 400 },
        );
      const rows = await db
        .select()
        .from(table)
        .orderBy(desc(table.id))
        .limit(500);
      return NextResponse.json(rows);
    },
    {
      logLabel: "src/app/api/rest/route.ts#GET",
      exposeDetail: process.env.NODE_ENV !== "production",
    },
  );
}

export async function POST(req: NextRequest) {
  return safeRoute(
    async () => {
      const denied = guardAdmin(req);
      if (denied) return denied;
      await ensureSeed();

      const b = await req.json().catch(() => ({}));
      const t = String(b._type || "");

      // ── تراکنش: ثبت واقعی درآمد با شاهد ───────────────────────────────
      if (t === "transactions") {
        const amount = Number(b.amountUsdt);
        const txHash = String(b.txHash || "").trim();
        const agentName = String(b.agentName || "سیستم مرکزی");
        const title = String(b.title || "").trim();

        if (!title)
          return NextResponse.json(
            { error: "عنوان تراکنش الزامی است" },
            { status: 422 },
          );
        if (!Number.isFinite(amount) || amount <= 0) {
          return NextResponse.json(
            { error: "مبلغ باید بزرگ‌تر از صفر باشد" },
            { status: 422 },
          );
        }
        if (!txHash || txHash.length < 16) {
          return NextResponse.json(
            {
              error:
                "برای ثبت تراکنش، هش واقعی (txHash) الزامی است. ورود مبلغ بدون شاهد مجاز نیست.",
            },
            { status: 422 },
          );
        }

        const res = await recordRealAgentExecution({
          agentName,
          title,
          rewardUsdt: amount,
          txHash,
          network: b.network,
          projectTitle: b.projectTitle,
          destinationWallet: b.destinationWallet,
          source: "manual_ceo",
          verified: true,
        });

        if (!res.success)
          return NextResponse.json({ error: res.error }, { status: 422 });
        return NextResponse.json({
          ...res.data,
          duplicate: res.duplicate ?? false,
        });
      }

      const def = writeMap[t];
      if (!def) {
        return NextResponse.json(
          {
            error: "این نوع داده از طریق API عمومی قابل نوشتن نیست",
            allowed: Object.keys(writeMap),
          },
          { status: 400 },
        );
      }

      const data: Record<string, unknown> = {};
      for (const f of def.fields) if (b[f] !== undefined) data[f] = b[f];

      if (t === "tasks" && !data.title) {
        return NextResponse.json(
          { error: "عنوان تسک الزامی است" },
          { status: 422 },
        );
      }
      if (t === "messages" && !data.text) {
        return NextResponse.json(
          { error: "متن پیام الزامی است" },
          { status: 422 },
        );
      }
      const rows: any = await db.insert(def.table).values(data).returning();
      return NextResponse.json(rows[0]);
    },
    {
      logLabel: "src/app/api/rest/route.ts#POST",
      exposeDetail: process.env.NODE_ENV !== "production",
    },
  );
}

export async function PUT(req: NextRequest) {
  return safeRoute(
    async () => {
      const denied = guardAdmin(req);
      if (denied) return denied;
      await ensureSeed();

      const b = await req.json().catch(() => ({}));
      const t = String(b._type || "");
      const def = writeMap[t];
      if (!def)
        return NextResponse.json(
          { error: "ویرایش این داده مجاز نیست" },
          { status: 400 },
        );

      const id = Number(b.id);
      if (!id)
        return NextResponse.json(
          { error: "شناسه الزامی است" },
          { status: 400 },
        );

      const data: Record<string, unknown> = {};
      for (const f of def.fields) if (b[f] !== undefined) data[f] = b[f];

      const rows: any = await db
        .update(def.table)
        .set(data)
        .where(eq(def.table.id, id))
        .returning();
      const row = rows[0];

      if (t === "tasks" && row && data.status) {
        await db
          .insert(agentActivityLogs)
          .values({
            agentName: row.agent || "ایجنت",
            action:
              data.status === "approved"
                ? "تسک توسط مدیرعامل تأیید شد"
                : `وضعیت تسک: ${data.status}`,
            status: data.status === "rejected" ? "skipped" : "success",
            detail: `${row.title} • توسط ${actorOf(req)}`,
            source: "panel",
          })
          .catch(() => {});
      }

      return NextResponse.json(row);
    },
    {
      logLabel: "src/app/api/rest/route.ts#PUT",
      exposeDetail: process.env.NODE_ENV !== "production",
    },
  );
}

export async function DELETE(req: NextRequest) {
  return safeRoute(
    async () => {
      const denied = guardAdmin(req);
      if (denied) return denied;
      await ensureSeed();
      const u = new URL(req.url);
      const t = u.searchParams.get("type") || "";
      const id = Number(u.searchParams.get("id"));
      const def = writeMap[t];
      if (!def)
        return NextResponse.json(
          { error: "حذف این داده مجاز نیست" },
          { status: 400 },
        );
      if (!id)
        return NextResponse.json(
          { error: "شناسه الزامی است" },
          { status: 400 },
        );
      await db.delete(def.table).where(eq(def.table.id, id));
      return NextResponse.json({ ok: true });
    },
    {
      logLabel: "src/app/api/rest/route.ts#DELETE",
      exposeDetail: process.env.NODE_ENV !== "production",
    },
  );
}
