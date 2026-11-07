"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import RoomScene from "@/components/RoomScene";
import { themeFor, statusInfo, relativeTime } from "@/lib/office-theme";

const fa = (n: any) =>
  Number(n || 0).toLocaleString("fa-IR", { maximumFractionDigits: 2 });
const dt = (d: any) =>
  d ? new Date(d).toLocaleString("fa-IR", { dateStyle: "short", timeStyle: "short" }) : "—";

type Job = {
  id: number;
  kind: string;
  title: string;
  detail: string;
  status: string;
  risk: string;
  error: string;
  result: any;
  createdAt: string;
  telegramMessageId: number | null;
};

type Activity = {
  id: number;
  action: string;
  status: string;
  detail: string;
  rewardUsdt: number;
  source: string;
  createdAt: string;
};

const JOB_STATUS: Record<string, [string, string]> = {
  queued: ["در صف", "bg-slate-500/15 text-slate-300 border-slate-400/30"],
  awaiting_approval: ["منتظر تأیید", "bg-amber-500/15 text-amber-300 border-amber-400/30"],
  approved: ["تأییدشده", "bg-sky-500/15 text-sky-300 border-sky-400/30"],
  running: ["در حال اجرا", "bg-cyan-500/15 text-cyan-300 border-cyan-400/30"],
  succeeded: ["موفق", "bg-emerald-500/15 text-emerald-300 border-emerald-400/30"],
  failed: ["ناموفق", "bg-red-500/15 text-red-300 border-red-400/30"],
  rejected: ["رد شده", "bg-slate-500/15 text-slate-300 border-slate-400/30"],
  expired: ["منقضی", "bg-slate-500/15 text-slate-400 border-slate-400/30"],
  needs_config: ["نیازمند تنظیمات", "bg-orange-500/15 text-orange-300 border-orange-400/30"],
};

export default function OfficeClient({ agentId }: { agentId: number }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"activity" | "jobs" | "income" | "report">("activity");
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState<string>("");
  const [report, setReport] = useState<{ text: string; source: string; warning?: string } | null>(null);
  const [tradeOpen, setTradeOpen] = useState(false);
  const [trade, setTrade] = useState({ symbol: "BTCUSDT", side: "BUY", quoteOrderQty: "20" });

  const notify = (t: string) => {
    setToast(t);
    setTimeout(() => setToast(""), 4500);
  };

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/agents/${agentId}/office`, { cache: "no-store" });
      if (res.status === 404) {
        setError("این کارمند پیدا نشد.");
        setLoading(false);
        return;
      }
      const d = await res.json();
      setData(d);
      setError("");
    } catch (e: any) {
      setError(e?.message || "خطا در دریافت اطلاعات دفتر");
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    let iv: ReturnType<typeof setInterval> | null = null;
    fetch("/api/auth/login")
      .then((r) => r.json())
      .then((d) => {
        if (!d.user) {
          location.href = "/login";
          return;
        }
        load();
        iv = setInterval(load, 15000);
      })
      .catch(() => {
        location.href = "/login";
      });
    return () => {
      if (iv) clearInterval(iv);
    };
  }, [load]);

  async function command(action: string, extra: Record<string, unknown> = {}, label = "") {
    setBusy(action + (extra.symbol || ""));
    try {
      const res = await fetch(`/api/agents/${agentId}/command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const d = await res.json();
      notify(d.message || d.error || label || "انجام شد");
      if (!res.ok && d.error) notify(`⚠️ ${d.error}`);
      if (action === "market_scan" && d.market?.ok) {
        notify(`اسکن واقعی انجام شد: ${d.market.quotes.map((q: any) => `${q.symbol} ${q.price}`).join(" • ")}`);
      }
      await load();
    } finally {
      setBusy("");
    }
  }

  async function askReport(sendToTelegram = true) {
    setBusy("report");
    try {
      const res = await fetch(`/api/agents/${agentId}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sendToTelegram, useAi: true }),
      });
      const d = await res.json();
      if (!res.ok) {
        notify(`⚠️ ${d.error || "تولید گزارش ناموفق بود"}`);
        return;
      }
      setReport({ text: d.report, source: d.source, warning: d.warning });
      setTab("report");
      if (d.telegram?.sent) notify("گزارش ساخته و به تلگرام ارسال شد ✅");
      else if (sendToTelegram)
        notify(`گزارش ساخته شد — ارسال تلگرام انجام نشد: ${d.telegram?.reason || "نامشخص"}`);
      else notify("گزارش از داده واقعی ساخته شد ✅");
      await load();
    } finally {
      setBusy("");
    }
  }

  async function jobAction(id: number, action: "approve" | "reject" | "retry") {
    setBusy(`job-${id}-${action}`);
    try {
      const res = await fetch("/api/jobs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      const d = await res.json();
      if (d.ok) {
        const exec = d.execution;
        notify(
          action === "reject"
            ? "کار رد شد ❌"
            : action === "retry"
            ? "تلاش دوباره انجام شد 🔄"
            : exec?.ok
            ? `کار با موفقیت اجرا شد ✅`
            : `اجرا انجام نشد: ${exec?.error || d.error || "خطا"}`
        );
      } else {
        notify(`⚠️ ${d.error || "عملیات انجام نشد"}`);
      }
      await load();
    } finally {
      setBusy("");
    }
  }

  if (loading) {
    return (
      <main dir="rtl" className="grid min-h-screen place-items-center bg-[#070C16] text-white">
        <div className="text-center">
          <div className="text-5xl animate-bounce">🏢</div>
          <p className="mt-3 text-sm text-slate-300">در حال باز کردن دفتر کارمند…</p>
        </div>
      </main>
    );
  }

  if (error || !data?.agent) {
    return (
      <main dir="rtl" className="grid min-h-screen place-items-center bg-[#070C16] px-6 text-white">
        <div className="max-w-md rounded-3xl border border-white/10 bg-white/5 p-8 text-center">
          <div className="text-5xl">🚪</div>
          <h1 className="mt-3 text-xl font-black">دفتر پیدا نشد</h1>
          <p className="mt-2 text-sm text-slate-400">{error || "کارمند حذف شده است."}</p>
          <Link href="/control" className="mt-5 inline-block rounded-xl bg-emerald-500 px-5 py-2.5 font-bold text-black">
            بازگشت به ساختمان ←
          </Link>
        </div>
      </main>
    );
  }

  const { agent, goal, today, income, activity, jobs, transactions, wallet, market, infra } = data;
  const theme = themeFor(agent.specialty);
  const status = statusInfo(agent.status);
  const pendingJobs = (jobs as Job[]).filter((j) => ["awaiting_approval", "queued", "approved", "running"].includes(j.status));
  const awaiting = (jobs as Job[]).filter((j) => j.status === "awaiting_approval");
  const failed = (activity as Activity[]).filter((a) => a.status === "failed");
  const marketLine = market?.entries?.length
    ? market.entries.map((e: any) => `${e.symbol.replace("USDT", "")} ${fa(e.price)}`).join(" · ")
    : "";

  const kpis = [
    { label: "درآمد امروز", value: `${fa(today.earnedUsdt)}`, unit: "USDT", tone: "text-emerald-300" },
    { label: "درآمد تجمیعی", value: `${fa(agent.earnedUsdt)}`, unit: "USDT", tone: "text-emerald-200" },
    { label: "اجراهای موفق", value: `${fa(agent.successCount)}`, unit: "بار", tone: "text-cyan-300" },
    { label: "خطاهای ثبت‌شده", value: `${fa(failed.length || agent.errorCount)}`, unit: "مورد", tone: failed.length ? "text-red-300" : "text-slate-300" },
    { label: "کارهای منتظر تأیید", value: `${fa(awaiting.length)}`, unit: "کار", tone: awaiting.length ? "text-amber-300" : "text-slate-300" },
    { label: "در انتظار تأیید واریز", value: `${fa(income.pending)}`, unit: "USDT", tone: income.pending ? "text-amber-300" : "text-slate-300" },
  ];

  return (
    <main dir="rtl" className="min-h-screen bg-[#070C16] pb-16 text-white">
      {/* ── نوار بالا ───────────────────────────────────────── */}
      <div className="sticky top-0 z-30 border-b border-white/10 bg-[#070C16]/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-7">
          <div className="flex items-center gap-3">
            <Link
              href="/control"
              className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs font-bold text-slate-200 transition hover:bg-white/10"
            >
              ← ساختمان مرکزی
            </Link>
            <div className="hidden h-8 w-px bg-white/15 sm:block" />
            <div className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${status.dot} ${agent.status === "active" ? "live-dot" : ""}`} />
              <div>
                <p className="text-sm font-black leading-tight">{agent.name}</p>
                <p className="text-[10px] text-slate-400">
                  {agent.department || theme.label} • اتاق {agent.officeRoom || "—"} • طبقه {agent.officeFloor}
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => askReport(true)}
              disabled={busy === "report"}
              className="rounded-xl bg-emerald-500 px-3 py-2 text-xs font-black text-black transition hover:bg-emerald-400 disabled:opacity-50"
            >
              {busy === "report" ? "⏳ در حال ساخت…" : "📋 گزارش وضعیت"}
            </button>
            <button
              onClick={() => command("market_scan", {}, "اسکن انجام شد")}
              disabled={busy === "market_scan"}
              className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs font-bold transition hover:bg-white/10 disabled:opacity-50"
            >
              {busy === "market_scan" ? "⏳ اسکن بازار…" : "📡 اسکن واقعی بازار"}
            </button>
            <button
              onClick={() => setTradeOpen((v) => !v)}
              className="rounded-xl border border-amber-400/30 bg-amber-500/15 px-3 py-2 text-xs font-bold text-amber-200 transition hover:bg-amber-500/25"
            >
              🪙 درخواست معامله
            </button>
            <button
              onClick={() => command("toggle", {}, "وضعیت تغییر کرد")}
              className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs font-bold transition hover:bg-white/10"
            >
              {agent.status === "active" ? "⏸ توقف کارمند" : "▶️ فعال‌سازی"}
            </button>
          </div>
        </div>

        {/* فرم معامله */}
        {tradeOpen && (
          <div className="border-t border-white/10 bg-[#0B1220]">
            <div className="mx-auto flex max-w-7xl flex-wrap items-end gap-3 px-4 py-3 md:px-7">
              <div>
                <label className="block text-[10px] text-slate-400">نماد</label>
                <select
                  value={trade.symbol}
                  onChange={(e) => setTrade({ ...trade, symbol: e.target.value })}
                  className="mt-1 rounded-lg border border-white/15 bg-white/5 px-2 py-1.5 text-xs"
                >
                  {["BTCUSDT", "ETHUSDT", "TONUSDT"].map((s) => (
                    <option key={s} value={s} className="text-black">
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] text-slate-400">جهت</label>
                <select
                  value={trade.side}
                  onChange={(e) => setTrade({ ...trade, side: e.target.value })}
                  className="mt-1 rounded-lg border border-white/15 bg-white/5 px-2 py-1.5 text-xs"
                >
                  <option value="BUY" className="text-black">خرید (BUY)</option>
                  <option value="SELL" className="text-black">فروش (SELL)</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] text-slate-400">مبلغ (USDT)</label>
                <input
                  value={trade.quoteOrderQty}
                  onChange={(e) => setTrade({ ...trade, quoteOrderQty: e.target.value })}
                  dir="ltr"
                  className="mt-1 w-28 rounded-lg border border-white/15 bg-white/5 px-2 py-1.5 text-xs"
                />
              </div>
              <button
                onClick={() =>
                  command(
                    "request_trade",
                    { symbol: trade.symbol, side: trade.side, quoteOrderQty: Number(trade.quoteOrderQty) },
                    "درخواست معامله ثبت شد"
                  )
                }
                className="rounded-lg bg-amber-400 px-3 py-2 text-xs font-black text-black"
              >
                ارسال برای تأیید مدیرعامل
              </button>
              <p className="text-[10px] leading-5 text-slate-400">
                سفارش تا تأیید شما در تلگرام یا پنل ارسال نمی‌شود. با تأیید، سفارش واقعی به صرافی می‌رود.
                {!infra.exchange.keysConfigured && " ⚠️ کلید API صرافی ست نشده است."}
                {!infra.exchange.tradingEnabled && " ⚠️ AGENT_TRADING_ENABLED=false است."}
              </p>
              {!infra.exchange?.canExecuteOrders && (
                <div className="w-full rounded-xl border border-orange-400/30 bg-orange-500/10 p-2">
                  <p className="text-[10px] font-black text-orange-300">
                    🔒 اجرای واقعی آماده نیست — این سفارش فقط «درخواست» ثبت می‌شود و دکمه تأیید آن قفل می‌ماند.
                  </p>
                  <ul className="mt-1 space-y-1">
                    {(infra.exchange?.blockers || []).map((b: any) => (
                      <li key={b.code} className="text-[9px] leading-4 text-orange-200/90">
                        • {b.label}
                        <span className="block text-orange-200/60">↳ {b.action}</span>
                      </li>
                    ))}
                  </ul>
                  <a href="/control" className="mt-1 inline-block text-[9px] font-bold text-amber-300 underline">
                    رفتن به پنل صرافی و روشن‌کردن کار واقعی ←
                  </a>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="mx-auto max-w-7xl px-4 pt-5 md:px-7">
        {/* ── صحنه دفتر + هدف ─────────────────────────────── */}
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <RoomScene
              agent={agent}
              activities={activity}
              goalProgress={goal.progress}
              todayEarned={today.earnedUsdt}
              marketLine={marketLine}
            />
          </div>

          <div className="space-y-3">
            <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-white/10 to-white/[0.03] p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-black">🎯 هدف و مأموریت</h2>
                <span className="rounded-full border border-white/15 px-2 py-0.5 text-[9px] text-slate-300">
                  {agent.goalTitle ? "فعال" : "تعیین نشده"}
                </span>
              </div>
              <p className="mt-2 text-xs leading-6 text-slate-200">
                {agent.goalTitle || "برای این کارمند هدفی ثبت نشده است."}
              </p>
              {goal.progress !== null && (
                <div className="mt-3">
                  <div className="h-2.5 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${goal.progress}%`, background: `linear-gradient(90deg,${theme.accentHex},#34d399)` }}
                    />
                  </div>
                  <div className="mt-1 flex justify-between text-[10px] text-slate-400">
                    <span>{fa(agent.earnedUsdt)} از {fa(goal.targetUsdt)} USDT</span>
                    <span>{fa(goal.progress)}٪</span>
                  </div>
                </div>
              )}
              <div className="mt-3 rounded-xl bg-black/25 p-2.5 ring-1 ring-white/5">
                <p className="text-[10px] text-slate-400">استراتژی</p>
                <p className="mt-1 text-[11px] leading-5 text-slate-300">{agent.strategy || "—"}</p>
              </div>
              <div className="mt-2 flex items-center justify-between rounded-xl bg-black/25 p-2.5 ring-1 ring-white/5">
                <div>
                  <p className="text-[10px] text-slate-400">کار در جریان</p>
                  <p className="mt-0.5 text-[11px] text-slate-200">{agent.currentFocus || "—"}</p>
                </div>
              </div>
              <button
                onClick={async () => {
                  const focus = prompt("کار در جریان این کارمند را وارد کنید:", agent.currentFocus || "");
                  if (focus !== null) await command("set_focus", { focus }, "ثبت شد");
                }}
                className="mt-2 w-full rounded-xl border border-white/15 bg-white/5 py-2 text-[11px] font-bold hover:bg-white/10"
              >
                ✏️ به‌روزرسانی کار در جریان
              </button>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
              <h3 className="text-sm font-black">🏦 مقصد واریز</h3>
              <p className="mt-2 break-all font-mono text-[10px] text-emerald-300" dir="ltr">
                {wallet.address || "آدرس کیف پول واحد ست نشده است"}
              </p>
              <p className="mt-1 text-[10px] text-slate-400">{wallet.network}</p>
              <div className="mt-3 grid grid-cols-2 gap-2 text-center">
                <div className="rounded-xl bg-black/25 p-2">
                  <p className="text-[9px] text-slate-400">تأییدشده</p>
                  <p className="text-sm font-black text-emerald-300">{fa(income.confirmed)}</p>
                </div>
                <div className="rounded-xl bg-black/25 p-2">
                  <p className="text-[9px] text-slate-400">در انتظار تأیید</p>
                  <p className={`text-sm font-black ${income.pending ? "text-amber-300" : "text-slate-300"}`}>
                    {fa(income.pending)}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── KPIها ─────────────────────────────────────────── */}
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {kpis.map((k) => (
            <div key={k.label} className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
              <p className="text-[10px] text-slate-400">{k.label}</p>
              <p className={`mt-1 text-lg font-black ${k.tone}`}>
                {k.value}
                <span className="mr-1 text-[9px] font-normal text-slate-500">{k.unit}</span>
              </p>
            </div>
          ))}
        </div>

        {/* ── تب‌ها ────────────────────────────────────────── */}
        <div className="mt-5 flex flex-wrap gap-2">
          {[
            ["activity", `🧾 فعالیت زنده (${activity.length})`],
            ["jobs", `🗂 صف کار و تأییدها (${pendingJobs.length})`],
            ["income", `💰 درآمد و تراکنش‌ها (${transactions.length})`],
            ["report", "📋 گزارش وضعیت"],
          ].map(([k, l]) => (
            <button
              key={k}
              onClick={() => setTab(k as any)}
              className={`rounded-full border px-4 py-2 text-xs font-bold transition ${
                tab === k
                  ? "border-emerald-400/40 bg-emerald-500/20 text-emerald-200"
                  : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
              }`}
            >
              {l}
            </button>
          ))}
        </div>

        <div className="mt-3 rounded-3xl border border-white/10 bg-white/[0.03] p-4">
          {/* فعالیت */}
          {tab === "activity" && (
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-black">🧾 لاگ اجرایی واقعی کارمند</h3>
                <span className="text-[10px] text-slate-400">
                  هر ردیف از رویداد واقعی دیتابیس خوانده می‌شود (جدول agent_activity_logs)
                </span>
              </div>
              {activity.length === 0 ? (
                <p className="mt-4 rounded-2xl border border-dashed border-white/10 p-6 text-center text-xs text-slate-400">
                  هنوز هیچ فعالیت واقعی ثبت نشده است. با «اسکن واقعی بازار» یا تأیید یک واریز، اولین لاگ ساخته می‌شود.
                </p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {(activity as Activity[]).map((a) => (
                    <li key={a.id} className="rounded-2xl border border-white/5 bg-black/20 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span
                            className={`h-2 w-2 rounded-full ${
                              a.status === "success"
                                ? "bg-emerald-400"
                                : a.status === "failed"
                                ? "bg-red-400"
                                : a.status === "pending"
                                ? "bg-amber-400"
                                : "bg-slate-400"
                            }`}
                          />
                          <p className="text-xs font-bold text-slate-100">{a.action}</p>
                          {Number(a.rewardUsdt) > 0 && (
                            <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-black text-emerald-300">
                              +{fa(a.rewardUsdt)} USDT
                            </span>
                          )}
                        </div>
                        <span className="text-[9px] text-slate-500">
                          {dt(a.createdAt)} • {a.source}
                        </span>
                      </div>
                      {a.detail && (
                        <p className="mt-1 whitespace-pre-line text-[10px] leading-5 text-slate-400">{a.detail}</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* صف کار */}
          {tab === "jobs" && (
            <div>
              <h3 className="text-sm font-black">🗂 صف کار و تأییدهای انسانی</h3>
              {jobs.length === 0 ? (
                <p className="mt-4 rounded-2xl border border-dashed border-white/10 p-6 text-center text-xs text-slate-400">
                  هیچ کاری در صف نیست. از دکمه «درخواست معامله» یک کار واقعی بسازید.
                </p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {(jobs as Job[]).map((j) => {
                    const st = JOB_STATUS[j.status] || ["—", "bg-white/5 text-slate-300 border-white/10"];
                    return (
                      <li key={j.id} className="rounded-2xl border border-white/5 bg-black/20 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded bg-white/10 px-1.5 py-0.5 text-[9px] text-slate-300">#{j.id}</span>
                            <span className="text-xs font-bold">{j.title}</span>
                            <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold ${st[1]}`}>{st[0]}</span>
                            <span className="rounded bg-white/5 px-1.5 py-0.5 text-[9px] text-slate-400">{j.kind}</span>
                            {j.telegramMessageId && <span className="text-[9px] text-sky-300">📩 تلگرام</span>}
                          </div>
                          <span className="text-[9px] text-slate-500">{dt(j.createdAt)}</span>
                        </div>
                        {j.detail && <p className="mt-1 whitespace-pre-line text-[10px] leading-5 text-slate-400">{j.detail}</p>}
                        {j.error && (
                          <p className="mt-1 rounded-lg bg-red-500/10 p-2 text-[10px] text-red-300">
                            ⛔ {j.error}
                          </p>
                        )}
                        {j.result && (
                          <pre className="mt-1 max-h-32 overflow-auto rounded-lg bg-black/40 p-2 text-[9px] text-emerald-200" dir="ltr">
                            {JSON.stringify(j.result, null, 1)}
                          </pre>
                        )}
                        {(j as any).preflight?.blockers?.length > 0 && (
                          <div className="mt-1 rounded-lg border border-orange-400/30 bg-orange-500/10 p-2">
                            <p className="text-[10px] font-black text-orange-300">🔒 آماده اجرا نیست: دکمه تأیید قفل است</p>
                            <ul className="mt-1 space-y-1">
                              {(j as any).preflight.blockers.map((b: any) => (
                                <li key={b.code} className="text-[9px] leading-4 text-orange-200/90">
                                  • {b.label}
                                  {b.action ? <span className="block text-orange-200/60">↳ {b.action}</span> : null}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {j.status === "awaiting_approval" && (
                          <div className="mt-2 flex gap-2">
                            <button
                              onClick={() => jobAction(j.id, "approve")}
                              disabled={busy === `job-${j.id}-approve` || (j as any).canApprove === false}
                              title={(j as any).canApprove === false ? (j as any).preflight?.reason || "این کار آماده اجرا نیست" : ""}
                              className="rounded-lg bg-emerald-500 px-3 py-1.5 text-[11px] font-black text-black disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {(j as any).canApprove === false ? "🔒 تأیید قفل است" : "✅ تأیید و اجرا"}
                            </button>
                            <button
                              onClick={() => jobAction(j.id, "reject")}
                              disabled={busy === `job-${j.id}-reject`}
                              className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-1.5 text-[11px] font-bold text-red-300 disabled:opacity-50"
                            >
                              ❌ رد
                            </button>
                          </div>
                        )}
                        {j.status === "queued" && (
                          <button
                            onClick={() => jobAction(j.id, "approve")}
                            className="mt-2 rounded-lg bg-white/10 px-3 py-1.5 text-[11px] font-bold"
                          >
                            ▶️ اجرای همین حالا
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          {/* درآمد */}
          {tab === "income" && (
            <div>
              <h3 className="text-sm font-black">💰 تراکنش‌های واقعی این کارمند</h3>
              <p className="mt-1 text-[10px] text-slate-400">
                فقط تراکنش‌های دارای هش و تأییدشده در «درآمد محقق‌شده» و هدف این کارمند حساب می‌شوند.
              </p>
              {transactions.length === 0 ? (
                <p className="mt-4 rounded-2xl border border-dashed border-white/10 p-6 text-center text-xs text-slate-400">
                  هنوز تراکنشی ثبت نشده است.
                </p>
              ) : (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[720px] text-right text-[11px]">
                    <thead className="text-[10px] text-slate-400">
                      <tr>
                        {["#", "عنوان", "مبلغ", "شبکه", "وضعیت", "هش", "تاریخ"].map((h) => (
                          <th key={h} className="border-b border-white/10 px-2 py-2 font-normal">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {transactions.map((t: any) => (
                        <tr key={t.id} className="border-b border-white/5">
                          <td className="px-2 py-2 text-slate-500">{t.id}</td>
                          <td className="px-2 py-2">{t.title}</td>
                          <td className="px-2 py-2 font-black text-emerald-300">{fa(t.amountUsdt)}</td>
                          <td className="px-2 py-2 text-slate-400">{t.network}</td>
                          <td className="px-2 py-2">
                            <span
                              className={`rounded-full px-2 py-0.5 text-[9px] ${
                                t.status === "confirmed"
                                  ? "bg-emerald-500/15 text-emerald-300"
                                  : "bg-amber-500/15 text-amber-300"
                              }`}
                            >
                              {t.status === "confirmed" ? "تأییدشده" : "در انتظار تأیید"}
                            </span>
                          </td>
                          <td className="max-w-[160px] truncate px-2 py-2 font-mono text-[9px] text-slate-400" dir="ltr">
                            {t.txHash || "—"}
                          </td>
                          <td className="px-2 py-2 text-[9px] text-slate-500">{dt(t.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* گزارش */}
          {tab === "report" && (
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-black">📋 گزارش وضعیت کارمند</h3>
                <div className="flex gap-2">
                  <button
                    onClick={() => askReport(false)}
                    disabled={busy === "report"}
                    className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] font-bold disabled:opacity-50"
                  >
                    ساخت گزارش (بدون تلگرام)
                  </button>
                  <button
                    onClick={() => askReport(true)}
                    disabled={busy === "report"}
                    className="rounded-lg bg-sky-500 px-3 py-1.5 text-[11px] font-black text-black disabled:opacity-50"
                  >
                    ارسال به تلگرام
                  </button>
                </div>
              </div>
              {report ? (
                <>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px]">
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-slate-300">
                      منبع: {report.source === "gemini" ? "Gemini + دیتابیس واقعی" : "قالب دیتابیسی"}
                    </span>
                    {report.warning && (
                      <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-300">
                        هشدار: {report.warning}
                      </span>
                    )}
                  </div>
                  <pre className="mt-2 whitespace-pre-wrap rounded-2xl border border-white/10 bg-black/40 p-4 text-[11px] leading-6 text-slate-200">
                    {report.text}
                  </pre>
                </>
              ) : (
                <p className="mt-4 rounded-2xl border border-dashed border-white/10 p-6 text-center text-xs text-slate-400">
                  دکمه «گزارش وضعیت» را بزنید تا از داده‌های واقعی همین دفتر، گزارش ساخته شود.
                  {infra.gemini ? " (Gemini فعال است و متن را بازنویسی می‌کند)" : " (بدون Gemini: قالب دیتابیسی)"}
                </p>
              )}
            </div>
          )}
        </div>

        {/* ── زیرساخت + خطاها ─────────────────────────────── */}
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
            <h3 className="text-sm font-black">🔌 وضعیت زیرساخت واقعی</h3>
            <ul className="mt-2 space-y-2 text-[11px]">
              <li className="flex items-center justify-between rounded-xl bg-black/20 px-3 py-2">
                <span className="text-slate-300">صرافی</span>
                <span className={infra.exchange.keysConfigured ? "text-emerald-300" : "text-amber-300"}>
                  {infra.exchange.mode}
                </span>
              </li>
              <li className="flex items-center justify-between rounded-xl bg-black/20 px-3 py-2">
                <span className="text-slate-300">معامله واقعی</span>
                <span className={infra.exchange.tradingEnabled ? "text-emerald-300" : "text-red-300"}>
                  {infra.exchange.tradingEnabled ? "فعال" : "قفل (AGENT_TRADING_ENABLED=false)"}
                </span>
              </li>
              <li className="flex items-center justify-between rounded-xl bg-black/20 px-3 py-2">
                <span className="text-slate-300">تلگرام</span>
                <span className={infra.telegram.configured ? "text-emerald-300" : "text-amber-300"}>
                  {infra.telegram.configured ? "متصل" : "تنظیم نشده"}
                </span>
              </li>
              <li className="flex items-center justify-between rounded-xl bg-black/20 px-3 py-2">
                <span className="text-slate-300">ورکر ابزارها</span>
                <span className={infra.worker ? "text-emerald-300" : "text-slate-400"}>
                  {infra.worker ? "متصل" : "تنظیم نشده"}
                </span>
              </li>
              <li className="flex items-center justify-between rounded-xl bg-black/20 px-3 py-2">
                <span className="text-slate-300">Gemini</span>
                <span className={infra.gemini ? "text-emerald-300" : "text-slate-400"}>
                  {infra.gemini ? "فعال" : "غیرفعال"}
                </span>
              </li>
            </ul>
            <Link
              href="/control/system"
              className="mt-3 block rounded-xl border border-white/15 bg-white/5 py-2 text-center text-[11px] font-bold hover:bg-white/10"
            >
              🩺 چک‌لیست دیباگ و لاگ‌های سیستم ←
            </Link>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
            <h3 className="text-sm font-black">🧠 گزارش خطاهای ثبت‌شده</h3>
            {failed.length === 0 ? (
              <p className="mt-4 rounded-2xl border border-dashed border-white/10 p-6 text-center text-xs text-slate-400">
                هیچ خطای واقعی برای این کارمند ثبت نشده است. ✅
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {failed.slice(0, 6).map((a) => (
                  <li key={a.id} className="rounded-xl border border-red-400/20 bg-red-500/5 p-2.5">
                    <p className="text-[11px] font-bold text-red-300">{a.action}</p>
                    <p className="mt-0.5 text-[10px] leading-5 text-slate-400">{a.detail}</p>
                    <p className="mt-1 text-[9px] text-slate-500">{dt(a.createdAt)}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-2xl border border-emerald-400/30 bg-[#0B1220] px-5 py-3 text-xs font-bold text-emerald-200 shadow-2xl">
          {toast}
        </div>
      )}
    </main>
  );
}
