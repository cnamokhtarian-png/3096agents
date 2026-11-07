export default function Home() {
  return (
    <main
      dir="rtl"
      className="min-h-screen bg-[#0B1220] text-white flex flex-col items-center justify-center p-6 text-center"
    >
      <div className="inline-flex items-center gap-2 bg-emerald-500/15 border border-emerald-400/30 text-emerald-300 px-4 py-1.5 rounded-full text-xs font-bold mb-5">
        <span>🪙 کارمند رمزارز + ناوگان ایجنت‌ها + واریز به کیف پول واحد</span>
      </div>
      <div className="text-6xl mb-4">🤖</div>
      <h1 className="text-4xl md:text-6xl font-black leading-tight max-w-3xl">
        مرکز کنترل <span className="text-emerald-400">ناوگان ایجنت‌های درآمدزا</span>
      </h1>
      <p className="text-slate-300 mt-4 max-w-2xl leading-8">
        مجموعه‌ای از ایجنت‌های تخصصی (کارمند رمزارز و آربیتراژ، توسعه‌دهنده Next.js،
        ایجنت فروش تلگرام و وب‌هوک API خارجی) که همگی درآمد USDT خود را به{" "}
        <b className="text-emerald-300">یک کیف پول واحد مرکزی</b> واریز می‌کنند.
      </p>
      <div className="flex gap-3 mt-8 flex-wrap justify-center">
        <a
          href="/control"
          className="bg-emerald-500 hover:bg-emerald-400 text-black font-bold px-7 py-3 rounded-2xl transition"
        >
          ورود به مرکز کنترل ←
        </a>
        <a
          href="/login"
          className="border border-white/30 hover:bg-white/10 px-7 py-3 rounded-2xl transition"
        >
          ورود مدیر
        </a>
      </div>
      <div className="flex gap-6 mt-10 text-sm text-slate-300 flex-wrap justify-center">
        <span>🪙 کارمند تخصصی رمزارز</span>
        <span>💳 کیف پول واحد USDT</span>
        <span>🔌 API اختصاصی هر ایجنت</span>
        <span>📩 Webhook تلگرام</span>
        <span>☁️ آماده Supabase & Vercel</span>
      </div>
      <p className="text-xs text-slate-500 mt-8">
        اطلاعات ورود دمو: admin@freelance.ir / admin123
      </p>
    </main>
  );
}
