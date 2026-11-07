import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureSeed, hashPw, signSession, verifySession } from "@/lib/seed";
import { conf } from "@/lib/config";

const attempts = new Map<string, { count: number; resetAt: number }>();

function rateLimited(ip: string) {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || rec.resetAt < now) {
    attempts.set(ip, { count: 1, resetAt: now + 10 * 60_000 });
    return false;
  }
  rec.count += 1;
  return rec.count > 12;
}

export async function POST(req: NextRequest) {
  // کلید امضا از لایه‌ی پیکربندی پایدار خوانده می‌شود (env → config.json → .env.local)
  if (!conf("AUTH_SECRET") && process.env.NODE_ENV === "production") {
    return NextResponse.json(
      {
        error: "AUTH_SECRET روی سرور ست نشده است؛ ورود امن غیرفعال است.",
        code: "auth_secret_missing",
      },
      { status: 503 },
    );
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  if (rateLimited(ip)) {
    return NextResponse.json(
      {
        error: "تلاش‌های ناموفق زیاد؛ ۱۰ دقیقه بعد دوباره امتحان کنید.",
        code: "rate_limited",
      },
      { status: 429 },
    );
  }

  // بدنه‌ی ورودی ممکن است خراب باشد؛ نباید کل route را بشکند.
  let body: { email?: string; password?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "درخواست نامعتبر است.", code: "bad_request" },
      { status: 400 },
    );
  }

  const email = String(body?.email || "")
    .trim()
    .toLowerCase();
  const password = String(body?.password || "");
  if (!email || !password) {
    return NextResponse.json(
      { error: "ایمیل و رمز عبور را وارد کنید.", code: "missing_fields" },
      { status: 400 },
    );
  }

  try {
    await ensureSeed();

    const rows = await db.select().from(users).where(eq(users.email, email));
    const u = rows[0];
    if (!u || u.passwordHash !== hashPw(password)) {
      return NextResponse.json(
        { error: "ایمیل یا رمز عبور اشتباه است", code: "invalid_credentials" },
        { status: 401 },
      );
    }

    const token = signSession({ id: u.id, email: u.email, name: u.name });
    const res = NextResponse.json({
      ok: true,
      user: { id: u.id, email: u.email, name: u.name, role: u.role },
    });
    res.cookies.set("session", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
    return res;
  } catch (e: any) {
    // ⭐ مهم: هرگز بدنه‌ی خالی برنمی‌گردانیم. پاسخ خالی باعث می‌شود
    // مرورگر با «Unexpected end of JSON input» کرش کند و کاربر
    // هیچ دلیلی برای خطا نبیند.
    const detail = e?.message || String(e);
    console.error("login error:", detail);
    return NextResponse.json(
      {
        error:
          "اتصال به پایگاه داده برقرار نشد. لطفاً چند لحظه بعد دوباره تلاش کنید یا از مدیر سیستم بخواهید وضعیت دیتابیس را بررسی کند.",
        code: "database_unavailable",
        detail: process.env.NODE_ENV === "production" ? undefined : detail,
      },
      { status: 503 },
    );
  }
}

export async function GET(req: NextRequest) {
  const c = req.cookies.get("session")?.value;
  if (!c) return NextResponse.json({ user: null });
  const user = verifySession(c);
  return NextResponse.json({ user });
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set("session", "", {
    httpOnly: true,
    path: "/",
    maxAge: 0,
  });
  return res;
}
