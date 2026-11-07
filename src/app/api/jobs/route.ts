import { NextRequest, NextResponse } from "next/server";
import { actorOf, guardAdmin } from "@/lib/auth";
import {
  approveJob,
  createJob,
  listJobs,
  rejectJob,
  retryJob,
} from "@/lib/jobs";
import { safeRoute } from "@/lib/api-response";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return safeRoute(
    async () => {
      const denied = guardAdmin(req);
      if (denied) return denied;
      const u = new URL(req.url);
      const agentId = u.searchParams.get("agentId");
      const status = u.searchParams.get("status");
      const rows = await listJobs({
        agentId: agentId ? Number(agentId) : undefined,
        status: status ? status.split(",").filter(Boolean) : undefined,
        limit: Number(u.searchParams.get("limit") || 100),
      });
      return NextResponse.json(rows);
    },
    {
      logLabel: "src/app/api/jobs/route.ts#GET",
      exposeDetail: process.env.NODE_ENV !== "production",
    },
  );
}

export async function POST(req: NextRequest) {
  return safeRoute(
    async () => {
      const denied = guardAdmin(req);
      if (denied) return denied;
      const b = await req.json().catch(() => ({}));
      if (!b.agentId || !b.kind || !b.title) {
        return NextResponse.json(
          { error: "agentId، kind و title الزامی هستند" },
          { status: 400 },
        );
      }
      const res = await createJob({
        agentId: Number(b.agentId),
        agentName: String(b.agentName || "کارمند"),
        kind: b.kind,
        title: b.title,
        detail: b.detail,
        payload: b.payload,
        risk: b.risk,
        requiresApproval: b.requiresApproval,
      });
      return NextResponse.json(res);
    },
    {
      logLabel: "src/app/api/jobs/route.ts#POST",
      exposeDetail: process.env.NODE_ENV !== "production",
    },
  );
}

export async function PATCH(req: NextRequest) {
  return safeRoute(
    async () => {
      const denied = guardAdmin(req);
      if (denied) return denied;
      const b = await req.json().catch(() => ({}));
      const id = Number(b.id);
      if (!id)
        return NextResponse.json(
          { error: "شناسه کار لازم است" },
          { status: 400 },
        );
      const actor = actorOf(req);

      if (b.action === "approve") {
        const res = await approveJob(id, actor);
        return NextResponse.json(res, { status: res.ok ? 200 : 409 });
      }
      if (b.action === "reject") {
        const res = await rejectJob(id, actor, String(b.reason || ""));
        return NextResponse.json(res, { status: res.ok ? 200 : 409 });
      }
      if (b.action === "retry") {
        const res = await retryJob(id, actor);
        return NextResponse.json(res, { status: res.ok ? 200 : 409 });
      }
      return NextResponse.json(
        { error: "action باید approve / reject / retry باشد" },
        { status: 400 },
      );
    },
    {
      logLabel: "src/app/api/jobs/route.ts#PATCH",
      exposeDetail: process.env.NODE_ENV !== "production",
    },
  );
}
