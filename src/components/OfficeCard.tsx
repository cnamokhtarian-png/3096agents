"use client";

import Link from "next/link";
import { themeFor, statusInfo, relativeTime } from "@/lib/office-theme";

export type OfficeAgent = {
  id: number;
  name: string;
  slug: string;
  role: string;
  specialty: string;
  avatar: string;
  status: string;
  department: string;
  officeFloor: string;
  officeRoom: string;
  goalTitle: string;
  goalTargetUsdt: number;
  earnedUsdt: number;
  tasksCompleted: number;
  successCount: number;
  errorCount: number;
  currentFocus: string;
  lastActiveAt: string | null;
  apiKey?: string;
};

const fa = (n: number) =>
  Number(n || 0).toLocaleString("fa-IR", { maximumFractionDigits: 2 });

export default function OfficeCard({
  agent,
  todayEarned = 0,
  pendingJobs = 0,
}: {
  agent: OfficeAgent;
  todayEarned?: number;
  pendingJobs?: number;
}) {
  const theme = themeFor(agent.specialty);
  const status = statusInfo(agent.status);
  const progress =
    Number(agent.goalTargetUsdt) > 0
      ? Math.min(100, Math.round((Number(agent.earnedUsdt) / Number(agent.goalTargetUsdt)) * 100))
      : null;

  return (
    <Link
      href={`/control/office/${agent.id}`}
      className="group relative block overflow-hidden rounded-[28px] border border-white/10 bg-[#0B1220] text-white shadow-xl transition duration-300 hover:-translate-y-1 hover:border-white/25 hover:shadow-2xl"
    >
      {/* ── مینیاتور اتاق ─────────────────────────────────────── */}
      <div className={`relative h-48 bg-gradient-to-br ${theme.wall} overflow-hidden`}>
        {/* پلاک نام روی دیوار */}
        <div className="absolute inset-x-0 top-0 z-10 flex items-start justify-between bg-gradient-to-b from-black/60 to-transparent px-3 pb-4 pt-2">
          <div className="min-w-0">
            <p className="truncate text-[11px] font-black leading-tight">
              {agent.name.split("(")[0].trim()}
            </p>
            <p className="truncate text-[8px] text-white/60">{theme.roleShort}</p>
          </div>
          <span className="shrink-0 rounded-md border border-white/15 bg-black/40 px-1.5 py-0.5 text-[8px] font-bold text-white/70">
            {agent.officeRoom || "—"} / طبقه {agent.officeFloor || "۱"}
          </span>
        </div>

        {/* پنجره با منظره شهر */}
        <div className="absolute left-4 top-[58px] h-16 w-24 overflow-hidden rounded-lg border border-white/20 bg-gradient-to-b from-[#0b2036] to-[#163a56] shadow-inner">
          <div className="absolute inset-x-0 bottom-0 h-6 bg-[#0a1b2b]">
            <div className="flex h-full items-end gap-[3px] px-1">
              {[8, 14, 10, 18, 12, 9, 16].map((h, i) => (
                <span
                  key={i}
                  className="w-1.5 rounded-t-[1px] bg-emerald-300/25"
                  style={{ height: `${h}px` }}
                />
              ))}
            </div>
          </div>
          <span className="absolute right-2 top-1 h-3 w-3 rounded-full bg-amber-200/70" />
          <div className="absolute inset-y-0 left-1/2 w-px bg-white/25" />
          <div className="absolute inset-x-0 top-1/2 h-px bg-white/20" />
        </div>

        {/* وسیله دیواری مخصوص هر دپارتمان */}
        <div className="absolute right-4 top-[58px] flex h-16 w-16 flex-col items-center justify-center rounded-2xl border border-white/15 bg-black/30 backdrop-blur">
          <span className="text-2xl leading-none">{theme.prop}</span>
          <span className="mt-1 max-w-full truncate px-1 text-[7px] text-white/60">
            {theme.propLabel}
          </span>
        </div>

        {/* الگوی کف اتاق */}
        <div className={`absolute inset-x-0 bottom-0 h-16 bg-gradient-to-b ${theme.floor} border-t border-white/10`}>
          <div
            className="h-full w-full opacity-20"
            style={{
              backgroundImage:
                "repeating-linear-gradient(90deg, rgba(255,255,255,.35) 0 1px, transparent 1px 26px)",
            }}
          />
          <div className="absolute inset-x-0 top-0 h-1 bg-black/30" />
        </div>

        {/* میز کار، مانیتور و صندلی */}
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2">
          <div className="mx-auto mb-0.5 h-6 w-16 rounded-sm border-2 border-[#0a0f18] bg-black/70 p-0.5 shadow-lg">
            <div className="h-full w-full rounded-[1px] opacity-80" style={{ background: theme.screen }} />
          </div>
          <div className={`h-7 w-24 rounded-t-md bg-gradient-to-b ${theme.desk} shadow-[0_14px_20px_-10px_rgba(0,0,0,.9)] ring-1 ring-white/10`}>
            <div className="mx-auto h-1 w-full rounded-t-md bg-white/15" />
          </div>
          <div className="mx-auto mt-0.5 h-2 w-1 bg-white/15" />
          <div className="relative mx-auto -mt-1 h-9 w-9">
            <div className="grid h-9 w-9 place-items-center rounded-full border border-white/25 bg-white/10 text-lg ring-2 ring-white/10 backdrop-blur transition group-hover:scale-110">
              {agent.avatar}
            </div>
            <span
              className={`absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ${status.dot} ring-2 ring-[#0B1220] ${
                agent.status === "active" ? "live-dot" : ""
              }`}
            />
          </div>
        </div>

        {/* درِ اتاق */}
        <div className="absolute bottom-0 right-4 h-[74px] w-11 rounded-t-md border border-white/15 border-b-0 bg-gradient-to-b from-[#1a2740] to-[#0d1524] shadow-2xl">
          <div className="absolute inset-x-1 top-1 h-8 rounded-sm border border-white/10 bg-gradient-to-b from-[#123049] to-[#0a1d2c]" />
          <span className="absolute right-1.5 top-10 h-1 w-1 rounded-full bg-amber-300/80" />
        </div>

        {/* گیاه گوشه */}
        <div className="absolute bottom-[58px] left-2 text-lg opacity-80">{theme.plant}</div>
      </div>

      {/* ── اطلاعات کارمند ─────────────────────────────────────── */}
      <div className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-black">{agent.name}</h3>
            <p className="mt-0.5 truncate text-[11px] text-slate-400">{agent.department || theme.label}</p>
          </div>
          <span
            className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${status.bg} ${status.text}`}
          >
            {status.label}
          </span>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
          <p className="text-[10px] text-slate-400">🎯 هدف این کارمند</p>
          <p className="mt-0.5 line-clamp-2 text-[11px] leading-5 text-slate-200">
            {agent.goalTitle || "هدفی تعیین نشده"}
          </p>
          {progress !== null && (
            <div className="mt-2">
              <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${progress}%`, background: theme.accentHex }}
                />
              </div>
              <div className="mt-1 flex justify-between text-[9px] text-slate-400">
                <span>{fa(agent.earnedUsdt)} USDT</span>
                <span>{fa(progress)}٪ از {fa(agent.goalTargetUsdt)}</span>
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-3 gap-1.5 text-center">
          {[
            ["امروز", `${fa(todayEarned)}`, "USDT"],
            ["موفق", `${fa(agent.successCount)}`, "اجرا"],
            ["صف", `${fa(pendingJobs)}`, "کار"],
          ].map(([l, v, u]) => (
            <div key={l} className="rounded-lg bg-black/25 px-1 py-1.5 ring-1 ring-white/5">
              <p className="text-[9px] text-slate-400">{l}</p>
              <p className="text-xs font-black" style={{ color: theme.accentHex }}>
                {v}
                <span className="mr-0.5 text-[8px] font-normal text-slate-500">{u}</span>
              </p>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between border-t border-white/10 pt-2.5 text-[10px]">
          <span className="truncate text-slate-400">
            آخرین فعالیت: {relativeTime(agent.lastActiveAt)}
            {agent.errorCount > 0 && (
              <span className="mr-1 font-bold text-red-300">• {fa(agent.errorCount)} خطا</span>
            )}
          </span>
          <span className="shrink-0 font-bold text-emerald-300 transition group-hover:translate-x-[-3px]">
            ورود به دفتر ←
          </span>
        </div>
      </div>

    </Link>
  );
}
