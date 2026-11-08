import { parseTabdealTrades } from "@/lib/tabdeal-fills";
import { normalizeAccountBalances, parseOrderAcknowledgement } from "@/lib/exchange-response";
import { validateTabdealSpotOrder } from "@/lib/tabdeal-order-input";
import { parseTabdealMarket } from "@/lib/tabdeal-market";
import { parseTabdealTopOfBook } from "@/lib/position-monitor";
import { validateTabdealSellOco, type TabdealOcoPlan, type TabdealOcoFilters } from "@/lib/tabdeal-oco";
import { isAllowedSignedRequest } from "@/lib/exchange-request-policy";
import { createHmac, randomUUID } from "crypto";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { ConfigError, ENV } from "@/lib/env";
import { conf } from "@/lib/config";
import type { Candle } from "@/lib/indicators";

/**
 * کلاینت واقعی صرافی Spot (سازگار با Binance Mainnet/Testnet و Tabdeal Spot API).
 *
 * - قیمت‌ها از اندپوینت عمومی خوانده می‌شوند (بدون کلید).
 * - موجودی و سفارش با امضای HMAC SHA256 ارسال می‌شوند.
 * - هیچ سفارشی «شبیه‌سازی» نمی‌شود: اگر کلید یا مجوز نباشد خطای صریح
 *   برمی‌گردد. برای جلوگیری از معامله ناخواسته، متغیر AGENT_TRADING_ENABLED
 *   باید صریحاً فعال باشد و تأیید نهایی مدیرعامل (HITL) انجام شده باشد.
 */

const LIVE_BASE = "https://api.binance.com";
const TESTNET_BASE = "https://testnet.binance.vision";
const TABDEAL_BASE = "https://api1.tabdeal.org";

export type PriceQuote = {
  symbol: string;
  price: number;
  changePct: number | null;
  source: string;
  fetchedAt: string;
};

export type ExchangeOrderResult = {
  exchange: "binance" | "tabdeal";
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

export type ExchangeKeySource = "env" | "db" | "none";

export type ExchangeRuntimeConfig = {
  apiKey: string;
  apiSecret: string;
  exchangeName: "binance" | "tabdeal";
  tradingEnabled: boolean;
  testnet: boolean;
  apiKeySource: ExchangeKeySource;
  apiSecretSource: ExchangeKeySource;
  tradingFlagSource: ExchangeKeySource;
};

/**
 * منبع حقیقت واحد برای وضعیت صرافی.
 * کلیدها از Vercel Env و سپس از پرونده‌ی تنظیمات دیتابیس خوانده می‌شوند
 * (تا با بازنویسی کد گم نشوند) و فلگ AGENT_TRADING_ENABLED هم از هر دو مسیر.
 */
export async function resolveExchangeConfig(): Promise<ExchangeRuntimeConfig> {
  let dbKey = "";
  let dbSecret = "";
  let dbExchange = "";
  let dbTrading = "";
  let dbTestnet = "";
  try {
    const rows = await db.select().from(settings);
    const map = new Map(rows.map((r) => [r.key, r.value]));
    dbKey = (map.get("exchange_api_key") || "").trim();
    dbSecret = (map.get("exchange_api_secret") || "").trim();
    dbExchange = (map.get("exchange_name") || "").trim().toLowerCase();
    dbTrading = (map.get("agent_trading_enabled") || "").trim().toLowerCase();
    dbTestnet = (map.get("exchange_testnet") || "").trim().toLowerCase();
  } catch {
    // در صورت خطای موقت دیتابیس، فقط از متغیرهای محیطی استفاده می‌شود
  }

  const envKey = ENV.exchangeKey();
  const envSecret = ENV.exchangeSecret();
  // باندل کاملِ ذخیره‌شده از پنل (نام صرافی + کلید + سکرت در جدول settings)
  // یک مجموعهٔ منسجم است و بر کلیدهای Env اولویت دارد؛ چون مدیرعامل صرافی را
  // آگاهانه از پنل انتخاب کرده است (مثلاً Tabdeal) و نباید کلیدهای یک صرافی
  // دیگر از Env بی‌صدا جایگزین آن شوند. اگر باندل پنل کامل نباشد، از Env
  // استفاده می‌شود.
  const dbBundleComplete = Boolean(dbKey && dbSecret);
  const apiKey = dbBundleComplete ? dbKey : envKey || dbKey;
  const apiSecret = dbBundleComplete ? dbSecret : envSecret || dbSecret;
  const envEx = conf("EXCHANGE_NAME").trim().toLowerCase();
  const baseOverride = conf("EXCHANGE_BASE_URL").trim().toLowerCase();
  const isTabdeal =
    baseOverride.includes("tabdeal") ||
    envEx === "tabdeal" ||
    (dbBundleComplete && dbExchange === "tabdeal") ||
    (!envEx && !baseOverride && dbExchange === "tabdeal" && !envKey && Boolean(dbKey));

  // اتصال مستقیم به متغیر AGENT_TRADING_ENABLED در Vercel (با پشتیبانی از فلگ دیتابیس)
  const envTrading = ENV.tradingEnabled();
  const dbTradingOn = ["true", "1", "yes", "on"].includes(dbTrading);

  // پیش‌فرض امن: تا وقتی صریحاً تست‌نت خاموش نشده، همه چیز Testnet است.
  // اولویّت با تنظیمی است که مدیرعامل از پنل ذخیره کرده (exchange_testnet)؛
  // سپس متغیر محیطی EXCHANGE_TESTNET؛ برای Mainnet باید صریحاً false شود.)
  const rawTestnet = dbTestnet || conf("EXCHANGE_TESTNET").trim().toLowerCase();
  const testnet = rawTestnet
    ? !["false", "0", "no", "off"].includes(rawTestnet)
    : true;

  return {
    apiKey,
    apiSecret,
    exchangeName: isTabdeal ? "tabdeal" : "binance",
    tradingEnabled: envTrading || dbTradingOn,
    testnet: isTabdeal ? false : testnet,
    apiKeySource: envKey ? "env" : dbKey ? "db" : "none",
    apiSecretSource: envSecret ? "env" : dbSecret ? "db" : "none",
    tradingFlagSource: envTrading ? "env" : dbTradingOn ? "db" : "none",
  };
}

export type ExchangeBlocker = {
  code: "missing_api_key" | "missing_api_secret" | "trading_flag_off";
  label: string;
  missing: string[];
  action: string;
};

export type ExchangeStatus = {
  exchange: "binance" | "tabdeal";
  network: "testnet" | "mainnet";
  keysConfigured: boolean;
  tradingEnabled: boolean;
  /** true یعنی با زدن دکمه تأیید، سفارش واقعاً ارسال می‌شود. */
  canExecuteOrders: boolean;
  mode: "not_configured" | "read-only" | "testnet-trading" | "live-trading";
  keySource: ExchangeKeySource;
  blockers: ExchangeBlocker[];
  message: string;
};

/**
 * وضعیت واقعی صرافی — همیشه از کلیدهای ذخیره‌شده (Env یا دیتابیس) خوانده می‌شود.
 * هیچ مقداری ثابت/نمایشی نیست و همان چیزی است که موتور اجرا هنگام تأیید
 * کار بررسی می‌کند؛ پس پنل و صف تأیید هرگز با هم اختلاف ندارند.
 */
export async function exchangeStatus(): Promise<ExchangeStatus> {
  const cfg = await resolveExchangeConfig();
  const hasKey = Boolean(cfg.apiKey);
  const hasSecret = Boolean(cfg.apiSecret);
  const hasKeys = hasKey && hasSecret;

  const blockers: ExchangeBlocker[] = [];
  if (!hasKey) {
    blockers.push({
      code: "missing_api_key",
      label: "کلید API صرافی (EXCHANGE_API_KEY) ست نشده است",
      missing: ["EXCHANGE_API_KEY"],
      action:
        "در Vercel → Environment Variables مقدار EXCHANGE_API_KEY را وارد و Redeploy کنید (یا از پنل کارمند رمزارز ذخیره کنید).",
    });
  }
  if (!hasSecret) {
    blockers.push({
      code: "missing_api_secret",
      label: "سکرت API صرافی (EXCHANGE_SECRET_KEY) ست نشده است",
      missing: ["EXCHANGE_SECRET_KEY"],
      action:
        "مقدار EXCHANGE_SECRET_KEY (یا EXCHANGE_API_SECRET) را در Environment Variables وارد کنید.",
    });
  }
  if (hasKeys && !cfg.tradingEnabled) {
    blockers.push({
      code: "trading_flag_off",
      label: "قفل ایمنی معامله بسته است (AGENT_TRADING_ENABLED=false)",
      missing: ["AGENT_TRADING_ENABLED=true"],
      action:
        "پس از تست، مقدار AGENT_TRADING_ENABLED را روی true بگذارید تا دکمه تأیید، سفارش واقعی را به صرافی بفرستد.",
    });
  }

  const keySource: ExchangeKeySource =
    cfg.apiKeySource === "env" || cfg.apiSecretSource === "env"
      ? "env"
      : cfg.apiKeySource === "db" || cfg.apiSecretSource === "db"
      ? "db"
      : "none";

  const canExecuteOrders = hasKeys && cfg.tradingEnabled;
  const mode: ExchangeStatus["mode"] = !hasKeys
    ? "not_configured"
    : !cfg.tradingEnabled
    ? "read-only"
    : cfg.testnet
    ? "testnet-trading"
    : "live-trading";

  const message = !hasKeys
    ? "کلید API صرافی کامل ست نشده است؛ فقط قیمت عمومی بازار خوانده می‌شود و دکمه تأیید کارهای معاملاتی غیرفعال است."
    : canExecuteOrders
    ? `سفارش‌های واقعی پس از تأیید مدیرعامل روی ${cfg.testnet ? "Testnet" : "Mainnet"} (${cfg.exchangeName}) ارسال می‌شوند.`
    : "کلیدها ست شده‌اند اما AGENT_TRADING_ENABLED=true نیست؛ ارسال سفارش قفل است و دکمه تأیید معامله غیرفعال می‌شود.";

  return {
    exchange: cfg.exchangeName,
    network: cfg.testnet ? "testnet" : "mainnet",
    keysConfigured: hasKeys,
    tradingEnabled: cfg.tradingEnabled,
    canExecuteOrders,
    mode,
    keySource,
    blockers,
    message,
  };
}

async function assertTradingAllowed(opts?: { requireTradingFlag?: boolean }) {
  const cfg = await resolveExchangeConfig();
  const requireFlag = opts?.requireTradingFlag !== false;
  const missing: string[] = [];
  if (!cfg.apiKey) missing.push("EXCHANGE_API_KEY");
  if (!cfg.apiSecret) missing.push("EXCHANGE_SECRET_KEY");
  if (requireFlag && !cfg.tradingEnabled) missing.push("AGENT_TRADING_ENABLED=true");
  if (missing.length) {
    throw new ConfigError(
      "معامله واقعی فعال نیست. ابتدا کلیدهای صرافی و AGENT_TRADING_ENABLED را تنظیم کنید.",
      missing,
      "exchange_trading_disabled",
    );
  }
  return cfg;
}

async function timedFetch(url: string, init: RequestInit = {}, timeoutMs = 9000) {
  try {
    return await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  } catch (e: any) {
    const reason = e?.name === "TimeoutError" ? "timeout" : e?.message || "network error";
    throw new ExchangeError(`اتصال به صرافی برقرار نشد (${reason})`, "exchange_unreachable");
  }
}

// Retries are limited to public read-only requests, never order placement.
async function publicTimedFetch(url: string, timeoutMs: number) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await timedFetch(url, {}, timeoutMs);
      if (attempt === 1 && (response.status === 429 || response.status >= 500)) {
        console.warn(`[exchange] public request HTTP ${response.status}; retrying once`);
        await new Promise((resolve) => setTimeout(resolve, 500));
        continue;
      }
      if (!response.ok) console.warn(`[exchange] public request HTTP ${response.status}`);
      return response;
    } catch (error) {
      console.warn(`[exchange] public request failed (attempt ${attempt}): ${error instanceof Error ? error.message : "network error"}`);
      if (attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new ExchangeError("اتصال عمومی به صرافی ناموفق بود", "exchange_unreachable");
}

/** قیمت عمومی یک یا چند نماد — Binance با فالبک OKX. */
export async function fetchPublicPrices(symbols: string[]): Promise<PriceQuote[]> {
  const list = symbols.map((s) => s.toUpperCase());
  const now = new Date().toISOString();

  // ۱) Binance
  try {
    const q = encodeURIComponent(JSON.stringify(list));
    const res = await publicTimedFetch(`${publicBaseUrl()}/api/v3/ticker/24hr?symbols=${q}`, 7000);
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
      const res = await publicTimedFetch(
        `https://www.okx.com/api/v5/market/ticker?instId=${encodeURIComponent(instId)}`,
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

/** کندل‌های واقعی OHLCV برای تحلیل تکنیکال آریا (Binance با فالبک OKX). */
export async function fetchKlines(
  symbol: string,
  interval: "15m" | "1h" | "4h" = "1h",
  limit = 60,
): Promise<{ candles: Candle[]; source: string }> {
  const sym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");

  // ۱) Binance
  try {
    const res = await publicTimedFetch(
      `${publicBaseUrl()}/api/v3/klines?symbol=${encodeURIComponent(sym)}&interval=${interval}&limit=${limit}`,
      7500,
    );
    if (res.ok) {
      const arr: any[] = await res.json();
      if (Array.isArray(arr) && arr.length >= 15) {
        const candles: Candle[] = arr.map((k) => ({
          openTime: Number(k[0]),
          open: Number(k[1]),
          high: Number(k[2]),
          low: Number(k[3]),
          close: Number(k[4]),
          volume: Number(k[5]),
        }));
        return { candles, source: "binance" };
      }
    }
  } catch {
    // ادامه با فالبک OKX
  }

  // ۲) OKX
  try {
    const instId = sym.replace(/USDT$/, "-USDT");
    const bar = interval === "4h" ? "4H" : interval === "15m" ? "15m" : "1H";
    const res = await publicTimedFetch(
      `https://www.okx.com/api/v5/market/candles?instId=${encodeURIComponent(instId)}&bar=${bar}&limit=${limit}`,
      7500,
    );
    if (res.ok) {
      const j: any = await res.json();
      const rows: any[] = Array.isArray(j?.data) ? j.data : [];
      if (rows.length >= 15) {
        // OKX از جدید به قدیم برمی‌گرداند؛ معکوس می‌کنیم تا از قدیم به جدید شود
        const candles: Candle[] = rows
          .slice()
          .reverse()
          .map((k) => ({
            openTime: Number(k[0]),
            open: Number(k[1]),
            high: Number(k[2]),
            low: Number(k[3]),
            close: Number(k[4]),
            volume: Number(k[5]),
          }));
        return { candles, source: "okx" };
      }
    }
  } catch {
    // هیچ منبعی در دسترس نیست
  }

  throw new ExchangeError(
    `کندل واقعی برای ${sym} در دسترس نیست (Binance/OKX)`,
    "klines_unavailable",
  );
}

function signWithSecret(query: string, secret: string) {
  if (!secret) throw new ConfigError("EXCHANGE_SECRET_KEY ست نشده است", ["EXCHANGE_SECRET_KEY"]);
  return createHmac("sha256", secret).update(query).digest("hex");
}

async function signedRequest(
  method: "GET" | "POST" | "DELETE",
  path: string,
  params: Record<string, string | number> = {},
  opts?: { requireTradingFlag?: boolean; exchangeOnly?: "tabdeal" },
): Promise<{ json: any; exchange: "binance" | "tabdeal"; testnet: boolean }> {
  if (!isAllowedSignedRequest(method, path)) {
    throw new ExchangeError("درخواست امضاشده در فهرست مجاز نیست", "exchange_endpoint_forbidden");
  }
  const cfg = await assertTradingAllowed(opts);
  if (opts?.exchangeOnly && cfg.exchangeName !== opts.exchangeOnly) {
    throw new ExchangeError("این عملیات فقط برای تبدیل پشتیبانی می‌شود", "wrong_exchange");
  }

  const targets: Array<{
    exchange: "binance" | "tabdeal";
    host: string;
    apiPath: string;
    testnet: boolean;
  }> = [];

  if (cfg.exchangeName === "tabdeal") {
    targets.push({
      exchange: "tabdeal",
      host: conf("EXCHANGE_BASE_URL").replace(/\/$/, "") || TABDEAL_BASE,
      apiPath: method === "GET" && path === "/api/v3/account" ? "/r/api/v1/account" : path.replace(/^\/api\/v3\//, "/api/v1/"),
      testnet: false,
    });
  } else {
    targets.push({
      exchange: "binance",
      host: baseUrl(cfg.testnet),
      apiPath: path,
      testnet: cfg.testnet,
    });

  }

  let lastErr: ExchangeError | null = null;

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    if (!isAllowedSignedRequest(method, t.apiPath)) {
      throw new ExchangeError("مقصد درخواست امضاشده در فهرست مجاز نیست", "exchange_endpoint_forbidden");
    }
    const query = new URLSearchParams({
      ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
      timestamp: String(Date.now()),
      recvWindow: "5000",
    }).toString();
    const signature = signWithSecret(query, cfg.apiSecret);
    const url = `${t.host}${t.apiPath}?${query}&signature=${signature}`;
    try {
      const res = await timedFetch(url, {
        method,
        headers: { "X-MBX-APIKEY": cfg.apiKey, "Content-Type": "application/json" },
      });
      const text = await res.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        json = { raw: text };
      }
      if (res.ok) {
        return { json, exchange: t.exchange, testnet: t.testnet };
      }
      const msg = json?.msg || json?.message || `HTTP ${res.status}`;
      lastErr = new ExchangeError(
        `صرافی (${t.exchange}) درخواست را رد کرد (HTTP ${res.status}): ${msg}`,
        "exchange_rejected",
        { exchange: t.exchange, status: res.status, code: json?.code, msg },
      );
      // فقط در صورت خطای کلید نامعتبر روی هدف اول، هدف جایگزین بررسی شود
      if (res.status !== 401 && res.status !== 403 && json?.code !== -2015 && json?.code !== -2014) {
        throw lastErr;
      }
    } catch (e: any) {
      if (e instanceof ExchangeError && e.code === "exchange_rejected" && i < targets.length - 1) {
        continue;
      }
      if (e instanceof ExchangeError) lastErr = e;
      else lastErr = new ExchangeError(e?.message || "خطای ارتباط با صرافی", "exchange_unreachable");
      if (i === targets.length - 1) throw lastErr;
    }
  }

  throw lastErr || new ExchangeError("خطای نامشخص در ارسال درخواست امضاشده به صرافی", "exchange_error");
}

export async function getAccountBalances(assets = ["USDT"]) {
  const { json: acc } = await signedRequest("GET", "/api/v3/account", {}, { requireTradingFlag: false });
  try {
    return normalizeAccountBalances(acc, assets);
  } catch (error) {
    throw new ExchangeError("پاسخ حساب صرافی شامل موجودی معتبر نیست", error instanceof Error ? error.message : "invalid_account_response");
  }
}

export type PlaceOrderInput = {
  symbol: string;
  side: "BUY" | "SELL";
  type?: "MARKET" | "LIMIT";
  quantity?: number | string;
  quoteOrderQty?: number;
  price?: number | string;
  testnet?: boolean;
  clientOrderId?: string;
  exchangeOnly?: "tabdeal";
};

/**
 * ارسال سفارش واقعی. clientOrderId برای idempotency ساخته می‌شود.
 * مستقیماً به AGENT_TRADING_ENABLED متصل است؛ با فعال شدن آن در Vercel، سفارش پس از تأیید مدیرعامل صادر می‌شود.
 */
export async function placeRealOrder(input: PlaceOrderInput): Promise<ExchangeOrderResult> {
  const cfg = await assertTradingAllowed({ requireTradingFlag: true });
  const symbol = input.symbol.toUpperCase();
  if (!/^[A-Z0-9]{2,30}$/.test(symbol)) throw new ExchangeError("نماد معاملاتی نامعتبر است", "invalid_symbol");
  if (input.exchangeOnly && cfg.exchangeName !== input.exchangeOnly) throw new ExchangeError("این عملیات فقط برای تبدیل پشتیبانی می‌شود", "wrong_exchange");
  if (cfg.exchangeName === "tabdeal") {
    try {
      validateTabdealSpotOrder({ symbol, side: input.side, type: input.type || "MARKET", quantity: input.quantity == null ? undefined : String(input.quantity), quoteOrderQty: input.quoteOrderQty, price: input.price });
    } catch (error) {
      throw new ExchangeError("پارامترهای سفارش با API نقدی تبدیل سازگار نیست", error instanceof Error ? error.message : "invalid_tabdeal_order");
    }
  }

  const type = input.type || "MARKET";
  const clientOrderId = input.clientOrderId || `ag${Date.now().toString(36)}${randomUUID().slice(0, 6)}`;
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(clientOrderId)) throw new ExchangeError("شناسه سفارش نامعتبر است", "invalid_client_id");

  const params: Record<string, string | number> = {
    symbol,
    side: input.side,
    type,
    newClientOrderId: clientOrderId,
  };
  const quantityText = input.quantity == null ? "" : String(input.quantity);
  const hasQuantity = /^\d+(?:\.\d+)?$/.test(quantityText) && /[1-9]/.test(quantityText) && quantityText.length <= 64;
  if (type === "MARKET") {
    if (input.quoteOrderQty && input.quoteOrderQty > 0) params.quoteOrderQty = input.quoteOrderQty;
    else if (hasQuantity) params.quantity = quantityText;
    else throw new ExchangeError("مقدار سفارش مشخص نشده است", "missing_quantity");
  } else {
    if (!hasQuantity) throw new ExchangeError("مقدار سفارش مشخص نشده است", "missing_quantity");
    if (!input.price || !Number.isFinite(Number(input.price)) || Number(input.price) <= 0) throw new ExchangeError("قیمت سفارش مشخص نشده است", "missing_price");
    params.quantity = quantityText;
    params.price = input.price;
    params.timeInForce = "GTC";
  }

  const { json, exchange, testnet } = await signedRequest("POST", "/api/v3/order", params, {
    requireTradingFlag: true,
    exchangeOnly: input.exchangeOnly,
  });
  let acknowledgement: ReturnType<typeof parseOrderAcknowledgement>;
  try { acknowledgement = parseOrderAcknowledgement(json); }
  catch { throw new ExchangeError("پاسخ سفارش نامشخص است؛ قبل از تلاش مجدد وضعیت شناسه سفارش را بررسی کنید", "order_response_ambiguous", { clientOrderId }); }
  return {
    exchange,
    testnet,
    symbol,
    side: input.side,
    ...acknowledgement,
    clientOrderId,
    fills: json?.fills,
    raw: json,
    simulated: false,
  };
}

/** Read-only reconciliation by a client ID persisted before submission. */
export async function findTabdealOrder(symbol: string, clientOrderId: string) {
  if (!/^[A-Z0-9]{2,30}$/.test(symbol) || !/^[A-Za-z0-9_-]{1,32}$/.test(clientOrderId)) throw new ExchangeError("نماد یا شناسه سفارش نامعتبر است", "invalid_order_lookup");
  const { json } = await signedRequest("GET", "/r/api/v1/order", { symbol, origClientOrderId: clientOrderId }, { requireTradingFlag: false, exchangeOnly: "tabdeal" });
  return json;
}

/** Cancel one previously persisted Tabdeal order; callers must re-query status. */
export async function cancelTabdealOrder(symbol: string, clientOrderId: string) {
  if (!/^[A-Z0-9]{2,30}$/.test(symbol) || !/^[A-Za-z0-9_-]{1,32}$/.test(clientOrderId)) throw new ExchangeError("نماد یا شناسه سفارش نامعتبر است", "invalid_order_lookup");
  const { json } = await signedRequest("DELETE", "/api/v1/order", { symbol, origClientOrderId: clientOrderId }, { requireTradingFlag: true, exchangeOnly: "tabdeal" });
  return json;
}

/** Fetch individual trades for one exchange order; incomplete pages are rejected. */
export async function fetchTabdealOrderTrades(symbol: string, orderId: string, side: "BUY" | "SELL") {
  if (!/^[A-Z0-9]{2,30}$/.test(symbol) || !/^\d{1,30}$/.test(orderId)) throw new ExchangeError("نماد یا شناسه سفارش نامعتبر است", "invalid_order_lookup");
  const { json } = await signedRequest("GET", "/r/api/v1/myTrades", { symbol, orderId, limit: 1000 }, { requireTradingFlag: false, exchangeOnly: "tabdeal" });
  if (!Array.isArray(json) || json.length >= 1000) throw new ExchangeError("فهرست اجراهای صرافی ناقص یا نامعتبر است", "trade_history_incomplete");
  return parseTabdealTrades(json, { symbol, orderId, side });
}

/** Live exchange-provided symbol limits. Does not place an order. */
export async function fetchTabdealMarketRules(symbol: string) {
  if (!/^[A-Z0-9]{2,30}$/.test(symbol)) throw new ExchangeError("نماد نامعتبر است", "invalid_symbol");
  const response = await publicTimedFetch(`${TABDEAL_BASE}/r/api/v1/exchangeInfo?symbol=${encodeURIComponent(symbol)}`, 7000);
  if (!response.ok) throw new ExchangeError(`دریافت مشخصات بازار ناموفق: HTTP ${response.status}`, "tabdeal_market_unavailable");
  return parseTabdealMarket(await response.json(), symbol);
}

/** Read-only Tabdeal book. Receipt time is not an exchange timestamp. */
export async function fetchTabdealTopOfBook(symbol: string) {
  if (!/^[A-Z0-9]{2,30}$/.test(symbol)) throw new ExchangeError("نماد نامعتبر است", "invalid_symbol");
  const requestStartedAt = Date.now();
  const response = await publicTimedFetch(`${TABDEAL_BASE}/r/api/v1/depth?symbol=${encodeURIComponent(symbol)}&limit=1`, 7000);
  if (!response.ok) throw new ExchangeError(`دریافت دفتر سفارش تبدیل ناموفق بود: HTTP ${response.status}`, "tabdeal_book_unavailable");
  const book = parseTabdealTopOfBook(await response.json());
  return { ...book, requestStartedAt, receivedAt: Date.now(), source: "tabdeal" as const };
}

/** Standalone exchange primitive. Not yet wired to trade execution. */
export async function submitTabdealSellOco(plan: TabdealOcoPlan, filters: TabdealOcoFilters) {
  validateTabdealSellOco(plan, filters);
  const { json } = await signedRequest("POST", "/api/v1/order/oco", {
    symbol: plan.symbol,
    side: "SELL",
    quantity: plan.quantity,
    price: plan.price,
    stopPrice: plan.stopPrice,
    stopLimitPrice: plan.stopLimitPrice,
    listClientOrderId: plan.listClientOrderId,
    limitClientOrderId: plan.limitClientOrderId,
    stopClientOrderId: plan.stopClientOrderId,
  }, { requireTradingFlag: true, exchangeOnly: "tabdeal" });
  // A 2xx without an order list ID is ambiguous, not evidence of protection.
  if (json?.orderListId == null || !["EXECUTING", "ALL_DONE"].includes(String(json.listOrderStatus))) {
    throw new ExchangeError("پاسخ OCO نامشخص است؛ وضعیت را با شناسه مشتری بررسی کنید", "oco_response_ambiguous");
  }
  return json;
}

/** Lookup by caller-provided, persisted ID after an ambiguous OCO submission. */
export async function findTabdealOco(listClientOrderId: string) {
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(listClientOrderId)) throw new ExchangeError("شناسه OCO نامعتبر است", "invalid_client_id");
  const { json } = await signedRequest("GET", "/r/api/v1/orderList", { origClientOrderId: listClientOrderId }, { requireTradingFlag: false, exchangeOnly: "tabdeal" });
  return json;
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
  const cfg = await resolveExchangeConfig();
  if (cfg.apiKey && cfg.apiSecret) {
    try {
      result.account = await getAccountBalances(["USDT", "BTC"]);
    } catch (e: any) {
      result.accountError = e?.message || "account error";
    }
  }
  return result;
}
