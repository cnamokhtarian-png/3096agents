import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { agents, transactions } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { ensureSeed, getMasterWallet } from "@/lib/seed";
import { ingestExternalIncome, recordAgentError } from "@/lib/agent-execution";
import { createJob } from "@/lib/jobs";
import { normalizeNetwork } from "@/lib/onchain";

export const dynamic = "force-dynamic";

/**
 * API واقعی دریافت درآمد از ربات‌های بیرونی (n8n / TradingView / پایتون).
 *
 * تغییرات کلیدی نسبت به نسخه‌ی نمایشی:
 *  • کلید API اجباری است (هیچ درخواستی به «اولین ایجنت» نسبت داده نمی‌شود).
 *  • مبلغ و هش تراکنش اجباری‌اند؛ پاداش تصادفی حذف شده است.
 *  • هر هش فقط یک‌بار ثبت می‌شود (idempotent).
 *  • اگر تأیید زنجیره‌ای موفق شود → همان لحظه درآمد واقعی ثبت می‌شود.
 *    در غیر این صورت → «در انتظار تأیید مدیرعامل» + درخواست تأیید تلگرام.
 */

export async function GET() {
  await ensureSeed();
  const masterWallet = await getMasterWallet();
  return NextResponse.json({
    ok: true,
    endpoint: "/api/agents/ingest",
    method: "POST",
    behavior: "real-only",
    description:
      "درآمد واقعی را ثبت می‌کند. بدون هش تراکنش معتبر یا تأیید مدیرعامل هیچ مبلغی در درآمد محقق‌شده ثبت نمی‌شود.",
    masterWallet,
    headers: {
      "Content-Type": "application/json",
      "x-agent-key": "کلید اختصاصی ایجنت (از داشبورد بگیرید)",
    },
    requiredBody: {
      amountUsdt: "عدد > 0 — مبلغ واقعی محقق‌شده",
      txHash: "هش تراکنش واقعی (حداقل ۱۶ کاراکتر)",
      network: "TRC20 | BEP20 | ERC20 | TON",
      title: "عنوان درآمد (اختیاری)",
      slug: "در صورت استفاده از AGENT_MASTER_API_KEY الزامی است",
    },
    exampleBody: {
      slug: "custom-webhook-worker",
      amountUsdt: 55.25,
      txHash: "0x9f41c0d2b7a8e6f5d4c3b2a1908f7e6d5c4b3a2910f8e7d6c5b4a39281706f5e",
      network: "BEP20",
      title: "سود واقعی آربیتراژ TON/USDT",
    },
  });
}

export async function POST(req: NextRequest) {
  await ensureSeed();
  const b = await req.json().catch(() => ({}));

  const headerKey =
    (req.headers.get("x-agent-key") || "").trim() ||
    (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();

  if (!headerKey) {
    return NextResponse.json(
      { ok: false, error: "هدر x-agent-key لازم است (Unauthorized)" },
      { status: 401 }
    );
  }

  const masterKey = process.env.AGENT_MASTER_API_KEY?.trim();
  const allAgents = await db.select().from(agents);

  let targetAgent: (typeof allAgents)[number] | undefined;
  if (headerKey === masterKey && masterKey) {
    if (b.agentId) targetAgent = allAgents.find((a) => a.id === Number(b.agentId));
    else if (b.slug) targetAgent = allAgents.find((a) => a.slug === String(b.slug));
  } else {
    targetAgent = allAgents.find((a) => a.apiKey === headerKey);
  }

  if (!targetAgent) {
    return NextResponse.json({ ok: false, error: "کلید API نامعتبر است (Unauthorized)" }, { status: 401 });
  }

  const amountUsdt = Number(b.amountUsdt);
  const txHash = String(b.txHash || "").trim();
  const title = String(b.title || "").trim();

  if (!Number.isFinite(amountUsdt) || amountUsdt <= 0) {
    return NextResponse.json({ ok: false, error: "amountUsdt باید عددی بزرگ‌تر از صفر باشد" }, { status: 422 });
  }
  if (!txHash || txHash.length < 16) {
    return NextResponse.json(
      { ok: false, error: "هش تراکنش معتبر (txHash) الزامی است — بدون شاهد، درآمد ثبت نمی‌شود" },
      { status: 422 }
    );
  }
  if (!title) {
    return NextResponse.json({ ok: false, error: "title الزامی است" }, { status: 422 });
  }

  const wallet = await getMasterWallet();
  const network = normalizeNetwork(b.network || wallet.network);

  const duplicate = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.txHash, txHash), eq(transactions.kind, "income")))
    .limit(1);
  if (duplicate[0]) {
    return NextResponse.json({
      ok: true,
      duplicate: true,
      status: duplicate[0].status,
      message: "این هش تراکنش قبلاً ثبت شده است؛ ثبت تکراری انجام نشد.",
      transaction: duplicate[0],
    });
  }

  try {
    const result = await ingestExternalIncome({
      agentName: targetAgent.name,
      title,
      amountUsdt,
      txHash,
      network,
      source: "ingest",
      projectTitle: targetAgent.role,
    });

    if (result.status === "confirmed") {
      return NextResponse.json({
        ok: true,
        status: "confirmed",
        verification: result.verification,
        transaction: result.recorded.data,
        message: "واریز روی زنجیره تأیید و به‌عنوان درآمد واقعی ثبت شد.",
        masterWallet: wallet,
      });
    }

    const { job, telegram } = await createJob({
      agentId: targetAgent.id,
      agentName: targetAgent.name,
      kind: "confirm_deposit",
      title: `تأیید واریز ${amountUsdt} USDT — ${title}`,
      detail: `هش: ${txHash}\nشبکه: ${network}\nدلیل نیاز به تأیید: ${result.verification.reason}`,
      payload: {
        transactionId: result.transaction.id,
        txHash,
        amountUsdt,
        network,
        verifiedOnchain: false,
      },
      risk: "medium",
      requiresApproval: true,
    });

    const [linked] = await db
      .update(transactions)
      .set({ jobId: job.id })
      .where(eq(transactions.id, result.transaction.id))
      .returning();

    return NextResponse.json({
      ok: true,
      status: "pending_verification",
      verification: result.verification,
      transaction: linked ?? result.transaction,
      job,
      telegram,
      message:
        "واریز ثبت شد اما تا تأیید مدیرعامل در درآمد محقق‌شده حساب نمی‌شود. درخواست تأیید ارسال شد.",
    });
  } catch (e: any) {
    await recordAgentError({
      agentName: targetAgent.name,
      action: "خطا در پردازش واریز ورودی",
      detail: e?.message || String(e),
      source: "ingest",
      meta: { txHash, amountUsdt },
    });
    return NextResponse.json(
      { ok: false, error: e?.message || "خطا در ثبت درآمد" },
      { status: 500 }
    );
  }
}
