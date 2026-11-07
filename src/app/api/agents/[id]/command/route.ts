import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { agents, agentActivityLogs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { actorOf, guardAdmin } from "@/lib/auth";
import { createJob } from "@/lib/jobs";
import { refreshMarket } from "@/lib/market";
import { exchangeStatus, getAccountBalances } from "@/lib/exchange";
import { recordAgentError } from "@/lib/agent-execution";
import { ConfigError } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * دستورهای مدیرعامل به یک کارمند.
 * همه‌ی دستورها واقعی هستند: یا کار در صف تأیید می‌گذارند، یا داده‌ی
 * واقعی صرافی/بازار را می‌خوانند. هیچ پاداشی اینجا ساخته نمی‌شود.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const denied = guardAdmin(req);
  if (denied) return denied;

  const { id } = await ctx.params;
  const agentId = Number(id);
  const body = await req.json().catch(() => ({}));
  const action = String(body?.action || "");
  const actor = actorOf(req);

  const rows = await db
    .select()
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);
  const agent = rows[0];
  if (!agent)
    return NextResponse.json({ error: "کارمند پیدا نشد" }, { status: 404 });

  switch (action) {
    // ── ۱) اسکن واقعی بازار + موجودی صرافی ──────────────────────────────
    case "market_scan": {
      const started = Date.now();
      const market = await refreshMarket();
      let account: Awaited<ReturnType<typeof getAccountBalances>> | null = null;
      let accountError: string | null = null;
      const ex = exchangeStatus();
      if (ex.keysConfigured && ex.tradingEnabled) {
        try {
          account = await getAccountBalances(["USDT"]);
        } catch (e: any) {
          accountError = e?.message || "account read failed";
        }
      }

      const pricesText = market.ok
        ? market.quotes.map((q) => `${q.symbol}=${q.price}`).join(" • ")
        : `خطا: ${market.error}`;

      await db.insert(agentActivityLogs).values({
        agentId: agent.id,
        agentName: agent.name,
        action: "اسکن واقعی بازار انجام شد",
        status: market.ok ? "success" : "failed",
        detail: `${pricesText}${account ? ` • موجودی USDT: ${account.balances[0]?.total ?? 0}` : ""}${
          accountError ? ` • خطای حساب: ${accountError}` : ""
        }`,
        source: "panel",
        meta: {
          actor,
          durationMs: Date.now() - started,
          prices: market.ok ? market.quotes : null,
        },
      });
      if (!market.ok) {
        await recordAgentError({
          agentName: agent.name,
          action: "اسکن بازار ناموفق",
          detail: market.error || "unknown",
          source: "panel",
        });
      }
      await db
        .update(agents)
        .set({ currentFocus: "اسکن بازار", lastActiveAt: new Date() })
        .where(eq(agents.id, agent.id));

      return NextResponse.json({
        ok: market.ok,
        market,
        account,
        accountError,
        message: market.ok
          ? "اسکن واقعی انجام شد و در دفتر کارمند ثبت گردید."
          : `اسکن ناموفق بود: ${market.error}`,
      });
    }

    // ── ۲) درخواست معامله واقعی (نیازمند تأیید مدیرعامل) ────────────────
    case "request_trade": {
      const symbol = String(body?.symbol || "BTCUSDT").toUpperCase();
      const side =
        String(body?.side || "BUY").toUpperCase() === "SELL" ? "SELL" : "BUY";
      const quoteOrderQty = Number(body?.quoteOrderQty || 0);
      const quantity = Number(body?.quantity || 0);
      if (!quoteOrderQty && !quantity) {
        return NextResponse.json(
          { error: "مقدار سفارش (quoteOrderQty یا quantity) لازم است" },
          { status: 400 },
        );
      }

      const { job, telegram } = await createJob({
        agentId: agent.id,
        agentName: agent.name,
        kind: "trade",
        title: `سفارش ${side} ${symbol}${quoteOrderQty ? ` به ارزش ${quoteOrderQty} USDT` : ` — مقدار ${quantity}`}`,
        detail:
          "این سفارش پس از تأیید شما به‌صورت واقعی به صرافی ارسال می‌شود. سود/زیان فقط پس از بسته‌شدن پوزیشن قابل ثبت است.",
        payload: { symbol, side, type: "MARKET", quoteOrderQty, quantity },
        risk: "high",
        requiresApproval: true,
      });

      return NextResponse.json({
        ok: true,
        job,
        telegram,
        message: telegram.ok
          ? "درخواست در تلگرام برای تأیید ارسال شد."
          : "درخواست در صف تأیید پنل ثبت شد (تلگرام پیکربندی نشده).",
      });
    }

    // ── ۳) اجرای ابزار واقعی از طریق ورکر ────────────────────────────────
    case "tool_run": {
      const { job, telegram } = await createJob({
        agentId: agent.id,
        agentName: agent.name,
        kind: "tool_run",
        title: `اجرای ابزار «${body?.tool || "ابزار"}»`,
        detail:
          "این کار به ورکر واقعی (AGENT_WORKER_URL) ارسال می‌شود و خروجی واقعی ثبت می‌گردد.",
        payload: { tool: body?.tool, input: body?.input },
        risk: "low",
        requiresApproval: false,
      });
      return NextResponse.json({ ok: true, job, telegram });
    }

    // ── ۴) فعال/متوقف کردن کارمند ───────────────────────────────────────
    case "toggle": {
      const next = agent.status === "active" ? "paused" : "active";
      const [updated] = await db
        .update(agents)
        .set({ status: next, lastActiveAt: new Date() })
        .where(eq(agents.id, agent.id))
        .returning();
      await db.insert(agentActivityLogs).values({
        agentId: agent.id,
        agentName: agent.name,
        action: next === "active" ? "کارمند فعال شد" : "کارمند متوقف شد",
        status: "success",
        detail: `توسط ${actor}`,
        source: "panel",
      });
      return NextResponse.json({ ok: true, agent: updated });
    }

    // ── ۵) تعیین کار در جریان (Focus) ───────────────────────────────────
    case "set_focus": {
      const focus = String(body?.focus || "").slice(0, 300);
      const [updated] = await db
        .update(agents)
        .set({ currentFocus: focus })
        .where(eq(agents.id, agent.id))
        .returning();
      await db.insert(agentActivityLogs).values({
        agentId: agent.id,
        agentName: agent.name,
        action: "کار در جریان به‌روزرسانی شد",
        status: "success",
        detail: focus || "—",
        source: "panel",
      });
      return NextResponse.json({ ok: true, agent: updated });
    }

    default:
      return NextResponse.json(
        {
          error: "دستور نامعتبر است",
          allowed: [
            "market_scan",
            "request_trade",
            "tool_run",
            "toggle",
            "set_focus",
          ],
        },
        { status: 400 },
      );
  }
}
