"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: any) {
    e.preventDefault();
    setLoading(true);
    setErr("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      // ⭐ پاسخ ممکن است بدنه نداشته باشد (خطای سرور یا قطع اتصال).
      // نباید مستقیم res.json() را صدا بزنیم وگرنه کاربر پیام
      // فنی «Unexpected end of JSON input» می‌بیند.
      const raw = await res.text();
      let d: any = null;
      if (raw.trim()) {
        try {
          d = JSON.parse(raw);
        } catch {
          d = null;
        }
      }

      if (!res.ok) {
        setErr(
          d?.error ||
            (res.status === 503
              ? "سرویس موقتاً در دسترس نیست. لطفاً چند لحظه بعد دوباره تلاش کنید."
              : `ورود ناموفق بود (کد ${res.status})`)
        );
        return;
      }
      if (!d?.user) {
        setErr("پاسخ نامعتبر از سرور دریافت شد. لطفاً دوباره تلاش کنید.");
        return;
      }
      router.push("/control");
    } catch (e: any) {
      setErr(
        e?.name === "TypeError"
          ? "ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی کنید."
          : e?.message || "خطای ناشناخته"
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main dir="rtl" className="flex min-h-screen items-center justify-center bg-[#070C16] p-4">
      <form onSubmit={submit} className="w-full max-w-md rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-white shadow-2xl backdrop-blur">
        <div className="text-center text-5xl">🏢</div>
        <h1 className="mt-3 text-center text-2xl font-black">ورود مدیرعامل</h1>
        <p className="mt-1 text-center text-[11px] text-slate-400">Agent Company OS — دفتر مستقل هر کارمند</p>

        {err && <p className="mt-4 rounded-xl bg-red-500/15 p-3 text-xs text-red-300">{err}</p>}

        <label className="mt-6 block text-xs font-bold text-slate-300">ایمیل</label>
        <input
          required
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-sm"
          dir="ltr"
          autoComplete="username"
        />

        <label className="mt-4 block text-xs font-bold text-slate-300">رمز عبور</label>
        <input
          required
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-sm"
          dir="ltr"
          autoComplete="current-password"
        />

        <button
          disabled={loading}
          className="mt-6 w-full rounded-xl bg-emerald-500 py-3 font-black text-black transition hover:bg-emerald-400 disabled:opacity-50"
        >
          {loading ? "در حال بررسی…" : "ورود به ساختمان ←"}
        </button>

        <p className="mt-4 text-center text-[10px] leading-5 text-slate-500">
          نشست با کوکی HttpOnly امضا می‌شود. مشخصات ورود از متغیرهای ADMIN_EMAIL و ADMIN_PASSWORD خوانده می‌شود.
        </p>
      </form>
    </main>
  );
}
