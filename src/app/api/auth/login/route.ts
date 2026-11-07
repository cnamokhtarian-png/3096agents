import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureSeed, hashPw, signSession, verifySession } from "@/lib/seed";

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
  if (!process.env.AUTH_SECRET && process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "AUTH_SECRET روی سرور ست نشده است؛ ورود امن غیرفعال است." },
      { status: 503 }
    );
  }
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  if (rateLimited(ip)) {
    return NextResponse.json(
      { error: "تلاش‌های ناموفق زیاد؛ ۱۰ دقیقه بعد دوباره امتحان کنید." },
      { status: 429 }
    );
  }
  await ensureSeed();
  const { email, password } = await req.json();
  const rows = await db.select().from(users).where(eq(users.email, email));
  const u = rows[0];
  if (!u || u.passwordHash !== hashPw(password || "")) {
    return NextResponse.json(
      { error: "ایمیل یا رمز عبور اشتباه است" },
      { status: 401 }
    );
  }
  const token = signSession({ id: u.id, email: u.email, name: u.name });
  const res = NextResponse.json({
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
