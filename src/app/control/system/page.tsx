"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

const fa = (n: any) => Number(n || 0).toLocaleString("fa-IR");
const dt = (d: any) =>
  d ? new Date(d).toLocaleString("fa-IR", { dateStyle: "short", timeStyle: "short" }) : "—";

const GROUPS: Array<[string, string]> = [
  ["database", "📊 دیتابیس"],
  ["auth", "🔐 احراز هویت"],
  ["wallet", "💳 کیف پول"],
  ["telegram", "📩 تلگرام"],
  ["exchange", "🏦 صرافی"],
  ["ai", "🧠 هوش مصنوعی و ورکر"],
  ["cron", "⏱ کرون"],
  ["supabase", "☁️ Supabase"],
];

export default function SystemPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState("");
  const [cronOut, setCronOut] = useState<any>(null);

  const notify = (t: string) => {
    setToast(t);
    setTimeout(() => setToast(""), 5000);
  };

  const load = useCallback(async (test = false) => {
    try {
      const res = await fetch(`/api/system/status${test ? "?test=1" : ""}`, { cache: "no-store" });
      const d = await res.json();
      setData(d);
    } catch (e: any) {
      notify(`خطا در دریافت وضعیت: ${e?.message || e}`);
    } finally {
      setLoading(false);
    }
  }, []);

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
        iv = setInterval(() => load(), 30000);
      })
      .catch(() => {
        location.href = "/login";
      });
    return () => {
      if (iv) clearInterval(iv);
    };
  }, [load]);

  async function runCron() {
    setBusy("cron");
    try {
      const res = await fetch("/api/cron/tick?job=full", { method: "POST" });
      const d = await res.json();
      setCronOut(d);
      notify(d.ok ? `کرون اجرا شد (${d.durationMs}ms)` : `کرون خطا داد: ${d.error}`);
      await load();
    } catch (e: any) {
      notify(`⚠️ ${e?.message || e}`);
    } finally {
      setBusy("");
    }
  }

  async function testExchange() {
    setBusy("exchange");
    try {
      await load(true);
      notify("تست واقعی اتصال انجام شد");
    } finally {
      setBusy("");
    }
  }

  async function setupWebhook() {
    setBusy("webhook");
    try {
      const res = await fetch("/api/telegram/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set" }),
      });
      const d = await res.json();
      notify(d.ok ? `وبهوک ثبت شد: ${d.url}` : `⚠️ ${d.telegram || d.error}`);
      await load();
    } finally {
      setBusy("");
    }
  }

  if (loading) {
    return (
      <main dir="rtl" className="grid min-h-screen place-items-center bg-[#070C16] text-white">
        <div className="text-center">
          <div className="text-5xl animate-pulse">🩺</div>
          <p className="mt-3 text-sm">در حال بررسی واقعی زیرساخت…</p>
        </div>
      </main>
    );
  }

  const env = data?.env;
  const checks = env?.checks || [];
  const db = data?.database || {};
  const missing = env?.missingRequired || [];

  return (
    <main dir="rtl" className="min-h-screen bg-[#070C16] px-4 py-6 text-white md:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link href="/control" className="text-[11px] text-slate-400 hover:text-white">
              ← بازگشت به ساختمان مرکزی
            </Link>
            <h1 className="mt-1 text-2xl font-black">🩺 مرکز دیباگ و سلامت سیستم</h1>
            <p className="mt-1 text-[11px] text-slate-400">
              همه‌چیز اینجا واقعی بررسی می‌شود: دیتابیس، صرافی، تلگرام، کرون و کلیدهای محیطی.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={runCron}
              disabled={busy === "cron"}
              className="rounded-xl bg-emerald-500 px-4 py-2 text-xs font-black text-black disabled:opacity-50"
            >
              {busy === "cron" ? "⏳" : "▶️"} اجرای دستی کرون
            </button>
            <button
              onClick={testExchange}
              disabled={busy === "exchange"}
              className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-xs font-bold disabled:opacity-50"
            >
              {busy === "exchange" ? "⏳" : "🏦"} تست اتصال صرافی
            </button>
            <button
              onClick={setupWebhook}
              disabled={busy === "webhook"}
              className="rounded-xl border border-sky-400/30 bg-sky-500/15 px-4 py-2 text-xs font-bold text-sky-200 disabled:opacity-50"
            >
              {busy === "webhook" ? "⏳" : "🔗"} ثبت وبهوک تلگرام
            </button>
          </div>
        </div>

        {/* وضعیت کلی */}
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          {[
            ["دیتابیس", db.ok ? "سالم" : "خطا", db.ok ? "text-emerald-300" : "text-red-300"],
            ["جدول‌های ناقص", `${fa(db.missingTables?.length || 0)}`, db.missingTables?.length ? "text-amber-300" : "text-emerald-300"],
            ["کلیدهای الزامی غایب", `${fa(missing.length)}`, missing.length ? "text-amber-300" : "text-emerald-300"],
            ["خطاهای ۲۴ ساعت", `${fa(data?.errors24h?.length || 0)}`, data?.errors24h?.length ? "text-red-300" : "text-emerald-300"],
          ].map(([l, v, c]) => (
            <div key={l} className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-[10px] text-slate-400">{l}</p>
              <p className={`mt-1 text-lg font-black ${c}`}>{v}</p>
            </div>
          ))}
        </div>

        {missing.length > 0 && (
          <div className="mt-3 rounded-2xl border border-amber-400/30 bg-amber-500/10 p-4 text-[11px] text-amber-200">
            ⚠️ این کلیدها در Environment Variables ست نشده‌اند: <b dir="ltr">{missing.join(", ")}</b>
            <p className="mt-1 text-amber-200/70">
              در Vercel → Project → Settings → Environment Variables مقداردهی کنید و Redeploy بزنید.
            </p>
          </div>
        )}

        {/* چک‌لیست محیط */}
        <div className="mt-4 rounded-3xl border border-white/10 bg-white/[0.03] p-5">
          <h2 className="text-sm font-black">🧾 چک‌لیست Environment Variables</h2>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            {GROUPS.map(([key, label]) => {
              const items = checks.filter((c: any) => c.group === key);
              if (!items.length) return null;
              return (
                <div key={key} className="rounded-2xl border border-white/5 bg-black/20 p-3">
                  <p className="text-[11px] font-black text-slate-200">{label}</p>
                  <ul className="mt-2 space-y-1.5">
                    {items.map((c: any) => (
                      <li key={c.key} className="rounded-xl bg-white/[0.03] px-2.5 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-[10px] text-slate-300" dir="ltr">{c.key}</span>
                          <span
                            className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold ${
                              c.present
                                ? "bg-emerald-500/15 text-emerald-300"
                                : c.required
                                ? "bg-red-500/15 text-red-300"
                                : "bg-slate-500/15 text-slate-400"
                            }`}
                          >
                            {c.present ? "ست شده" : c.required ? "الزامی — غایب" : "اختیاری"}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[9px] leading-4 text-slate-500">{c.label} — {c.purpose}</p>
                        {!c.present && <p className="mt-0.5 text-[9px] text-slate-600" dir="ltr">{c.hint}</p>}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {/* دیتابیس */}
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
            <h2 className="text-sm font-black">📊 دیتابیس Supabase</h2>
            <p className="mt-2 text-[11px] text-slate-400">
              وضعیت: {db.ok ? "اتصال برقرار است" : `خطا: ${db.error}`}
            </p>
            {db.missingTables?.length > 0 && (
              <p className="mt-2 rounded-xl bg-red-500/10 p-2 text-[10px] text-red-300">
                جدول‌های ناقص: {db.missingTables.join(", ")} — فایل supabase/schema.sql را در SQL Editor اجرا کنید.
              </p>
            )}
            <div className="mt-2 flex flex-wrap gap-1">
              {(db.tables || []).map((t: string) => (
                <span key={t} className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[9px] text-slate-400">
                  {t}
                </span>
              ))}
            </div>
          </div>

          {/* صرافی و تلگرام */}
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
            <h2 className="text-sm font-black">🏦 صرافی</h2>
            <p className="mt-2 text-[11px] leading-5 text-slate-300">{data?.exchange?.message}</p>
            <p className="mt-1 text-[10px] text-slate-500">
              حالت: {data?.exchange?.mode} • Testnet: {String(data?.exchange?.network === "testnet")}
            </p>
            {data?.exchange?.test && (
              <div className="mt-2 rounded-xl bg-black/30 p-2 text-[10px]">
                <p className="text-slate-400">تست واقعی:</p>
                <pre className="mt-1 max-h-32 overflow-auto text-emerald-300" dir="ltr">
                  {JSON.stringify(
                    {
                      price: data.exchange.test.prices?.[0]?.price ?? null,
                      priceError: data.exchange.test.priceError,
                      account: data.exchange.test.account?.balances ?? null,
                      accountError: data.exchange.test.accountError,
                    },
                    null,
                    1
                  )}
                </pre>
              </div>
            )}

            <h2 className="mt-4 text-sm font-black">📩 تلگرام</h2>
            <p className="mt-1 text-[11px] text-slate-300">
              {data?.telegram?.configured ? "ربات متصل است" : "توکن ربات ست نشده"}
            </p>
            <pre className="mt-1 max-h-32 overflow-auto rounded-xl bg-black/30 p-2 text-[9px] text-slate-300" dir="ltr">
              {JSON.stringify(data?.telegram?.webhook ?? {}, null, 1)}
            </pre>
          </div>
        </div>

        {/* کرون */}
        <div className="mt-4 rounded-3xl border border-white/10 bg-white/[0.03] p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-black">⏱ اجرای کرون</h2>
            <span className="text-[10px] text-slate-400">{data?.cron?.schedule}</span>
          </div>
          <p className="mt-1 text-[10px] text-slate-500">
            آخرین اجرا: {dt(data?.cron?.last?.finishedAt || data?.cron?.last?.startedAt)} • سکرت:{" "}
            {data?.cron?.secretConfigured ? "ست شده" : "ست نشده"}
          </p>
          {cronOut && (
            <pre className="mt-2 max-h-48 overflow-auto rounded-xl bg-black/30 p-3 text-[9px] text-emerald-200" dir="ltr">
              {JSON.stringify(cronOut, null, 1)}
            </pre>
          )}
          <ul className="mt-2 space-y-1">
            {(data?.cron?.recent || []).map((c: any) => (
              <li key={c.id} className="flex items-center justify-between rounded-xl bg-black/20 px-3 py-2 text-[10px]">
                <span>
                  <b>{c.job}</b> — {c.status} {c.durationMs ? `(${c.durationMs}ms)` : ""}
                </span>
                <span className="text-slate-500">{dt(c.finishedAt || c.startedAt)}</span>
              </li>
            ))}
            {!data?.cron?.recent?.length && <p className="text-[10px] text-slate-500">هنوز کرونی اجرا نشده است.</p>}
          </ul>
        </div>

        {/* خطاها */}
        <div className="mt-4 rounded-3xl border border-white/10 bg-white/[0.03] p-5">
          <h2 className="text-sm font-black">🚨 خطاهای واقعی ۲۴ ساعت گذشته</h2>
          {data?.errors24h?.length ? (
            <ul className="mt-2 space-y-1.5">
              {data.errors24h.map((e: any) => (
                <li key={e.id} className="rounded-xl border border-red-400/20 bg-red-500/5 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[9px] text-red-300">{e.scope}</span>
                    <span className="text-[9px] text-slate-500">{dt(e.createdAt)}</span>
                  </div>
                  <p className="mt-0.5 text-[10px] text-slate-300">{e.message}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 rounded-xl bg-emerald-500/5 p-4 text-center text-[11px] text-emerald-300">
              ✅ هیچ خطای ثبت‌شده‌ای در ۲۴ ساعت گذشته نیست.
            </p>
          )}
        </div>

        <div className="mt-4 rounded-3xl border border-white/10 bg-white/[0.03] p-5 text-[11px] leading-6 text-slate-400">
          <b className="text-slate-200">راهنمای سریع:</b> اگر وبهوک تلگرام ثبت نشد، مقدار NEXT_PUBLIC_APP_URL را روی
          دامنه‌ی Vercel بگذارید و دوباره «ثبت وبهوک» را بزنید. اگر سفارش ارسال نشد، AGENT_TRADING_ENABLED=true و کلیدهای
          صرافی را بررسی کنید. اگر واریزی «در انتظار تأیید» ماند، یعنی تأیید زنجیره‌ای فعال نیست — از صف تأیید پنل آن را
          تأیید یا رد کنید.
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-5 left-1/2 z-50 w-[92%] max-w-lg -translate-x-1/2 rounded-2xl bg-white px-5 py-3 text-center text-xs font-bold text-slate-800 shadow-2xl">
          {toast}
        </div>
      )}
    </main>
  );
}
