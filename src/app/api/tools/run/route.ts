import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { agents } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureSeed } from "@/lib/seed";
import { actorOf, guardAdmin } from "@/lib/auth";
import { approveJob, createJob } from "@/lib/jobs";
import { ENV } from "@/lib/env";
import { safeRoute } from "@/lib/api-response";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * اجرای ابزار (Next.js Scaffolder / PPTX / مترجم).
 *
 * این اندپوینت دیگر خروجی جعلی نمی‌سازد. ابزار به «ورکر واقعی»
 * (AGENT_WORKER_URL — مثلاً n8n یا سرویس پایتون) ارسال می‌شود و خروجی
 * عیناً همان چیزی است که ورکر برمی‌گرداند. اگر ورکر پیکربندی نشده باشد،
 * کار با خطای صریح ثبت می‌شود.
 */
export async function POST(req: NextRequest) {
  return safeRoute(
    async () => {
      const denied = guardAdmin(req);
      if (denied) return denied;
      await ensureSeed();

      const { tool, input } = await req.json().catch(() => ({}));
      if (!tool)
        return NextResponse.json({ error: "tool الزامی است" }, { status: 400 });

      const rows = await db.select().from(agents);
      const owner =
        rows.find(
          (a) => tool.includes("Next") && a.specialty === "freelance",
        ) ||
        rows.find(
          (a) =>
            (tool.includes("PPT") || tool.includes("مترجم")) &&
            a.specialty === "content",
        ) ||
        rows[0];

      if (!owner) {
        return NextResponse.json(
          { error: "هیچ کارمندی برای اجرای ابزار وجود ندارد" },
          { status: 404 },
        );
      }

      const { job } = await createJob({
        agentId: owner.id,
        agentName: owner.name,
        kind: "tool_run",
        title: `اجرای ابزار «${tool}»`,
        detail: String(input || ""),
        payload: { tool, input },
        risk: "low",
        requiresApproval: false,
      });

      const workerConfigured = Boolean(ENV.workerUrl());

      // حتی وقتی ورکر نیست، کار را اجرا می‌کنیم تا با خطای صریح «failed» ثبت شود
      const res = await approveJob(job.id, actorOf(req));

      if (!workerConfigured) {
        return NextResponse.json(
          {
            ok: false,
            job: res.job,
            code: "worker_not_configured",
            error:
              "ورکر اجرای ابزار ست نشده است. AGENT_WORKER_URL را در Vercel تنظیم کنید تا ابزار واقعاً اجرا شود. (هیچ خروجی ساختگی تولید نمی‌شود)",
          },
          { status: 503 },
        );
      }
      return NextResponse.json(
        {
          ok: res.ok,
          job: res.job,
          output: (res.execution as any)?.result?.output ?? null,
          error: res.ok ? null : (res.execution as any)?.error,
        },
        { status: res.ok ? 200 : 502 },
      );
    },
    {
      logLabel: "src/app/api/tools/run/route.ts#POST",
      exposeDetail: process.env.NODE_ENV !== "production",
    },
  );
}

export async function GET() {
  return safeRoute(
    async () => {
      await ensureSeed();
      return NextResponse.json({
        ok: true,
        workerConfigured: Boolean(ENV.workerUrl()),
        message: Boolean(ENV.workerUrl())
          ? "ورکر متصل است؛ ابزارها واقعاً اجرا می‌شوند."
          : "ورکر متصل نیست؛ درخواست‌ها بدون خروجی جعلی رد می‌شوند.",
      });
    },
    {
      logLabel: "src/app/api/tools/run/route.ts#GET",
      exposeDetail: process.env.NODE_ENV !== "production",
    },
  );
}
