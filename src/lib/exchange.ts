/**
 * 💱 آداپتور اجرای معامله
 * ---------------------------------------------------------------------------
 * پیشفرض و ایمن: `paper` — پوزیشنها با قیمت واقعی بازار Mark-to-Market میشوند،
 * ولی هیچ سفارشی به صرافی ارسال نمیشود و هیچ پولی جابهجا نمیشود.
 *
 * حالت `live` فقط زمانی فعال میشود که هر سه شرط برقرار باشند:
 *   1) تنظیمات ایجنت `trader_mode=live` باشد،
 *   2) `EXCHANGE_API_KEY` و `EXCHANGE_API_SECRET` در محیط ست شده باشند،
 *   3) کاربر قبلاً پیشنهاد معامله را با HITL تأیید کرده باشد.
 * در غیر این صورت اجرا به paper برمیگردد و دلیلش در دفترچهٔ ایجنت ثبت میشود.
 * سفارشات زنده روی Binance USD-M Futures با امضای HMAC-SHA256 ارسال میشوند؛
 * کلیدها هرگز در DB یا پاسخ API ذخیره/نمایش داده نمیشوند.
 */

import { createHmac } from "crypto";

export type ExecMode = "paper" | "live";

export type OrderRequest = {
  symbol: string;
  side: "LONG" | "SHORT";
  sizeUsdt: number;
  price: number;
  leverage: number;
  reduceOnly?: boolean;
  quantity?: number;
};

export type OrderResult = {
  ok: boolean;
  mode: ExecMode;
  orderId?: string;
  quantity: number;
  reason?: string;
};

const FUTURES_BASE =
  process.env.EXCHANGE_FUTURES_BASE || "https://fapi.binance.com";

export function liveCredentialsPresent(): boolean {
  return Boolean(process.env.EXCHANGE_API_KEY && process.env.EXCHANGE_API_SECRET);
}

function sym(symbol: string) {
  return symbol.replace("/", "").replace("-", "").toUpperCase();
}

async function signed(
  path: string,
  params: Record<string, string | number>,
  method: "GET" | "POST" | "DELETE" = "POST"
): Promise<any> {
  const key = process.env.EXCHANGE_API_KEY!;
  const secret = process.env.EXCHANGE_API_SECRET!;
  const query = new URLSearchParams({
    ...Object.fromEntries(
      Object.entries(params).map(([k, v]) => [k, String(v)])
    ),
    timestamp: String(Date.now()),
    recvWindow: "5000",
  });
  const signature = createHmac("sha256", secret)
    .update(query.toString())
    .digest("hex");
  query.set("signature", signature);
  const url = `${FUTURES_BASE}${path}?${query.toString()}`;
  const res = await fetch(url, {
    method,
    headers: { "X-MBX-APIKEY": key },
    signal: AbortSignal.timeout(6000),
    cache: "no-store",
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok || body?.code) {
    throw new Error(body?.msg || `exchange HTTP ${res.status}`);
  }
  return body;
}

async function lotStep(symbol: string): Promise<number> {
  try {
    const info = await fetch(
      `${FUTURES_BASE}/fapi/v1/exchangeInfo?symbol=${sym(symbol)}`,
      { signal: AbortSignal.timeout(4000), cache: "no-store" }
    ).then((r) => r.json());
    const filter = info?.symbols?.[0]?.filters?.find(
      (f: any) => f.filterType === "LOT_SIZE"
    );
    return Number(filter?.stepSize || 0.001);
  } catch {
    return 0.001;
  }
}

function roundDown(qty: number, step: number) {
  if (!step) return qty;
  return Math.floor(qty / step) * step;
}

export async function placeOrder(
  req: OrderRequest,
  requestedMode: ExecMode
): Promise<OrderResult> {
  const quantity =
    req.quantity || roundDown((req.sizeUsdt * req.leverage) / req.price, await lotStep(req.symbol));

  if (requestedMode !== "live") {
    return { ok: true, mode: "paper", orderId: `paper-${Date.now()}`, quantity };
  }
  if (!liveCredentialsPresent()) {
    return {
      ok: true,
      mode: "paper",
      orderId: `paper-${Date.now()}`,
      quantity,
      reason: "حالت Live انتخاب شده ولی کلیدهای EXCHANGE_API_* تنظیم نشدهاند → اجرای امن Paper",
    };
  }

  try {
    await signed("/fapi/v1/leverage", {
      symbol: sym(req.symbol),
      leverage: req.leverage,
    });
    const openSide = req.side === "LONG" ? "BUY" : "SELL";
    const closeSide = req.side === "LONG" ? "SELL" : "BUY";
    const body = await signed("/fapi/v1/order", {
      symbol: sym(req.symbol),
      side: req.reduceOnly ? closeSide : openSide,
      type: "MARKET",
      quantity: String(quantity),
      ...(req.reduceOnly ? { reduceOnly: "true" } : {}),
    });
    return {
      ok: true,
      mode: "live",
      orderId: String(body?.orderId || ""),
      quantity,
    };
  } catch (e) {
    return {
      ok: false,
      mode: "live",
      quantity,
      reason: e instanceof Error ? e.message : "خطای نامشخص صرافی",
    };
  }
}
