export default function Home() {
  return (
    <main dir="rtl" className="min-h-screen bg-[#070C16] text-white">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col justify-center px-6 py-14">
        <div className="inline-flex w-fit items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-500/15 px-4 py-1.5 text-xs font-bold text-emerald-300">
          <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
          نسخه عملیاتی — بدون داده ساختگی
        </div>

        <h1 className="mt-6 max-w-3xl text-4xl font-black leading-tight md:text-6xl">
          ساختمان اداری <span className="text-emerald-400">ایجنت‌های درآمدزا</span>
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-8 text-slate-300 md:text-base">
          هر کارمند دیجیتال یک دفتر مستقل، یک هدف مشخص و یک گزارش واقعی دارد. درآمد فقط با
          شاهد تراکنش، سفارش واقعی صرافی یا تأیید شما ثبت می‌شود — هیچ عدد تصادفی در سیستم نیست.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <a
            href="/control"
            className="rounded-2xl bg-emerald-500 px-7 py-3 font-black text-black transition hover:bg-emerald-400"
          >
            ورود مدیرعامل به ساختمان ←
          </a>
          <a
            href="/login"
            className="rounded-2xl border border-white/20 px-7 py-3 font-bold transition hover:bg-white/10"
          >
            ورود با حساب مدیر
          </a>
        </div>

        <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["🏢", "دفتر مستقل هر کارمند", "ورود به اتاق، مشاهده میز کار و گفتگو با ایجنت"],
            ["🏦", "صرافی واقعی", "سفارش با تأیید شما به Binance (Testnet/Mainnet) ارسال می‌شود"],
            ["📩", "تأیید در تلگرام", "دکمه شیشه‌ای ← اجرای واقعی در دیتابیس و صرافی"],
            ["🩺", "دیباگ شفاف", "چک‌لیست env، لاگ خطاها و گزارش هر کارمند"],
          ].map(([icon, title, desc]) => (
            <div key={title} className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
              <div className="text-2xl">{icon}</div>
              <p className="mt-3 text-sm font-black">{title}</p>
              <p className="mt-1 text-[11px] leading-6 text-slate-400">{desc}</p>
            </div>
          ))}
        </div>

        <p className="mt-10 text-[11px] text-slate-500">
          ورود با ADMIN_EMAIL / ADMIN_PASSWORD تنظیم‌شده در Environment Variables انجام می‌شود.
        </p>
      </div>
    </main>
  );
}
