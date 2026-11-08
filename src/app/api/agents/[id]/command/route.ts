import { normalizeProtectedTrade, protectedTradeErrors } from "@/lib/protected-trade-contract";
import { fetchTabdealMarketRules } from "@/lib/exchange";
import { validateTabdealLimitBuy } from "@/lib/tabdeal-market";
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
import { preflightJobKind } from "@/lib/job-preflight";

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
      const ex = await exchangeStatus();
      // خواندن موجودی فقط به کلید نیاز دارد، نه به فلگ معامله؛
      // پس گزارش واقعی بازار حتی وقتی ارسال سفارش قفل است کامل می‌شود.
      if (ex.keysConfigured) {
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
      const errors = protectedTradeErrors(body);
      if (errors.length) return NextResponse.json({ ok:false, error:errors.join("؛ "), errors },{status:400});
      const payload = normalizeProtectedTrade(body);
      try {
        const rules = await fetchTabdealMarketRules(payload.symbol);
        validateTabdealLimitBuy({quantity:payload.quantity,price:payload.price,budget:payload.budgetUsdt,
          stopPrice:payload.stopLoss,targetPrice:payload.takeProfit,rules});
      } catch (error) {
        const code = error instanceof Error && /^[a-z_]{1,80}$/.test(error.message) ? error.message : "market_validation_unavailable";
        return NextResponse.json({ok:false,error:"درخواست ثبت نشد؛ بررسی حداقل مبلغ، گام مقدار و قیمت بازار ناموفق بود.",code},{status:422});
      }

      // پیش‌بررسی: اگر کلید صرافی/قفل معامله آماده نیست، همان‌جا با
      // پیام شفاف برگرد تا کار بی‌فایده در صف ساخته نشود.
      const exchange = await exchangeStatus();
      const preflight = await preflightJobKind(
        "trade",
        payload,
        { exchange },
      );

      const { job, telegram } = await createJob({
        agentId: agent.id,
        agentName: agent.name,
        kind: "trade",
        title: `خرید نقدی LIMIT ${payload.symbol} — سقف بودجه ${payload.budgetUsdt} USDT`,
        detail:
          "ثبت درخواست به معنی ارسال سفارش نیست. اجرا فقط پس از رفع موانع و تأیید مجدد شما ممکن است. حد سود و ضرر نرم‌افزاری هستند؛ قیمت خروج تضمین نمی‌شود.",
        payload,
        risk: "high",
        requiresApproval: true,
      });

      return NextResponse.json({
        ok: true,
        job,
        telegram,
        ready: preflight.ready,
        blockers: preflight.blockers,
        message: preflight.ready
          ? telegram.ok
            ? "درخواست در تلگرام برای تأیید ارسال شد."
            : "درخواست در صف تأیید پنل ثبت شد (تلگرام پیکربندی نشده)."
          : `درخواست ثبت شد اما هنوز آماده اجرا نیست: ${preflight.reason} — پس از رفع، دکمه «تلاش دوباره» را بزنید.`,
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
