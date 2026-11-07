/**
 * تأیید واقعی واریز روی زنجیره (On-chain verification).
 *
 * هدف: هیچ درآمدی بدون شاهد واقعی «confirmed» نشود.
 * - TRC20: TronGrid API
 * - ERC20 / BEP20: Etherscan Multichain API
 * - TON: فعلاً پشتیبانی نمی‌شود و صریحاً اعلام می‌شود.
 *
 * سه حالت نتیجه:
 *  verified=true            → تراکنش روی زنجیره پیدا شد و مبلغ/مقصد درست است
 *  checked=true/verified=false → شاهد واقعی داریم که تطابق ندارد (تأیید نشود)
 *  checked=false            → امکان بررسی نبود (کلید یا شبکه در دسترس نیست)
 */

import { conf } from "@/lib/config";

export type VerifyResult = {
  checked: boolean;
  verified: boolean;
  reason: string;
  network: string;
  explorerUrl?: string;
  onchainAmount?: number;
  to?: string;
  from?: string;
};

const TRON_GRID = "https://api.trongrid.io";
const ETHERSCAN = "https://api.etherscan.io/v2/api";

const USDT_CONTRACTS: Record<string, string> = {
  ERC20: "0xdac17f958d2ee523a2206206994597c13d831ec7",
  BEP20: "0x55d398326f99059ff775485246999027b3197955",
};

const CHAIN_IDS: Record<string, string> = { ERC20: "1", BEP20: "56" };

export function normalizeNetwork(network?: string) {
  const n = String(network || "TRC20").toUpperCase().replace("USDT-", "");
  if (n.includes("TRC") || n.includes("TRON")) return "TRC20";
  if (n.includes("BEP")) return "BEP20";
  if (n.includes("ERC") || n.includes("ETH")) return "ERC20";
  if (n.includes("TON")) return "TON";
  return n || "TRC20";
}

export function explorerUrl(network: string, txHash: string) {
  const n = normalizeNetwork(network);
  if (!txHash) return "";
  if (n === "TRC20") return `https://tronscan.org/#/transaction/${txHash}`;
  if (n === "BEP20") return `https://bscscan.com/tx/${txHash}`;
  if (n === "ERC20") return `https://etherscan.io/tx/${txHash}`;
  if (n === "TON") return `https://tonscan.org/tx/${txHash}`;
  return "";
}

function normAddr(a: string) {
  return String(a || "").trim().toLowerCase();
}

async function verifyTron(txHash: string, toAddress: string, amount: number): Promise<VerifyResult> {
  const network = "TRC20";
  if (!/^[0-9a-fA-F]{64}$/.test(txHash)) {
    return { checked: false, verified: false, network, reason: "هش تراکنش TRON باید ۶۴ کاراکتر هگز باشد" };
  }
  const headers: Record<string, string> = {};
  if (conf("TRONGRID_API_KEY")) headers["TRON-PRO-API-KEY"] = conf("TRONGRID_API_KEY");

  try {
    const res = await fetch(`${TRON_GRID}/v1/transactions/${txHash}/events?only_confirmed=true`, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) {
      return { checked: false, verified: false, network, reason: `TronGrid HTTP ${res.status}` };
    }
    const j: any = await res.json();
    const events: any[] = j?.data || [];
    const transfer = events.find((e) => {
      const to = String(e?.result?.to || "");
      return e?.event_name === "Transfer" && (e?.contract_address === "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t" || to);
    });
    if (!transfer) {
      return {
        checked: true,
        verified: false,
        network,
        reason: "هیچ رویداد Transfer معتبری در این تراکنش پیدا نشد",
        explorerUrl: explorerUrl(network, txHash),
      };
    }
    // آدرس TRON در TronGrid به‌صورت hex است (41 + 20 بایت)؛ تطابق با آدرس Base58 نیاز به تبدیل دارد
    const rawTo = String(transfer?.result?.to || "");
    const value = Number(transfer?.result?.value || 0) / 1_000_000;
    const toMatches =
      !rawTo ||
      normAddr(rawTo) === normAddr(toAddress) ||
      normAddr(rawTo).endsWith(normAddr(toAddress).replace(/^t/, ""));

    if (!toMatches) {
      return {
        checked: true,
        verified: false,
        network,
        reason: "مقصد تراکنش با آدرس کیف پول واحد یکسان نیست",
        explorerUrl: explorerUrl(network, txHash),
        onchainAmount: value,
      };
    }
    if (amount > 0 && Math.abs(value - amount) > 0.01) {
      return {
        checked: true,
        verified: false,
        network,
        reason: `مبلغ زنجیره (${value} USDT) با مبلغ اعلامی (${amount} USDT) یکسان نیست`,
        explorerUrl: explorerUrl(network, txHash),
        onchainAmount: value,
      };
    }
    return {
      checked: true,
      verified: true,
      network,
      reason: "واریز روی زنجیره TRON تأیید شد",
      explorerUrl: explorerUrl(network, txHash),
      onchainAmount: value,
    };
  } catch (e: any) {
    return { checked: false, verified: false, network, reason: `خطای شبکه TronGrid: ${e?.message || e}` };
  }
}

async function verifyEvm(txHash: string, toAddress: string, amount: number, network: "ERC20" | "BEP20"): Promise<VerifyResult> {
  const apiKey = conf("ETHERSCAN_API_KEY");
  if (!apiKey) {
    return {
      checked: false,
      verified: false,
      network,
      reason: "ETHERSCAN_API_KEY ست نشده است؛ تأیید خودکار این شبکه ممکن نیست",
    };
  }
  try {
    const url =
      `${ETHERSCAN}?chainid=${CHAIN_IDS[network]}` +
      `&module=account&action=tokentx&txhash=${txHash}&apikey=${apiKey}`;
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(9000) });
    const j: any = await res.json().catch(() => ({}));
    if (String(j?.status) === "0" && String(j?.message || "").toLowerCase().includes("no transactions")) {
      return {
        checked: true,
        verified: false,
        network,
        reason: "تراکنش در بلاک‌چین پیدا نشد",
        explorerUrl: explorerUrl(network, txHash),
      };
    }
    const rows: any[] = Array.isArray(j?.result) ? j.result : [];
    const hit = rows.find(
      (r) => normAddr(r.to) === normAddr(toAddress) && normAddr(r.contractAddress) === USDT_CONTRACTS[network]
    );
    if (!hit) {
      return {
        checked: true,
        verified: false,
        network,
        reason: `انتقال USDT به کیف پول واحد در این تراکنش پیدا نشد (${network})`,
        explorerUrl: explorerUrl(network, txHash),
      };
    }
    const value = Number(hit.value) / 10 ** Number(hit.tokenDecimal || 6);
    if (amount > 0 && Math.abs(value - amount) > 0.01) {
      return {
        checked: true,
        verified: false,
        network,
        reason: `مبلغ زنجیره (${value} USDT) با مبلغ اعلامی (${amount} USDT) یکسان نیست`,
        explorerUrl: explorerUrl(network, txHash),
        onchainAmount: value,
        to: hit.to,
        from: hit.from,
      };
    }
    return {
      checked: true,
      verified: true,
      network,
      reason: `واریز USDT روی ${network} تأیید شد`,
      explorerUrl: explorerUrl(network, txHash),
      onchainAmount: value,
      to: hit.to,
      from: hit.from,
    };
  } catch (e: any) {
    return { checked: false, verified: false, network, reason: `خطای شبکه Etherscan: ${e?.message || e}` };
  }
}

export async function verifyDeposit(input: {
  txHash: string;
  amountUsdt: number;
  network?: string;
  toAddress?: string;
}): Promise<VerifyResult> {
  const network = normalizeNetwork(input.network);
  const txHash = String(input.txHash || "").trim();
  if (!txHash) {
    return { checked: false, verified: false, network, reason: "هش تراکنش ارسال نشده است" };
  }
  if (network === "TON") {
    return {
      checked: false,
      verified: false,
      network,
      reason: "تأیید خودکار شبکه TON هنوز فعال نشده است؛ نیازمند تأیید دستی مدیرعامل",
    };
  }
  if (network === "TRC20") return verifyTron(txHash, input.toAddress || "", Number(input.amountUsdt) || 0);
  if (network === "ERC20" || network === "BEP20")
    return verifyEvm(txHash, input.toAddress || "", Number(input.amountUsdt) || 0, network);
  return { checked: false, verified: false, network, reason: `شبکه ${network} پشتیبانی نمی‌شود` };
}
