import { createHmac } from "crypto";
import { db } from "@/db";
import { settings } from "@/db/schema";

const BASE = "https://api1.tabdeal.org";
const VER = "v1";

export async function getExchangeConfig() {
  const rows = await db.select().from(settings);
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    name: map.exchange_name || "",
    apiKey: map.exchange_api_key || "",
    apiSecret: map.exchange_api_secret || "",
    riskPct: Number(map.risk_max_trade_pct) || 2,
    riskLeverage: Number(map.risk_max_leverage) || 3,
    requireSL: map.risk_require_sl !== "false",
  };
}

function encodeParams(params: Record<string, any>): string {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
}

function signedQuery(secret: string, params: Record<string, any>): string {
  const qs = encodeParams({ ...params, timestamp: Date.now() });
  const sig = createHmac("sha256", secret).update(qs).digest("hex");
  return `${qs}&signature=${sig}`;
}

async function tradeGet<T>(path: string, params: Record<string, any> = {}): Promise<T> {
  const cfg = await getExchangeConfig();
  if (!cfg.apiKey || !cfg.apiSecret) throw new Error("NO_EXCHANGE_KEYS");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const q = signedQuery(cfg.apiSecret, params);
    const res = await fetch(`${BASE}/r/api/${VER}/${path}?${q}`, {
      headers: { "X-MBX-APIKEY": cfg.apiKey },
      signal: ctrl.signal,
      cache: "no-store",
    });
    clearTimeout(t);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error("EX_" + (d?.msg || d?.code || res.status));
    return d as T;
  } finally {
    clearTimeout(t);
  }
}

async function tradePost<T>(path: string, params: Record<string, any> = {}): Promise<T> {
  const cfg = await getExchangeConfig();
  if (!cfg.apiKey || !cfg.apiSecret) throw new Error("NO_EXCHANGE_KEYS");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const body = signedQuery(cfg.apiSecret, params);
    const res = await fetch(`${BASE}/api/${VER}/${path}`, {
      method: "POST",
      headers: {
        "X-MBX-APIKEY": cfg.apiKey,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      signal: ctrl.signal,
      cache: "no-store",
    });
    clearTimeout(t);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error("EX_" + (d?.msg || d?.code || res.status));
    return d as T;
  } finally {
    clearTimeout(t);
  }
}

export async function publicGet<T>(path: string, params: Record<string, any> = {}): Promise<T> {
  const qs = encodeParams(params);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(`${BASE}/r/api/${VER}/${path}${qs ? "?" + qs : ""}`, {
      signal: ctrl.signal,
      cache: "no-store",
    });
    clearTimeout(t);
    if (!res.ok) throw new Error("EX_PUBLIC_" + res.status);
    return (await res.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

// سیمبل: اگر _ داشت tabdealSymbol وگرنه symbol
export function symbolParam(symbol: string) {
  const s = String(symbol || "").trim().toUpperCase();
  return s.includes("_") ? { tabdealSymbol: s } : { symbol: s };
}

export function splitSymbol(symbol: string): { base: string; quote: string } {
  const s = String(symbol || "").trim().toUpperCase();
  if (s.includes("_")) {
    const [base, quote] = s.split("_");
    return { base, quote };
  }
  if (s.endsWith("USDT")) return { base: s.slice(0, -4), quote: "USDT" };
  if (s.endsWith("IRT")) return { base: s.slice(0, -3), quote: "IRT" };
  return { base: s, quote: "IRT" };
}

export const getAccount = () => tradeGet<any>("account");
export const getFundingWallet = () => tradeGet<any>("asset/get-funding-asset");
export const getDepth = (symbol: string, limit = 5) =>
  publicGet<any>("depth", { ...symbolParam(symbol), limit });

export async function newOrder(o: {
  symbol: string;
  side: string;
  type: string;
  quantity: string;
  price?: string;
}) {
  const side = String(o.side).toUpperCase();
  const type = String(o.type).toUpperCase();
  if (!["BUY", "SELL"].includes(side)) throw new Error("BAD_SIDE");
  if (!["MARKET", "LIMIT", "STOP_LOSS_LIMIT"].includes(type)) throw new Error("BAD_TYPE");
  if (!(Number(o.quantity) > 0)) throw new Error("BAD_QTY");
  if (type === "LIMIT" && !(Number(o.price) > 0)) throw new Error("NEED_PRICE");
  const params: Record<string, any> = {
    ...symbolParam(o.symbol),
    side,
    type,
    quantity: String(o.quantity),
  };
  if (o.price) params.price = String(o.price);
  return tradePost<any>("order", params);
}

export function parseBalances(d: any): { asset: string; free: number; locked: number }[] {
  const arr = Array.isArray(d)
    ? d
    : d?.balances || d?.data?.balances || d?.result?.balances || d?.data || [];
  if (!Array.isArray(arr)) return [];
  return arr
    .map((b: any) => ({
      asset: String(b.asset || b.currency || b.coin || "?"),
      free: Number(b.free ?? b.available ?? b.balance ?? 0),
      locked: Number(b.locked ?? b.frozen ?? 0),
    }))
    .filter((b) => b.free > 0 || b.locked > 0);
}

export function parseDepth(d: any): { bid: number; ask: number; mid: number } | null {
  const bids = d?.bids || [];
  const asks = d?.asks || [];
  if (!bids.length || !asks.length) return null;
  const bid = Number(bids[0][0] ?? bids[0]?.price ?? 0);
  const ask = Number(asks[0][0] ?? asks[0]?.price ?? 0);
  if (!(bid > 0 && ask > 0)) return null;
  return { bid, ask, mid: (bid + ask) / 2 };
}

export function exErrorFa(code: string): string {
  if (code === "NO_EXCHANGE_KEYS")
    return "کلید صرافی ثبت نشده — از داشبورد ← «اتصال‌ها» وارد کنید.";
  if (code === "BAD_SIDE" || code === "BAD_TYPE" || code === "BAD_QTY")
    return "پارامتر سفارش نامعتبر است.";
  if (code === "NEED_PRICE") return "برای سفارش LIMIT قیمت لازم است.";
  if (code.startsWith("EX_")) return `خطای صرافی: ${code.slice(3)}`;
  return `خطای اتصال صرافی (${code})`;
}
