import { createHmac, randomUUID } from "crypto";
import { ConfigError, ENV } from "@/lib/env";
import { conf } from "@/lib/config";

/**
 * کلاینت واقعی صرافی Binance Spot (سازگار با Testnet).
 *
 * - قیمت‌ها از اندپوینت عمومی خوانده می‌شوند (بدون کلید).
 * - موجودی و سفارش با امضای HMAC SHA256 ارسال می‌شوند.
 * - هیچ سفارشی «شبیه‌سازی» نمی‌شود: اگر کلید یا مجوز نباشد خطای صریح
 *   برمی‌گردد. برای جلوگیری از معامله ناخواسته، متغیر AGENT_TRADING_ENABLED
 *   باید صریحاً true باشد.
 */

const LIVE_BASE = "https://api.binance.com";
const TESTNET_BASE = "https://testnet.binance.vision";

export type PriceQuote = {
  symbol: string;
  price: number;
  changePct: number | null;
  source: string;
  fetchedAt: string;
};

export type ExchangeOrderResult = {
  exchange: "binance";
  testnet: boolean;
  symbol: string;
  side: "BUY" | "SELL";
  status: string;
  orderId: string;
  clientOrderId: string;
  executedQty: string;
  cummulativeQuoteQty: string;
  fills?: unknown;
  raw?: unknown;
  simulated: false;
};

export class ExchangeError extends Error {
  status = 502;
  code: string;
  detail?: unknown;
  constructor(message: string, code = "exchange_error", detail?: unknown) {
    super(message);
    this.code = code;
    this.detail = detail;
  }
}

function baseUrl(testnet = ENV.exchangeTestnet()) {
  // امکان تست/پروکسی: EXCHANGE_BASE_URL روی هر اندپوینت سازگار Binance
  const override = conf("EXCHANGE_BASE_URL").replace(/\/$/, "");
  if (override) return override;
  return testnet ? TESTNET_BASE : LIVE_BASE;
}

function publicBaseUrl() {
  return conf("EXCHANGE_BASE_URL").replace(/\/$/, "") || LIVE_BASE;
}

export function exchangeStatus() {
  const hasKeys = Boolean(ENV.exchangeKey() && ENV.exchangeSecret());
  const testnet = ENV.exchangeTestnet();
  return {
    exchange: "binance",
    network: testnet ? "testnet" : "mainnet",
    keysConfigured: hasKeys,
    tradingEnabled: ENV.tradingEnabled(),
    mode: !hasKeys ? "read-only" : ENV.tradingEnabled() ? (testnet ? "testnet-trading" : "live-trading") : "read-only",
    message: !hasKeys
      ? "کلید API صرافی ست نشده است؛ فقط خواندن قیمت عمومی ممکن است."
      : ENV.tradingEnabled()
      ? `سفارش‌های واقعی روی ${testnet ? "Testnet" : "Mainnet"} ارسال می‌شوند.`
      : "کلیدها ست شده‌اند اما AGENT_TRADING_ENABLED=true نیست؛ ارسال سفارش قفل است.",
  };
}

function assertTradingAllowed() {
  const missing: string[] = [];
  if (!ENV.exchangeKey()) missing.push("EXCHANGE_API_KEY");
  if (!ENV.exchangeSecret()) missing.push("EXCHANGE_SECRET_KEY");
  if (!ENV.tradingEnabled()) missing.push("AGENT_TRADING_ENABLED=true");
  if (missing.length) {
    throw new ConfigError(
      "معامله واقعی فعال نیست. ابتدا کلیدهای صرافی و AGENT_TRADING_ENABLED را تنظیم کنید.",
      missing,
      "exchange_trading_disabled"
    );
  }
}

async function timedFetch(url: string, init: RequestInit = {}, timeoutMs = 9000) {
  try {
    return await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  } catch (e: any) {
    const reason = e?.name === "TimeoutError" ? "timeout" : e?.message || "network error";
    throw new ExchangeError(`اتصال به صرافی برقرار نشد (${reason})`, "exchange_unreachable");
  }
}

/** قیمت عمومی یک یا چند نماد — Binance با فالبک OKX. */
export async function fetchPublicPrices(symbols: string[]): Promise<PriceQuote[]> {
  const list = symbols.map((s) => s.toUpperCase());
  const now = new Date().toISOString();

  // ۱) Binance
  try {
    const q = encodeURIComponent(JSON.stringify(list));
    const res = await timedFetch(`${publicBaseUrl()}/api/v3/ticker/24hr?symbols=${q}`, {}, 7000);
    if (res.ok) {
      const arr: any[] = await res.json();
      if (Array.isArray(arr) && arr.length) {
        return arr.map((t) => ({
          symbol: String(t.symbol),
          price: Number(t.lastPrice),
          changePct: t.priceChangePercent !== undefined ? Number(t.priceChangePercent) : null,
          source: "binance",
          fetchedAt: now,
        }));
      }
    }
  } catch {
    // ادامه با فالبک
  }

  // ۲) OKX
  try {
    const out: PriceQuote[] = [];
    for (const sym of list) {
      const instId = sym.replace(/USDT$/, "-USDT");
      const res = await timedFetch(
        `https://www.okx.com/api/v5/market/ticker?instId=${encodeURIComponent(instId)}`,
        {},
        7000
      );
      if (!res.ok) continue;
      const j: any = await res.json();
      const t = j?.data?.[0];
      if (!t) continue;
      const last = Number(t.last);
      const open = Number(t.open24h);
      out.push({
        symbol: sym,
        price: last,
        changePct: open > 0 ? ((last - open) / open) * 100 : null,
        source: "okx",
        fetchedAt: now,
      });
    }
    if (out.length) return out;
  } catch {
    // هیچ منبعی در دسترس نیست
  }

  throw new ExchangeError("هیچ منبع قیمت واقعی در دسترس نیست (Binance/OKX)", "price_unavailable");
}

function sign(query: string) {
  const secret = ENV.exchangeSecret();
  if (!secret) throw new ConfigError("EXCHANGE_SECRET_KEY ست نشده است", ["EXCHANGE_SECRET_KEY"]);
  return createHmac("sha256", secret).update(query).digest("hex");
}

async function signedRequest(method: "GET" | "POST", path: string, params: Record<string, string | number> = {}) {
  assertTradingAllowed();
  const key = ENV.exchangeKey();
  const query = new URLSearchParams({
    ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
    timestamp: String(Date.now()),
    recvWindow: "5000",
  }).toString();
  const signature = sign(query);
  const url = `${baseUrl()}${path}?${query}&signature=${signature}`;
  const res = await timedFetch(url, {
    method,
    headers: { "X-MBX-APIKEY": key, "Content-Type": "application/json" },
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const msg = json?.msg || `HTTP ${res.status}`;
    throw new ExchangeError(`صرافی خطا برگرداند: ${msg}`, "exchange_rejected", {
      status: res.status,
      code: json?.code,
      msg,
    });
  }
  return json;
}

export async function getAccountBalances(assets = ["USDT"]) {
  const acc = await signedRequest("GET", "/api/v3/account");
  const wanted = new Set(assets.map((a) => a.toUpperCase()));
  const balances = (acc?.balances || [])
    .filter((b: any) => wanted.has(String(b.asset).toUpperCase()))
    .map((b: any) => ({
      asset: b.asset,
      free: Number(b.free),
      locked: Number(b.locked),
      total: Number(b.free) + Number(b.locked),
    }));
  return { canTrade: Boolean(acc?.canTrade), balances, accountType: acc?.accountType ?? null };
}

export type PlaceOrderInput = {
  symbol: string;
  side: "BUY" | "SELL";
  type?: "MARKET" | "LIMIT";
  quantity?: number;
  quoteOrderQty?: number;
  price?: number;
  testnet?: boolean;
};

/**
 * ارسال سفارش واقعی. clientOrderId برای idempotency ساخته می‌شود.
 */
export async function placeRealOrder(input: PlaceOrderInput): Promise<ExchangeOrderResult> {
  assertTradingAllowed();
  const symbol = input.symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!symbol) throw new ExchangeError("نماد معاملاتی نامعتبر است", "invalid_symbol");

  const type = input.type || "MARKET";
  const clientOrderId = `ag${Date.now().toString(36)}${randomUUID().slice(0, 6)}`;

  const params: Record<string, string | number> = {
    symbol,
    side: input.side,
    type,
    newClientOrderId: clientOrderId,
  };
  if (type === "MARKET") {
    if (input.quoteOrderQty && input.quoteOrderQty > 0) params.quoteOrderQty = input.quoteOrderQty;
    else if (input.quantity && input.quantity > 0) params.quantity = input.quantity;
    else throw new ExchangeError("مقدار سفارش مشخص نشده است", "missing_quantity");
  } else {
    if (!input.quantity || input.quantity <= 0) throw new ExchangeError("مقدار سفارش مشخص نشده است", "missing_quantity");
    if (!input.price || input.price <= 0) throw new ExchangeError("قیمت سفارش مشخص نشده است", "missing_price");
    params.quantity = input.quantity;
    params.price = input.price;
    params.timeInForce = "GTC";
  }

  const json = await signedRequest("POST", "/api/v3/order", params);
  return {
    exchange: "binance",
    testnet: ENV.exchangeTestnet(),
    symbol,
    side: input.side,
    status: String(json?.status || "UNKNOWN"),
    orderId: String(json?.orderId || ""),
    clientOrderId,
    executedQty: String(json?.executedQty ?? "0"),
    cummulativeQuoteQty: String(json?.cummulativeQuoteQty ?? "0"),
    fills: json?.fills,
    raw: json,
    simulated: false,
  };
}

/** تست اتصال واقعی: قیمت + (اگر کلید باشد) موجودی. */
export async function testExchangeConnection() {
  const result: {
    prices?: PriceQuote[];
    account?: Awaited<ReturnType<typeof getAccountBalances>>;
    priceError?: string;
    accountError?: string;
  } = {};
  try {
    result.prices = await fetchPublicPrices(["BTCUSDT"]);
  } catch (e: any) {
    result.priceError = e?.message || "price error";
  }
  if (ENV.exchangeKey() && ENV.exchangeSecret()) {
    try {
      result.account = await getAccountBalances(["USDT", "BTC"]);
    } catch (e: any) {
      result.accountError = e?.message || "account error";
    }
  }
  return result;
}
