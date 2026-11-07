import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { agents, transactions, agentLogs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureSeed, getMasterWallet, requireAdmin } from "@/lib/seed";

export async function GET() {
  await ensureSeed();
  const masterWallet = await getMasterWallet();
  return NextResponse.json({
    ok: true,
    endpoint: "/api/agents/ingest",
    method: "POST",
    description:
      "ثبت درآمد واقعی ایجنت‌ها. مبلغ و مدرک (هش تراکنش) اجباری است — سیستم هیچ‌وقت مبلغ حدس نمی‌زند.",
    masterWallet: {
      address: masterWallet.address || "(هنوز ثبت نشده — از داشبورد وارد کنید)",
      network: masterWallet.network,
    },
    headers: {
      "Content-Type": "application/json",
      "x-agent-key": "کلید اختصاصی ایجنت (یا AGENT_MASTER_API_KEY)",
    },
    exampleBody: {
      slug: "crypto-employee",
      amountUsdt: 55,
      title: "سود آربیتراژ جفت ارز TON/USDT",
      txHash: "0x...",
      network: "BEP20",
    },
    rules: [
      "amountUsdt (عدد بزرگ‌تر از صفر) همیشه اجباری است.",
      "از API خارجی: txHash واقعی اجباری است.",
      "از داشبورد (نشست ادمین): ثبت دستی با مسئولیت مدیر.",
      "بدون ثبت آدرس برداشت در داشبورد، هیچ درآمدی پذیرفته نمی‌شود.",
    ],
  });
}

export async function POST(req: NextRequest) {
  await ensureSeed();
  const b = await req.json().catch(() => ({}));
  const headerKey =
    req.headers.get("x-agent-key") ||
    req.headers.get("authorization")?.replace("Bearer ", "") ||
    "";

  const masterWallet = await getMasterWallet();
  if (!masterWallet.address) {
    return NextResponse.json(
      {
        error:
          "ابتدا آدرس برداشت (کیف پول متامسک) را در داشبورد ثبت کنید.",
        need: "payout_address",
      },
      { status: 400 }
    );
  }

  // پیدا کردن ایجنت از طریق id، slug یا کلید API
  let targetAgent: any = null;
  const allAgents = await db.select().from(agents);

  if (b.agentId) {
    targetAgent = allAgents.find((a) => a.id === Number(b.agentId));
  } else if (b.slug) {
    targetAgent = allAgents.find((a) => a.slug === b.slug);
  } else if (headerKey) {
    targetAgent = allAgents.find((a) => a.apiKey === headerKey);
  }

  const masterKey = process.env.AGENT_MASTER_API_KEY;
  const isMasterKey = Boolean(masterKey && headerKey && headerKey === masterKey);
  if (headerKey && !targetAgent && !isMasterKey) {
    return NextResponse.json(
      { error: "کلید API ایجنت نامعتبر است (Unauthorized)" },
      { status: 401 }
    );
  }

  if (!targetAgent) {
    targetAgent =
      allAgents.find((a) => a.specialty === "crypto") || allAgents[0];
  }
  if (!targetAgent) {
    return NextResponse.json({ error: "هیچ ایجنتی یافت نشد" }, { status: 404 });
  }

  // اعتماد: نشست ادمین (داشبورد) یا کلید مادر. بقیه باید مدرک بدهند.
  const trusted = Boolean(requireAdmin(req)) || isMasterKey || !headerKey && Boolean(requireAdmin(req));

  const amountUsdt = Number(b.amountUsdt);
  if (!b.amountUsdt || !(amountUsdt > 0)) {
    return NextResponse.json(
      {
        error:
          "مبلغ واقعی (amountUsdt بزرگ‌تر از صفر) لازم است — سیستم مبلغ حدس نمی‌زند.",
        need: "amountUsdt",
      },
      { status: 400 }
    );
  }

  const txHash = String(b.txHash || "").trim();
  if (!trusted && !txHash) {
    return NextResponse.json(
      {
        error:
          "برای ثبت از API خارجی، هش واقعی تراکنش (txHash) لازم است.",
        need: "txHash",
      },
      { status: 400 }
    );
  }

  const title = String(b.title || `درآمد واقعی از ${targetAgent.name}`).slice(0, 200);
  const network = String(
    b.network || masterWallet.network.replace("USDT-", "")
  ).slice(0, 20);

  const newEarned = Number(targetAgent.earnedUsdt || 0) + amountUsdt;
  const newTasks = Number(targetAgent.tasksCompleted || 0) + 1;

  const [updatedAgent] = await db
    .update(agents)
    .set({ earnedUsdt: newEarned, tasksCompleted: newTasks })
    .where(eq(agents.id, targetAgent.id))
    .returning();

  const [tx] = await db
    .insert(transactions)
    .values({
      title,
      projectTitle: targetAgent.role,
      agentName: targetAgent.name,
      destinationWallet: masterWallet.address,
      amountUsdt,
      network,
      txHash: txHash || "manual-admin",
      kind: "income",
      status: "confirmed",
    })
    .returning();

  const proof = txHash ? `هش: ${txHash}` : "ثبت دستی مدیر (بدون هش)";
  const reportText =
    `✅ ثبت درآمد واقعی\n` +
    `• ایجنت: ${targetAgent.name}\n` +
    `• مبلغ: +${amountUsdt} USDT\n` +
    `• مدرک: ${proof}\n` +
    `• مقصد برداشت: ${masterWallet.address} (${masterWallet.network})`;

  await db.insert(agentLogs).values({
    agent: targetAgent.name,
    action: `ثبت درآمد واقعی +${amountUsdt} USDT`,
    status: "success",
    detail: `${title} • ${proof}`,
    durationMs: 0,
  });

  return NextResponse.json({
    ok: true,
    agent: updatedAgent,
    transaction: tx,
    masterWallet,
    amountUsdt,
    report: reportText,
  });
}
