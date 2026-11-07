import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { agents, agentLogs, agentActivityLogs } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { ensureSeed, getMasterWallet } from "@/lib/seed";
import { randomBytes } from "crypto";
import { guardAdmin, actorOf } from "@/lib/auth";
import { safeRoute } from "@/lib/api-response";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return safeRoute(
    async () => {
      const denied = guardAdmin(req);
      if (denied) return denied;
      await ensureSeed();
      const [list, masterWallet] = await Promise.all([
        db.select().from(agents).orderBy(desc(agents.earnedUsdt)),
        getMasterWallet(),
      ]);
      return NextResponse.json({ agents: list, masterWallet });
    },
    {
      logLabel: "src/app/api/agents/route.ts#GET",
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

      const slugBase = String(b.slug || b.name || "agent")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      const slug = `${slugBase || "worker"}-${randomBytes(2).toString("hex")}`;
      const apiKey = `ag_live_${randomBytes(12).toString("hex")}`;

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
          status: b.status === "paused" ? "paused" : "active",
          apiEndpoint: b.apiEndpoint || "/api/agents/ingest",
          apiKey,
          // درآمد همیشه از صفر شروع می‌شود؛ با رویداد واقعی رشد می‌کند.
          earnedUsdt: 0,
          tasksCompleted: 0,
          successCount: 0,
          errorCount: 0,
          payoutMode: "auto_unified",
          strategy:
            b.strategy || "تولید درآمد خودکار و واریز مستقیم به کیف پول واحد",
          department: b.department || "",
          goalTitle: b.goalTitle || "",
          goalTargetUsdt: Number(b.goalTargetUsdt) || 0,
          officeFloor: b.officeFloor || "1",
          officeRoom: b.officeRoom || "",
          currentFocus:
            b.currentFocus || "تازه استخدام شده — بدون فعالیت ثبت‌شده",
        })
        .returning();

      const actor = actorOf(req);
      await db.insert(agentLogs).values({
        agent: created.name,
        action: "استخدام کارمند / ساخت API ایجنت جدید",
        status: "success",
        detail: `کلید اختصاصی ${apiKey.slice(0, 14)}... ایجاد شد • استخدام‌کننده: ${actor}`,
      });
      await db.insert(agentActivityLogs).values({
        agentId: created.id,
        agentName: created.name,
        action: "استخدام کارمند دیجیتال",
        status: "success",
        detail: `اتاق ${created.officeRoom || "—"} • هدف: ${created.goalTitle || "تعیین نشده"}`,
        source: "panel",
        meta: { actor },
      });

      return NextResponse.json(created);
    },
    {
      logLabel: "src/app/api/agents/route.ts#POST",
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
      if (!b.id)
        return NextResponse.json(
          { error: "شناسه کارمند لازم است" },
          { status: 400 },
        );

      const patch: Record<string, unknown> = {};
      for (const key of [
        "name",
        "role",
        "specialty",
        "status",
        "strategy",
        "apiEndpoint",
        "department",
        "goalTitle",
        "officeFloor",
        "officeRoom",
        "currentFocus",
      ] as const) {
        if (typeof b[key] === "string") patch[key] = b[key];
      }
      if (b.goalTargetUsdt !== undefined)
        patch.goalTargetUsdt = Number(b.goalTargetUsdt) || 0;

      // اگر هیچ فیلد قابل‌به‌روزرسانی ارسال نشده، خطای ورودی بدهیم نه 500.
      if (Object.keys(patch).length === 0) {
        return NextResponse.json(
          {
            error: "هیچ فیلدی برای به‌روزرسانی ارسال نشده است",
            code: "empty_patch",
          },
          { status: 400 },
        );
      }

      const [updated] = await db
        .update(agents)
        .set(patch)
        .where(eq(agents.id, Number(b.id)))
        .returning();

      if (updated) {
        await db.insert(agentActivityLogs).values({
          agentId: updated.id,
          agentName: updated.name,
          action: patch.status
            ? `تغییر وضعیت به ${patch.status}`
            : "به‌روزرسانی پروفایل کارمند",
          status: "success",
          detail: `توسط ${actorOf(req)}`,
          source: "panel",
        });
      }
      return NextResponse.json(updated);
    },
    {
      logLabel: "src/app/api/agents/route.ts#PUT",
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
      const id = Number(new URL(req.url).searchParams.get("id"));
      if (!id)
        return NextResponse.json({ error: "شناسه نامعتبر" }, { status: 400 });
      await db.delete(agents).where(eq(agents.id, id));
      return NextResponse.json({ ok: true });
    },
    {
      logLabel: "src/app/api/agents/route.ts#DELETE",
      exposeDetail: process.env.NODE_ENV !== "production",
    },
  );
}
