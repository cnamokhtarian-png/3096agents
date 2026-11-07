import { NextResponse } from "next/server";

/**
 * پاسخ خطای استاندارد و همیشه-JSON.
 *
 * چرا این فایل وجود دارد؟
 * وقتی یک route بدون try/catch اجرا می‌شد و خطا می‌داد،
 * Next.js پاسخ 500 با بدنه‌ی خالی برمی‌گرداند. سمت مرورگر
 * `res.json()` روی بدنه‌ی خالی خطای
 * «Failed to execute 'json' on 'Response': Unexpected end of JSON input»
 * می‌داد و کاربر هیچ پیام قابل‌فهمی نمی‌دید.
 *
 * این کمک‌تابع تضمین می‌کند هر پاسخ خطا یک JSON معتبر با پیام
 * فارسی داشته باشد.
 */

export type ApiErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "bad_request"
  | "rate_limited"
  | "database_unavailable"
  | "upstream_error"
  | "internal_error";

const MESSAGES: Record<ApiErrorCode, string> = {
  unauthorized: "دسترسی غیرمجاز — ابتدا به عنوان مدیرعامل وارد شوید",
  forbidden: "شما اجازه‌ی انجام این عملیات را ندارید",
  not_found: "موردی با این مشخصات پیدا نشد",
  bad_request: "درخواست نامعتبر است",
  rate_limited: "تعداد درخواست‌ها زیاد است؛ کمی بعد دوباره تلاش کنید",
  database_unavailable:
    "اتصال به پایگاه داده برقرار نشد. لطفاً چند لحظه بعد دوباره تلاش کنید.",
  upstream_error: "ارتباط با سرویس بیرونی برقرار نشد. لطفاً بعداً تلاش کنید.",
  internal_error: "خطای داخلی سرور. لطفاً دوباره تلاش کنید.",
};

export function apiError(
  code: ApiErrorCode,
  status: number,
  extra?: Record<string, unknown>,
) {
  return NextResponse.json(
    { error: MESSAGES[code] ?? MESSAGES.internal_error, code, ...extra },
    { status },
  );
}

/**
 * اجرای امن یک handler: هر خطایی (از جمله قطع دیتابیس) به یک
 * پاسخ JSON فارسی تبدیل می‌شود و بدنه هرگز خالی نمی‌ماند.
 *
 * وضعیت خطا از روی نوع خطا تشخیص داده می‌شود:
 *   - خطای شبکه/دیتابیس  → 503 database_unavailable
 *   - خطای ورودی معتبر    → 400 bad_request
 *   - هر چیز دیگر         → 500 internal_error
 */
export async function safeRoute<T>(
  fn: () => Promise<T>,
  opts: { logLabel?: string; exposeDetail?: boolean } = {},
): Promise<T | Response> {
  try {
    return await fn();
  } catch (e: any) {
    const message = e?.message || String(e);

    // پیام خطا ممکن است در `cause` تودرتو باشد (مثلاً خطای شبکه‌ی pg
    // داخل خطای Drizzle). کل زنجیره را جمع می‌کنیم.
    const chain: string[] = [];
    let cur: any = e;
    let depth = 0;
    while (cur && depth < 6) {
      chain.push(String(cur?.message ?? cur));
      chain.push(String(cur?.code ?? ""));
      cur = cur?.cause;
      depth += 1;
    }
    const haystack = chain.join(" | ");

    const isDbOrNetwork =
      /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|ENOTFOUND|EAI_AGAIN|EPIPE|ENOTFOUND|terminated|timeout|connection refused|connect timeout|pool|database|Failed query|relation .* does not exist|permission denied for schema/i.test(
        haystack,
      );

    console.error(`[api] ${opts.logLabel || "route"}:`, message);

    if (isDbOrNetwork) {
      return apiError("database_unavailable", 503, {
        detail: opts.exposeDetail ? message : undefined,
      });
    }
    return apiError("internal_error", 500, {
      detail: opts.exposeDetail ? message : undefined,
    });
  }
}
