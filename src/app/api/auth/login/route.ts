import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureSeed, hashPw, signSession, verifySession } from "@/lib/seed";

export async function POST(req: NextRequest) {
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
