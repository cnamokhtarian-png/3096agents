"use client";

import { useEffect, useState } from "react";
import { themeFor, statusInfo, relativeTime } from "@/lib/office-theme";

export type SceneActivity = {
  id?: number;
  action: string;
  status: string;
  detail?: string;
  createdAt?: string | Date | null;
};

const fa = (n: number) => Number(n || 0).toLocaleString("fa-IR", { maximumFractionDigits: 2 });

export default function RoomScene({
  agent,
  activities = [],
  goalProgress,
  todayEarned = 0,
  marketLine,
}: {
  agent: {
    avatar: string;
    name: string;
    role: string;
    specialty: string;
    status: string;
    officeRoom: string;
    officeFloor: string;
    currentFocus: string;
    goalTitle: string;
    lastActiveAt: string | null;
    errorCount: number;
  };
  activities?: SceneActivity[];
  goalProgress: number | null;
  todayEarned?: number;
  marketLine?: string;
}) {
  const theme = themeFor(agent.specialty);
  const status = statusInfo(agent.status);
  const [clock, setClock] = useState("");

  useEffect(() => {
    const tick = () =>
      setClock(
        new Date().toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
      );
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, []);

  const consoleLines = activities.slice(0, 5).reverse();
  const working = agent.status === "active";

  return (
    <div
      className={`relative overflow-hidden rounded-[32px] border border-white/10 bg-gradient-to-br ${theme.wall} ${theme.glow} shadow-2xl`}
    >
      {/* نور سقف */}
      <div className="pointer-events-none absolute -top-24 left-1/2 h-56 w-[70%] -translate-x-1/2 rounded-full bg-white/10 blur-3xl" />

      <div className="relative aspect-[16/10] w-full min-h-[360px]">
        {/* ── پنجره ─────────────────────────────────────────── */}
        <div className="absolute left-6 top-6 h-[38%] w-[34%] overflow-hidden rounded-xl border-2 border-white/20 bg-gradient-to-b from-[#0a1f36] via-[#0e2b45] to-[#123a54] shadow-inner">
          <span className="absolute right-4 top-3 h-6 w-6 rounded-full bg-amber-100/80 blur-[1px]" />
          {[...Array(9)].map((_, i) => (
            <span
              key={i}
              className="absolute h-0.5 w-0.5 rounded-full bg-white/70"
              style={{ left: `${8 + ((i * 37) % 82)}%`, top: `${6 + ((i * 23) % 55)}%` }}
            />
          ))}
          <div className="absolute inset-x-0 bottom-0 h-[46%]">
            <div className="flex h-full items-end justify-center gap-1.5 px-2">
              {[34, 52, 40, 68, 46, 58, 30, 62, 44].map((h, i) => (
                <div key={i} className="relative flex-1 rounded-t-sm bg-[#08192a]" style={{ height: `${h}%` }}>
                  {[...Array(3)].map((_, j) => (
                    <span
                      key={j}
                      className="absolute h-[3px] w-[3px] bg-amber-200/50"
                      style={{ left: `${20 + j * 30}%`, top: `${12 + j * 22}%` }}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div className="absolute inset-y-0 left-1/2 w-1 -translate-x-1/2 bg-white/25" />
          <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 bg-white/25" />
        </div>

        {/* ── تابلوی دیواری (هدف) ───────────────────────────── */}
        <div className="absolute right-6 top-6 w-[42%] rounded-xl border border-white/15 bg-white/95 p-3 text-slate-800 shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-200 pb-1">
            <span className="text-[10px] font-black">🎯 هدف ماه</span>
            <span className="text-[9px] text-slate-500">{agent.officeFloor}۰{agent.officeRoom}</span>
          </div>
          <p className="mt-1 line-clamp-2 text-[10px] leading-4 font-bold">{agent.goalTitle || "هدفی ثبت نشده"}</p>
          {goalProgress !== null && (
            <>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${goalProgress}%`,
                    background: `linear-gradient(90deg, ${theme.accentHex}, #34d399)`,
                  }}
                />
              </div>
              <p className="mt-0.5 text-[9px] text-slate-500">{fa(goalProgress)}٪ محقق شده</p>
            </>
          )}
        </div>

        {/* ── قاب/وسیله دیواری ──────────────────────────────── */}
        <div className="absolute left-[42%] top-[16%] flex h-20 w-20 flex-col items-center justify-center rounded-2xl border border-white/15 bg-black/30 backdrop-blur">
          <span className="text-3xl">{theme.prop}</span>
          <span className="mt-1 px-1 text-center text-[7px] leading-2 text-white/60">{theme.propLabel}</span>
        </div>

        {/* ── ساعت دیواری (واقعی) ───────────────────────────── */}
        <div className="absolute left-1/2 top-6 -translate-x-1/2 text-center">
          <div className="rounded-full border border-white/20 bg-black/40 px-3 py-1 backdrop-blur">
            <span className="font-mono text-[11px] text-white/80">{clock || "—"}</span>
          </div>
          {marketLine && (
            <div className="mt-1 rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2 py-0.5">
              <span className="text-[8px] text-emerald-200" dir="ltr">
                {marketLine}
              </span>
            </div>
          )}
        </div>

        {/* ── کف اتاق ──────────────────────────────────────── */}
        <div className={`absolute inset-x-0 bottom-0 h-[38%] bg-gradient-to-b ${theme.floor}`}>
          <div
            className="h-full w-full opacity-25"
            style={{
              backgroundImage:
                "repeating-linear-gradient(90deg, rgba(255,255,255,.3) 0 1px, transparent 1px 60px), repeating-linear-gradient(0deg, rgba(255,255,255,.12) 0 1px, transparent 1px 34px)",
            }}
          />
          <div className="absolute inset-x-0 top-0 h-2 bg-black/30" />
        </div>

        {/* ── میز، مانیتور، کارمند ─────────────────────────── */}
        <div className="absolute bottom-[16%] left-1/2 w-[62%] -translate-x-1/2">
          {/* مانیتور روی میز */}
          <div className="mx-auto mb-1 w-[58%] rounded-lg border-4 border-[#0b0f18] bg-[#05080f] p-1.5 shadow-2xl">
            <div
              className="h-[74px] overflow-hidden rounded-sm p-1.5 font-mono text-[7px] leading-3"
              style={{ background: theme.screen, color: "#9df5c9" }}
            >
              {consoleLines.length ? (
                consoleLines.map((a, i) => (
                  <div key={a.id ?? i} className="truncate">
                    <span className="text-emerald-500">›</span>{" "}
                    <span className={a.status === "failed" ? "text-red-400" : "text-emerald-200"}>
                      {a.action}
                    </span>
                  </div>
                ))
              ) : (
                <div className="text-emerald-600">
                  › no real activity yet
                  <br />› waiting for verified events…
                  <span className="animate-pulse">▌</span>
                </div>
              )}
              <span className="animate-pulse">▌</span>
            </div>
            <div className="mx-auto mt-1 h-1 w-8 rounded-full bg-white/20" />
          </div>

          {/* میز */}
          <div
            className={`relative h-11 rounded-lg bg-gradient-to-b ${theme.desk} shadow-[0_18px_30px_-12px_rgba(0,0,0,.8)] ring-1 ring-white/10`}
          >
            <div className="absolute inset-x-0 top-0 h-1 rounded-t-lg bg-white/15" />
            {/* ماگ و کاغذ */}
            <div className="absolute right-6 top-1.5 h-5 w-4 rounded-b-md bg-white/70">
              <div className="absolute -right-1 top-1 h-2.5 w-1.5 rounded-full border border-white/70" />
              <div className="absolute -top-2 left-1/2 h-2 w-px -translate-x-1/2 animate-pulse bg-white/30" />
            </div>
            <div className="absolute left-8 top-2 h-4 w-10 rotate-[-5deg] rounded-sm bg-white/80" />
            <div className="absolute left-8 top-4 h-3 w-9 rotate-[3deg] rounded-sm bg-white/55" />
          </div>

          {/* صندلی + آواتار */}
          <div className="relative mx-auto -mt-2 w-fit text-center">
            <div className="mx-auto h-3 w-10 rounded-t-md bg-black/50" />
            <div
              className={`mx-auto grid h-14 w-14 place-items-center rounded-full border-2 border-white/25 bg-white/10 text-2xl backdrop-blur ${
                working ? "ring-4 ring-emerald-400/25" : ""
              }`}
            >
              {agent.avatar}
            </div>
            <div className="mx-auto mt-1 h-1.5 w-14 rounded-full bg-black/50" />
          </div>
        </div>

        {/* ── درِ دفتر ─────────────────────────────────────── */}
        <div className="absolute bottom-0 right-5 h-[42%] w-[13%] min-w-[52px] rounded-t-lg border-2 border-white/15 bg-gradient-to-b from-[#20304b] to-[#0b1320] shadow-2xl">
          <div className="absolute inset-x-1 top-1 h-[45%] rounded-sm border border-white/20 bg-gradient-to-b from-[#123049] to-[#0a1d2c]" />
          <span className="absolute right-2 top-1/2 h-1.5 w-1.5 rounded-full bg-amber-300" />
          <div className="absolute -top-4 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-black/50 px-1.5 py-0.5 text-[7px] text-white/60">
            {agent.officeRoom || "—"}
          </div>
        </div>

        {/* ── گیاه گوشه ────────────────────────────────────── */}
        <div className="absolute bottom-[30%] left-4 text-3xl opacity-90">{theme.plant}</div>

        {/* ── چراغ وضعیت سقفی ──────────────────────────────── */}
        <div className="absolute right-[24%] top-3 flex items-center gap-1.5 rounded-full border border-white/15 bg-black/40 px-2 py-1 backdrop-blur">
          <span className={`h-2 w-2 rounded-full ${status.dot} ${working ? "live-dot" : ""}`} />
          <span className={`text-[9px] font-bold ${status.text}`}>{status.label}</span>
        </div>

        {/* ── نوار پایین اتاق: کار جاری ─────────────────────── */}
        <div className="absolute inset-x-4 bottom-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/45 px-3 py-2 backdrop-blur">
          <div className="flex min-w-0 items-center gap-2">
            <span className="rounded bg-white/10 px-1.5 py-0.5 text-[8px] text-white/60">در حال انجام</span>
            <span className="truncate text-[10px] text-white/85">
              {agent.currentFocus || "کاری ثبت نشده"}
            </span>
          </div>
          <div className="flex items-center gap-3 text-[9px] text-white/60">
            <span>امروز: <b className="text-emerald-300">{fa(todayEarned)} USDT</b></span>
            <span>آخرین فعالیت: {relativeTime(agent.lastActiveAt)}</span>
            {agent.errorCount > 0 && <span className="text-red-300">{fa(agent.errorCount)} خطا</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
