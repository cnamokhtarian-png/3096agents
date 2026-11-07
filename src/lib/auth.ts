import { NextRequest } from "next/server";
import { verifySession } from "@/lib/seed";
import { conf } from "@/lib/config";

export type SessionUser = { id: number; email: string; name: string };

/** کاربر مدیرعامل از روی کوکی HttpOnly نشست. */
export function currentUser(req: NextRequest): SessionUser | null {
  const token = req.cookies.get("session")?.value;
  if (!token) return null;
  return verifySession(token) as SessionUser | null;
}

/**
 * محافظت از عملیات حساس (تأیید کار، تغییر کیف پول، ارسال تلگرام).
 * پاسخ null یعنی اجازه دارد؛ در غیر این صورت یک Response آماده برگردانید.
 */
export function guardAdmin(req: NextRequest): Response | null {
  if (currentUser(req)) return null;
  // اجازه‌ی ماشین‌به‌ماشین با سکرت عملیاتی (برای اسکریپت‌های خودکار مدیر)
  const opSecret = conf("ADMIN_API_SECRET");
  const header = req.headers.get("x-admin-secret");
  if (opSecret && header && header === opSecret) return null;
  return Response.json(
    { error: "دسترسی غیرمجاز — ابتدا به عنوان مدیرعامل وارد شوید", code: "unauthorized" },
    { status: 401 }
  );
}

export function actorOf(req: NextRequest): string {
  const u = currentUser(req);
  if (u) return u.name || u.email;
  if (req.headers.get("x-admin-secret")) return "admin-api-secret";
  return "unknown";
}
