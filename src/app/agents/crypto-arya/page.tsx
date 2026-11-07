"use client";

import { useCallback, useEffect, useState } from "react";

const fa = (n: any, d = 1) =>
  Number(n || 0).toLocaleString("fa-IR", { maximumFractionDigits: d });
const usd = (n: any) =>
  `$${Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const time = (v: any) =>
  v
    ? new Date(v).toLocaleString("fa-IR", {
        hour: "2-digit",
        minute: "2-digit",
        month: "short",
        day: "numeric",
      })
    : "—";

const STATUS: Record<string, [string, string]> = {
  scanning: ["🟢 در حال رصد بازار", "bg-emerald-500/20 text-emerald-300 border-emerald-400/40"],
  trading: ["⚔️ در حال انجام معامله", "bg-amber-500/20 text-amber-300 border-amber-400/40"],
  review: ["📊 پیشنهاد منتظر تأیید شما", "bg-sky-500/20 text-sky-300 border-sky-400/40"],
  idle: ["💤 خاموش / استراحت", "bg-slate-500/20 text-slate-300 border-slate-400/40"],
};

const JOURNAL_ICON: Record<string, string> = {
  scan: "🔍",
  skip: "🧘",
  signal: "📊",
  trade: "⚔️",
  close: "🏁",
  review: "🧠",
  system: "⚙️",
};

export default function CryptoAryaDesk() {
  const [desk, setDesk] = useState<any>(null);
  const [cfg, setCfg] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [user, setUser] = useState<any>(null);
  const [showSettings, setShowSettings] = useState(false);

  const notify = (t: string) => {
    setToast(t);
    setTimeout(() => setToast(""), 4000);
  };

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/trader/desk", { cache: "no-store" });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setDesk(d);
      setCfg((prev: any) => prev ?? d.config);
    } catch (e) {
      notify(e instanceof Error ? e.message : "خطا در بارگذاری میز کار");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch("/api/auth/login")
      .then((r) => r.json())
      .then((d) => setUser(d.user))
      .catch(() => {});
    // بارگذاری اولیه در microtask تا رندر اول بدون setState همزمان باشد
    void Promise.resolve().then(() => load());
    const iv = setInterval(() => void load(), 15000);
    return () => clearInterval(iv);
  }, [load]);

  async function call(path: string, body?: any, method = "POST") {
    setBusy(true);
    try {
      const r = await fetch(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const d = await r.json();
      await load();
      return d;
    } finally {
      setBusy(false);
    }
  }

  async function scan(force = false) {
    const d = await call("/api/trader/scan", { force });
    notify(
      d.ok && d.signal
        ? "📊 پیشنهاد معامله ساخته و به تلگرام ارسال شد"
        : d.alreadyPending
        ? "یک پیشنهاد همچنان منتظر تأیید شماست"
        : d.reason || "اسکن انجام شد؛ پیشنهادی صادر نشد"
    );
  }

  async function decide(id: number, decision: "approve" | "reject") {
    const d = await call("/api/trader/signals", { id, decision, by: "میز کار آریا" });
    notify(
      d.error
        ? d.error
        : decision === "approve"
        ? `✅ معامله تأیید شد و پوزیشن باز شد (${d.mode === "live" ? "LIVE" : "Paper"})`
        : "❌ پیشنهاد رد شد؛ سفارشی ارسال نشد"
    );
  }

  async function closePosition(id: number) {
    if (!confirm("خروج اضطراری: پوزیشن با قیمت لحظهای بسته شود؟")) return;
    const d = await call("/api/trader/positions", { id, action: "close" });
    notify(d.ok ? `🏁 پوزیشن بسته شد: ${fa(d.pnl)} USDT` : d.error || "خطا");
  }

  async function saveSettings(e: any) {
    e.preventDefault();
    const d = await call("/api/trader/settings", cfg, "PUT");
    if (d.ok) {
      setCfg(d.config);
      notify("⚙️ تنظیمات اختصاصی آریا ذخیره شد");
      setShowSettings(false);
    } else notify(d.error || "خطا در ذخیرهٔ تنظیمات");
  }

  async function tick() {
    const d = await call("/api/trader/tick", {});
    notify(
      `🔄 تپش شرکت: ${fa(d.synced || 0, 0)} پوزیشن بررسی، ${fa(
        d.autoClosed || 0,
        0
      )} بسته شد`
    );
  }

  if (loading || !desk) {
    return (
      <main className="min-h-screen bg-[#0B1220] text-white grid place-items-center">
        <div className="text-center">
          <div className="text-6xl animate-bounce">🪙</div>
          <p className="mt-4 font-bold">در حال بیدار کردن ایجنت آریا (A1) و رصد بازار...</p>
        </div>
      </main>
    );
  }

  const s = desk.snapshot || {};
  const st = STATUS[desk.status] || STATUS.scanning;
  const pos = desk.positions || [];
  const openPos = pos.filter((p: any) => p.status === "open");
  const closedPos = pos.filter((p: any) => p.status === "closed");
  const sig = desk.pendingSignal;
  const c = cfg || {};

  return (
    <div className="min-h-screen bg-[#F6F7F9]">
      {/* هدر میز کار */}
      <header className="bg-gradient-to-l from-[#0B1220] via-[#101d33] to-[#132238] text-white">
        <div className="max-w-[1400px] mx-auto p-5 md:p-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="bg-amber-400 text-black text-[11px] font-black px-3 py-1 rounded-full">
                  A1 · ایجنت تریدر ارشد رمزارز
                </span>
                <span className={`text-xs font-bold px-3 py-1 rounded-full border ${st[1]}`}>
                  <span className="live-dot inline-block w-2 h-2 bg-current rounded-full ml-1" />
                  {st[0]}
                </span>
                <span
                  className={`text-xs font-bold px-3 py-1 rounded-full border ${
                    desk.execution === "live"
                      ? "bg-red-500/20 text-red-300 border-red-400/40"
                      : "bg-slate-500/20 text-slate-300 border-slate-400/40"
                  }`}
                >
                  {desk.execution === "live" ? "🔴 اجرای زنده (LIVE)" : "📝 Paper Trading"}
                </span>
              </div>
              <h1 className="text-3xl md:text-4xl font-black mt-3">
                {desk.agent?.avatar || "🪙"} میز کار {desk.agent?.name || "آریا (A1)"}
              </h1>
              <p className="text-slate-300 text-sm mt-2 max-w-2xl leading-7">
                {desk.agent?.role} — تحلیل تکنیکال، دفتر سفارشات، جریان نهنگها و
                احساسات بازار؛ تصمیمگیری بدون هیجان و اجرا فقط با تأیید شما.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => scan(false)}
                disabled={busy}
                className="bg-amber-400 hover:bg-amber-300 text-black font-black px-4 py-2.5 rounded-xl text-sm disabled:opacity-50"
              >
                🔍 اسکن و پیشنهاد معامله
              </button>
              <button
                onClick={tick}
                disabled={busy}
                className="bg-white/10 hover:bg-white/20 font-bold px-4 py-2.5 rounded-xl text-sm disabled:opacity-50"
              >
                🔄 تپش و بستن خودکار
              </button>
              <button
                onClick={() => setShowSettings(!showSettings)}
                className="bg-white/10 hover:bg-white/20 font-bold px-4 py-2.5 rounded-xl text-sm"
              >
                ⚙️ تنظیمات
              </button>
              <a
                href="/control"
                className="bg-white/10 hover:bg-white/20 font-bold px-4 py-2.5 rounded-xl text-sm"
              >
                ← مرکز کنترل
              </a>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6">
            <div className="bg-white/10 rounded-2xl p-3">
              <p className="text-[11px] text-slate-300">سرمایهٔ تخصیصیافته</p>
              <p className="text-xl font-black text-emerald-300 mt-1">
                {fa(desk.config.capitalUsdt, 0)} USDT
              </p>
              <p className="text-[10px] text-slate-400 truncate" dir="ltr">
                {desk.masterWallet.address}
              </p>
            </div>
            <div className="bg-white/10 rounded-2xl p-3">
              <p className="text-[11px] text-slate-300">قیمت لحظهای {desk.config.symbol}</p>
              <p className="text-xl font-black mt-1" dir="ltr">
                {usd(s.price)}
              </p>
              <p className="text-[10px] text-slate-400">
                منبع: {s.source === "live" ? "🟢 زنده" : s.source === "partial" ? "🟡 جزئی" : "⚪ آفلاین/نمونه"}
              </p>
            </div>
            <div className="bg-white/10 rounded-2xl p-3">
              <p className="text-[11px] text-slate-300">سود خالص معاملات</p>
              <p
                className={`text-xl font-black mt-1 ${
                  desk.performance.netPnl >= 0 ? "text-emerald-300" : "text-red-300"
                }`}
              >
                {desk.performance.netPnl >= 0 ? "+" : ""}
                {fa(desk.performance.netPnl)} USDT
              </p>
              <p className="text-[10px] text-slate-400">
                Win Rate {fa(desk.performance.winRate, 0)}٪
              </p>
            </div>
            <div className="bg-white/10 rounded-2xl p-3">
              <p className="text-[11px] text-slate-300">رتبه در لیگ کارمندان</p>
              <p className="text-xl font-black text-amber-300 mt-1">
                {desk.performance.league ? `#${fa(desk.performance.league.rank, 0)}` : "—"}
              </p>
              <p className="text-[10px] text-slate-400">
                {desk.performance.league
                  ? `${fa(desk.performance.league.score)} امتیاز`
                  : "بدون امتیاز"}
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto p-4 md:p-7 space-y-4">
        {!user && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-2xl p-3 text-xs font-bold">
            برای دسترسی کامل مدیریتی <a href="/login" className="underline">وارد حساب شوید</a> —
            نمایش میز کار در حالت مشاهده همچنان فعال است.
          </div>
        )}

        {/* منابع داده */}
        <div className="bg-white border rounded-3xl p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-black text-sm">📡 منابع اطلاعاتی متصل (Real Data Feed)</h2>
            <span className="text-[11px] text-slate-500">
              آخرین بهروزرسانی: {time(s.fetchedAt)} • {fa(s.candles, 0)} کندل ۴ ساعته
            </span>
          </div>
          <div className="flex flex-wrap gap-2 mt-3">
            {(s.sources || []).map((x: string) => (
              <span key={x} className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-bold px-2.5 py-1 rounded-full">
                ✅ {x}
              </span>
            ))}
            {(s.notes || []).map((x: string) => (
              <span key={x} className="bg-slate-100 text-slate-600 text-[11px] px-2.5 py-1 rounded-full">
                ⚠️ {x}
              </span>
            ))}
          </div>
          <p className="text-[11px] text-slate-500 mt-3 leading-6">
            TA-Lib / TradingView بهصورت بومی (RSI، MACD، MA، ATR) روی کندلهای واقعی صرافی
            محاسبه میشود. دادهٔ <b>درونزنجیرهای</b> واقعی (Whale Alert/Glassnode) نیازمند
            کلید API است؛ تا آن زمان «جریان سفارشات بزرگ صرافی» بهعنوان پروکسی و با همین
            برچسب نمایش داده میشود. اخبار نیز با <span dir="ltr">CRYPTOPANIC_API_KEY</span> اختیاری است.
          </p>
        </div>

        <div className="grid lg:grid-cols-3 gap-4">
          {/* ستون اصلی */}
          <div className="lg:col-span-2 space-y-4">
            {/* تابلو وضعیت زنده / اندیکاتورها */}
            <section className="bg-white border rounded-3xl p-5">
              <div className="flex justify-between items-center flex-wrap gap-2">
                <h2 className="font-black">📈 تابلو وضعیت زنده و تحلیل تکنیکال</h2>
                <span className={`text-xs font-bold px-3 py-1 rounded-full border ${st[1]} !text-slate-700 !bg-slate-100`}>
                  {st[0]}
                </span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-4">
                {[
                  ["RSI (14)", fa(s.rsi, 0), s.rsi > 70 ? "text-red-600" : s.rsi < 30 ? "text-emerald-600" : "text-slate-800"],
                  ["MACD Hist", fa(s.macdHist, 0), "text-slate-800"],
                  ["MA20", usd(s.ma20), "text-slate-800"],
                  ["MA50", usd(s.ma50), "text-slate-800"],
                  ["حمایت", usd(s.support), "text-emerald-600"],
                  ["مقاومت", usd(s.resistance), "text-red-600"],
                  ["ترس / طمع", fa(s.fearGreed, 0), "text-amber-600"],
                  ["نوسان ۴h", `${fa(s.volatilityPct)}٪`, "text-violet-600"],
                  ["عمق خریداران", `${fa((s.orderbookImbalance || 0) * 100)}٪`, "text-sky-600"],
                  ["جریان نهنگ (پروکسی)", `${fa(s.whaleFlowUsdt, 0)} USDT`, "text-indigo-600"],
                  ["احساسات اخبار", fa(s.sentiment, 2), "text-slate-800"],
                  ["حجم کندل", `${fa((s.volumeUsdt || 0) / 1e6, 1)}M USDT`, "text-slate-800"],
                ].map(([label, value, color]) => (
                  <div key={String(label)} className="bg-slate-50 rounded-2xl p-3">
                    <p className="text-[11px] text-slate-500">{label}</p>
                    <b className={`text-sm ${color}`} dir="auto">
                      {value}
                    </b>
                  </div>
                ))}
              </div>
            </section>

            {/* کارت پیشنهاد معامله */}
            <section className="bg-white border-2 border-amber-200 rounded-3xl p-5">
              <div className="flex flex-wrap justify-between items-center gap-2">
                <h2 className="font-black">📊 پیشنهاد معامله | ایجنت آریا (A1)</h2>
                <button
                  onClick={() => scan(true)}
                  disabled={busy}
                  className="text-xs bg-slate-900 text-white px-3 py-1.5 rounded-full font-bold disabled:opacity-50"
                >
                  🔍 اسکن مجدد (force)
                </button>
              </div>
              {sig ? (
                <div className="mt-4">
                  <div className="bg-gradient-to-l from-slate-50 to-white border rounded-2xl p-4 text-sm leading-8">
                    <p className="font-black text-base">📊 پیشنهاد معامله جدید | ایجنت آریا (A1)</p>
                    <p><b>جفتارز:</b> <code dir="ltr">{sig.symbol}</code></p>
                    <p>
                      <b>نوع پوزیشن:</b>{" "}
                      {sig.side === "LONG" ? "🟢 LONG (خرید)" : "🔴 SHORT (فروش)"}
                    </p>
                    <p><b>نقطه ورود:</b> <code dir="ltr">{usd(sig.entryPrice)}</code></p>
                    <p>
                      <b>تخمین سود:</b> <code>+{fa(sig.targetPct)}٪</code> (معادل{" "}
                      {fa(sig.estimatedProfitUsdt)} USDT روی پوزیشن{" "}
                      {fa(sig.positionUsdt, 0)} USDT با اهرم {fa(sig.leverage, 0)}x)
                    </p>
                    <p><b>اهرم پیشنهادی:</b> <code>{fa(sig.leverage, 0)}x</code> (ریسک کنترلشده)</p>
                    <p>
                      <b>تخمین زمان:</b> ~ {fa(sig.estimatedHoursMin, 0)} الی{" "}
                      {fa(sig.estimatedHoursMax, 0)} ساعت
                    </p>
                    <p><b>حد ضرر (Stop-Loss):</b> <code dir="ltr">{usd(sig.stopLoss)}</code></p>
                    <p><b>حد سود (Take-Profit):</b> <code dir="ltr">{usd(sig.takeProfit)}</code></p>
                    <p><b>نسبت سود/ریسک:</b> ۱ به {fa(sig.riskReward)} ✅</p>
                    <p><b>دلیل تحلیل:</b> <i>«{sig.analysisReason}»</i></p>
                    <p className="text-xs text-slate-500">
                      اطمینان {fa(sig.confidence, 0)}٪ • منبع: {sig.dataSource} •{" "}
                      {(sig.dataSources || []).join("، ")}
                    </p>
                    <p className="text-xs text-slate-500">🛡️ {sig.riskNotes}</p>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-4">
                    <button
                      onClick={() => decide(sig.id, "approve")}
                      disabled={busy}
                      className="bg-emerald-500 hover:bg-emerald-600 text-white font-black px-5 py-2.5 rounded-xl text-sm disabled:opacity-50"
                    >
                      ✅ تایید و اجرای معامله
                    </button>
                    <button
                      onClick={() => decide(sig.id, "reject")}
                      disabled={busy}
                      className="bg-red-50 hover:bg-red-100 text-red-600 font-black px-5 py-2.5 rounded-xl text-sm disabled:opacity-50"
                    >
                      ❌ رد پیشنهاد
                    </button>
                    <span className="text-xs text-slate-500 self-center">
                      مهلت: {time(sig.expiresAt)}
                    </span>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-slate-500 mt-4 leading-7">
                  پیشنهاد معلقی وجود ندارد. دکمهٔ «اسکن و پیشنهاد معامله» را بزنید؛ ایجنت
                  اگر شواهد کافی (R/R، آستانهٔ اطمینان، ترس و طمع، نویز خبری) نداشته باشد،
                  بهجای معاملهٔ هیجانی دلیل صرفنظر کردن را در دفترچه ثبت میکند.
                </p>
              )}
            </section>

            {/* پوزیشنهای فعال */}
            <section className="bg-white border rounded-3xl p-5">
              <div className="flex justify-between items-center flex-wrap gap-2">
                <h2 className="font-black">⚔️ کارت معاملات فعال (Active Positions)</h2>
                <span className="text-xs text-slate-500">
                  PnL باز: {fa(desk.performance.openPnl)} USDT • بستهشدهٔ خودکار در این تپش:{" "}
                  {fa(desk.sync?.closed || 0, 0)}
                </span>
              </div>
              {openPos.length === 0 ? (
                <p className="text-sm text-slate-400 mt-4">پوزیشن بازی وجود ندارد.</p>
              ) : (
                <div className="space-y-3 mt-4">
                  {openPos.map((p: any) => (
                    <div key={p.id} className="border rounded-2xl p-4">
                      <div className="flex flex-wrap justify-between items-center gap-2">
                        <b>
                          {p.side === "LONG" ? "🟢 LONG" : "🔴 SHORT"} {p.symbol} •{" "}
                          {fa(p.sizeUsdt, 0)} USDT × {fa(p.leverage, 0)}x
                        </b>
                        <span className="text-xs bg-slate-100 px-2 py-1 rounded-full">
                          {p.mode === "live" ? "🔴 LIVE" : "📝 Paper"} • #{fa(p.id, 0)}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mt-3 text-xs">
                        <span>ورود: <b dir="ltr">{usd(p.entryPrice)}</b></span>
                        <span>قیمت فعلی: <b dir="ltr">{usd(p.currentPrice)}</b></span>
                        <span>🎯 <b dir="ltr">{usd(p.takeProfit)}</b></span>
                        <span>🛑 <b dir="ltr">{usd(p.stopLoss)}</b></span>
                        <span className={p.unrealizedPnl >= 0 ? "text-emerald-600" : "text-red-600"}>
                          PnL: <b>{p.unrealizedPnl >= 0 ? "+" : ""}{fa(p.unrealizedPnl)} USDT ({fa(p.pnlPct)}٪)</b>
                        </span>
                      </div>
                      <div className="flex gap-2 mt-3">
                        <button
                          onClick={() => closePosition(p.id)}
                          disabled={busy}
                          className="bg-red-500 hover:bg-red-600 text-white font-bold px-4 py-2 rounded-xl text-xs disabled:opacity-50"
                        >
                          🚨 خروج اضطراری و بستن معامله
                        </button>
                        <span className="text-[11px] text-slate-500 self-center">
                          بستهشدن خودکار روی TP/SL یا سقف {fa(desk.config.maxHoldHours, 0)} ساعت
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {closedPos.length > 0 && (
                <div className="mt-5">
                  <h3 className="font-bold text-sm">🏁 آخرین معاملات بستهشده</h3>
                  <div className="mt-2 space-y-1 text-xs">
                    {closedPos.slice(0, 8).map((p: any) => (
                      <div key={p.id} className="flex justify-between border-b py-1.5 gap-2">
                        <span>
                          #{fa(p.id, 0)} • {p.side} {p.symbol} • {p.closeReason} •{" "}
                          {time(p.closedAt)}
                        </span>
                        <b className={p.realizedPnl >= 0 ? "text-emerald-600" : "text-red-600"}>
                          {p.realizedPnl >= 0 ? "+" : ""}{fa(p.realizedPnl)} USDT
                        </b>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          </div>

          {/* ستون کناری */}
          <div className="space-y-4">
            {/* کارنامه */}
            <section className="bg-white border rounded-3xl p-5">
              <h2 className="font-black">📊 گزارش عملکرد و کارنامه</h2>
              <div className="grid grid-cols-2 gap-2 mt-4">
                <div className="bg-emerald-50 rounded-2xl p-3">
                  <p className="text-[11px] text-slate-500">نرخ موفقیت (Win Rate)</p>
                  <b className="text-xl text-emerald-700">{fa(desk.performance.winRate, 0)}٪</b>
                </div>
                <div className="bg-sky-50 rounded-2xl p-3">
                  <p className="text-[11px] text-slate-500">سود خالص کل</p>
                  <b className="text-xl text-sky-700">{fa(desk.performance.netPnl)} USDT</b>
                </div>
                <div className="bg-amber-50 rounded-2xl p-3">
                  <p className="text-[11px] text-slate-500">میانگین سود هر معامله</p>
                  <b className="text-xl text-amber-700">{fa(desk.performance.avgPnl)} USDT</b>
                </div>
                <div className="bg-violet-50 rounded-2xl p-3">
                  <p className="text-[11px] text-slate-500">تعداد معاملات</p>
                  <b className="text-xl text-violet-700">{fa(desk.performance.totalTrades, 0)}</b>
                </div>
              </div>
              <p className="text-xs text-slate-500 mt-3 leading-6">
                {fa(desk.performance.wins, 0)} برد / {fa(desk.performance.losses, 0)} باخت •
                بهترین معامله {fa(desk.performance.bestTrade)} USDT • نتایج بستهشدن
                خودکار به لیگ کارمندان هم ارسال میشود.
              </p>
            </section>

            {/* تنظیمات */}
            <section className="bg-white border rounded-3xl p-5">
              <div className="flex justify-between items-center">
                <h2 className="font-black">⚙️ تنظیمات اختصاصی ایجنت</h2>
                <button
                  onClick={() => setShowSettings(!showSettings)}
                  className="text-xs border px-3 py-1 rounded-full font-bold"
                >
                  {showSettings ? "بستن" : "ویرایش"}
                </button>
              </div>
              {!showSettings ? (
                <div className="text-xs mt-3 space-y-1.5 text-slate-600">
                  <p>کلید فعال: <b>{desk.config.enabled ? "🟢 فعال" : "💤 غیرفعال"}</b></p>
                  <p>سقف سرمایه هر معامله: <b>{fa(desk.config.maxPositionUsdt, 0)} USDT</b></p>
                  <p>حداکثر اهرم: <b>{fa(desk.config.maxLeverage, 0)}x</b></p>
                  <p>حداقل R/R: <b>۱ به {fa(desk.config.minRiskReward)}</b></p>
                  <p>بستن خودکار: <b>{desk.config.autoClose ? "✅ فعال" : "❌ غیرفعال"}</b></p>
                  <p>حالت اجرا: <b>{desk.config.mode === "live" ? "LIVE" : "Paper"}</b></p>
                </div>
              ) : (
                <form onSubmit={saveSettings} className="mt-3 space-y-2">
                  <label className="flex justify-between items-center text-xs font-bold bg-slate-50 rounded-xl p-2.5">
                    ایجنت فعال باشد
                    <input
                      type="checkbox"
                      checked={Boolean(c.enabled)}
                      onChange={(e) => setCfg({ ...c, enabled: e.target.checked })}
                    />
                  </label>
                  <label className="flex justify-between items-center text-xs font-bold bg-slate-50 rounded-xl p-2.5">
                    بستن خودکار TP/SL
                    <input
                      type="checkbox"
                      checked={Boolean(c.autoClose)}
                      onChange={(e) => setCfg({ ...c, autoClose: e.target.checked })}
                    />
                  </label>
                  {(
                    [
                      ["maxPositionUsdt", "سقف سرمایه هر معامله (USDT)"],
                      ["capitalUsdt", "سرمایهٔ تخصیصیافته (USDT)"],
                      ["maxLeverage", "حداکثر اهرم مجاز"],
                      ["minRiskReward", "حداقل نسبت سود/ریسک"],
                      ["minConfidence", "آستانهٔ اطمینان (٪)"],
                      ["maxRiskUsdt", "حداکثر ریسک هر معامله (USDT)"],
                      ["maxHoldHours", "حداکثر ماندگاری (ساعت)"],
                      ["maxVolatilityPct", "سقف نوسان مجاز (٪)"],
                    ] as const
                  ).map(([k, label]) => (
                    <label key={k} className="block text-[11px] font-bold">
                      {label}
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        value={c[k] ?? ""}
                        onChange={(e) => setCfg({ ...c, [k]: Number(e.target.value) })}
                        className="w-full border rounded-xl p-2 mt-1 font-normal"
                      />
                    </label>
                  ))}
                  <label className="block text-[11px] font-bold">
                    جفتارز تحت رصد
                    <input
                      value={c.symbol || ""}
                      onChange={(e) => setCfg({ ...c, symbol: e.target.value })}
                      dir="ltr"
                      className="w-full border rounded-xl p-2 mt-1 font-normal"
                    />
                  </label>
                  <label className="block text-[11px] font-bold">
                    حالت اجرا
                    <select
                      value={c.mode || "paper"}
                      onChange={(e) => setCfg({ ...c, mode: e.target.value })}
                      className="w-full border rounded-xl p-2 mt-1 font-normal"
                    >
                      <option value="paper">📝 Paper (پیشفرض امن)</option>
                      <option value="live" disabled={!desk.credentialsPresent}>
                        🔴 LIVE {desk.credentialsPresent ? "" : "(نیازمند کلید صرافی)"}
                      </option>
                    </select>
                  </label>
                  <button
                    disabled={busy}
                    className="w-full bg-slate-900 text-white py-2.5 rounded-xl font-bold text-sm disabled:opacity-50"
                  >
                    ذخیرهٔ تنظیمات ✅
                  </button>
                </form>
              )}
            </section>

            {/* دفترچه خاطرات */}
            <section className="bg-white border rounded-3xl p-5">
              <h2 className="font-black">🧠 دفترچه خاطرات و لاگ تحلیل (Brain Dump)</h2>
              <div className="space-y-2 mt-3 max-h-[420px] overflow-y-auto">
                {(desk.journal || []).map((j: any) => (
                  <div key={j.id} className="border rounded-2xl p-3">
                    <div className="flex justify-between items-center gap-2">
                      <b className="text-xs">
                        {JOURNAL_ICON[j.kind] || "📝"} {j.kind}
                      </b>
                      <span className="text-[10px] text-slate-400">{time(j.createdAt)}</span>
                    </div>
                    <p className="text-xs text-slate-600 mt-1.5 leading-6">{j.text}</p>
                  </div>
                ))}
                {(desk.journal || []).length === 0 && (
                  <p className="text-sm text-slate-400 text-center py-6">یادداشتی ثبت نشده است</p>
                )}
              </div>
            </section>
          </div>
        </div>

        {/* متدولوژی و هشدار */}
        <section className="bg-[#0B1220] text-white rounded-3xl p-5 text-xs leading-7">
          <h2 className="font-black text-base">🧠 موتور مدیریت ریسک اهرمدار و صداقت اجرا</h2>
          <ul className="list-disc pr-5 mt-2 space-y-1 text-slate-300">
            <li>
              <b>اهرم پویا:</b> بر اساس فاصلهٔ حد ضرر (≤۱٪ → 5x، ≤۲٪ → 3x، بیشتر → 2x)،
              محدود به <span dir="ltr">trader_max_leverage</span> و سقف ریسک ریالی{" "}
              {fa(desk.config.maxRiskUsdt, 0)} USDT در هر معامله.
            </li>
            <li>
              <b>R/R حداقل ۱ به ۲:</b> حد سود و ضرر از سطوح حمایت/مقاومت واقعی استخراج
              میشود؛ اگر نسبت حاصل نشود، ایجنت اصلاً پیشنهادی نمیدهد.
            </li>
            <li>
              <b>فیلتر هیجان:</b> ترس/طمع خارج از {fa(desk.config.minFearGreed, 0)}–
              {fa(desk.config.maxFearGreed, 0)}، نوسان بالای {fa(desk.config.maxVolatilityPct)}٪،
              RSI اشباع، اخبار منفی یا اطمینان کمتر از{" "}
              {fa(desk.config.minConfidence, 0)}٪ ⇒ صرفنظر + ثبت دلیل در دفترچه.
            </li>
            <li>
              <b>HITL:</b> هیچ معاملهای بدون تأیید شما (دکمهٔ تلگرام یا میز کار) باز نمیشود؛
              دکمهها <span dir="ltr">trade_approve / trade_reject</span> در Webhook پردازش میشوند.
            </li>
            <li>
              <b>بستن خودکار:</b> هر بار که میز کار باز یا Cron/tick اجرا شود، پوزیشنها با
              قیمت واقعی Mark-to-Market شده و روی TP، SL، خروج اضطراری یا سقف{" "}
              {fa(desk.config.maxHoldHours, 0)} ساعت بسته میشوند؛ گزارش نهایی به تلگرام و
              لیگ کارمندان ارسال میشود.
            </li>
            <li className="text-amber-300">
              <b>⚠️ واقعیت مالی:</b> دادهٔ بازار، اندیکاتورها، کارت HITL و PnL واقعیِ قیمتی
              هستند، ولی حالت پیشفرض <b>Paper Trading</b> است: سفارشی به صرافی نمیرود و
              سودی به کیف پول واریز نمیشود. اجرای واقعی فقط با{" "}
              <span dir="ltr">EXCHANGE_API_KEY/SECRET</span> +{" "}
              <span dir="ltr">trader_mode=live</span> + تأیید انسانی فعال میشود. معاملات
              اهرمدار ریسک از دست دادن سرمایه دارند.
            </li>
          </ul>
        </section>
      </main>

      {toast && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 bg-slate-900 text-white px-5 py-3 rounded-full shadow-2xl z-[60] font-bold text-sm max-w-[90vw] text-center">
          {toast}
        </div>
      )}
    </div>
  );
}
