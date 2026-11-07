import {
  exchangeStatus,
  type ExchangeBlocker,
  type ExchangeStatus,
} from "@/lib/exchange";
import { ENV } from "@/lib/env";
import { checkLiveGate } from "@/lib/live-gate";
import { telegramConfigured } from "@/lib/telegram";

/**
 * «پیش‌بررسی» صف کار (Job Queue) — یک منبع حقیقت واحد.
 *
 * چرا لازم است؟
 * قبلاً کنترل‌های مختلف (پنل، تلگرام، کرون) هرکدام جداگانه بررسی می‌کردند
 * که آیا می‌توان کار را اجرا کرد یا نه؛ نتیجه این بود که بعضی کارها در
 * وضعیت failed گیر می‌افتادند و دکمه تأیید برای آن‌ها هم نمایش داده می‌شد
 * (خطای «این کار در وضعیت failed است و قابل تایید نیست»).
 *
 * حالا هر کار قبل از ساخت/تأیید دقیقاً یک بررسی می‌شود:
 *  • اگر «آماده اجرا» باشد → دکمه تأیید فعال است.
 *  • اگر نه → دلیل صریح (blockers) برگردانده می‌شود و دکمه غیرفعال می‌ماند.
 *
 * این فایل هیچ داده‌ای نمی‌سازد و هیچ عددی را تخمین نمی‌زند.
 */

export type JobKind =
  | "trade"
  | "confirm_deposit"
  | "tool_run"
  | "status_report"
  | "withdraw"
  | "proposal"
  | "bounty"
  | "mission"
  | "custom";

export type PreflightBlocker = {
  code: string;
  label: string;
  missing: string[];
  action: string;
};

export type JobPreflight = {
  /** آیا این نوع کار در این نسخه اجراکننده واقعی دارد؟ */
  supported: boolean;
  /** آیا با زدن دکمه تأیید، کار واقعاً اجرا می‌شود؟ */
  ready: boolean;
  requiresApproval: boolean;
  reason: string;
  blockers: PreflightBlocker[];
};

const SUPPORTED_KINDS: JobKind[] = [
  "trade",
  "confirm_deposit",
  "tool_run",
  "status_report",
  "withdraw",
  "proposal",
  "bounty",
  "mission",
];

/** کارهایی که هیچ‌وقت خودکار (بدون تأیید مدیرعامل) اجرا نمی‌شوند. */
const ALWAYS_HUMAN_KINDS: JobKind[] = [
  "trade",
  "withdraw",
  "confirm_deposit",
  "proposal",
  "bounty",
  "mission",
];

function blockerFromExchange(b: ExchangeBlocker): PreflightBlocker {
  return {
    code: b.code,
    label: b.label,
    missing: b.missing,
    action: b.action,
  };
}

/**
 * پیش‌بررسی یک نوع کار.
 * @param kind نوع کار
 * @param payload داده‌ی کار (برای بررسی کامل بودن payload)
 */
export async function preflightJobKind(
  kind: JobKind,
  payload: Record<string, any> = {},
  opts: { exchange?: ExchangeStatus } = {},
): Promise<JobPreflight> {
  const blockers: PreflightBlocker[] = [];
  const supported = SUPPORTED_KINDS.includes(kind);
  const requiresApproval = ALWAYS_HUMAN_KINDS.includes(kind);

  if (!supported) {
    return {
      supported: false,
      ready: false,
      requiresApproval,
      reason: `نوع کار «${kind}» در این نسخه اجراکننده ندارد؛ بنابراین حتی با تأیید هم قابل اجرا نیست.`,
      blockers: [
        {
          code: "unsupported_kind",
          label: `نوع کار «${kind}» پشتیبانی نمی‌شود`,
          missing: [],
          action:
            "این نوع کار در نسخه فعلی اجراکننده ندارد. آن را رد کنید و از دکمه‌های واقعی (سفارش معامله، تأیید واریز، اجرای ابزار) استفاده کنید.",
        },
      ],
    };
  }

  let exchange: ExchangeStatus | null = null;

  switch (kind) {
    case "trade": {
      const symbol = String(payload.symbol || "").trim();
      if (!symbol) {
        blockers.push({
          code: "missing_symbol",
          label: "نماد معاملاتی در کار مشخص نشده است",
          missing: ["payload.symbol"],
          action: "کار را رد کنید و درخواست معامله را با نماد (مثلاً BTCUSDT) بسازید.",
        });
      }
      const qty = Number(payload.quoteOrderQty || 0);
      const quantity = Number(payload.quantity || 0);
      if (!qty && !quantity) {
        blockers.push({
          code: "missing_quantity",
          label: "مقدار سفارش (quoteOrderQty یا quantity) مشخص نشده است",
          missing: ["payload.quoteOrderQty"],
          action: "کار را رد کنید و با مقدار مشخص دوباره درخواست معامله بسازید.",
        });
      }
      exchange = opts.exchange ?? (await exchangeStatus());
      if (!exchange.canExecuteOrders) {
        blockers.push(...exchange.blockers.map(blockerFromExchange));
      } else {
        // دروازهٔ معاملهٔ واقعی: سرمایهٔ ثبت‌شده + سقف‌های روزانه + kill-switch
        const gate = await checkLiveGate(qty || quantity || undefined);
        for (const b of gate.blockers) {
          blockers.push({ code: b.code, label: b.label, missing: [], action: b.action });
        }
      }
      break;
    }

    case "withdraw": {
      const txHash = String(payload.txHash || "").trim();
      if (txHash.length < 16) {
        blockers.push({
          code: "missing_tx_hash",
          label: "هش تراکنش واقعی برای ثبت برداشت لازم است",
          missing: ["payload.txHash"],
          action:
            "ابتدا انتقال را در صرافی/کیف پول انجام دهید و هش واقعی را ثبت کنید؛ بدون هش چیزی ثبت نمی‌شود.",
        });
      }
      if (Number(payload.amountUsdt || 0) <= 0) {
        blockers.push({
          code: "invalid_amount",
          label: "مبلغ برداشت نامعتبر است",
          missing: ["payload.amountUsdt"],
          action: "مبلغ مثبت USDT را در کار ثبت کنید.",
        });
      }
      break;
    }

    case "confirm_deposit": {
      if (!Number(payload.transactionId || 0)) {
        blockers.push({
          code: "missing_transaction",
          label: "شناسه تراکنش برای تأیید واریز مشخص نیست",
          missing: ["payload.transactionId"],
          action: "این کارِ بی‌مرجع را رد کنید و از فهرست «در انتظار تأیید» کیف پول، واریز را تأیید کنید.",
        });
      }
      break;
    }

    case "tool_run": {
      if (!ENV.workerUrl()) {
        blockers.push({
          code: "worker_not_configured",
          label: "ورکر اجرای ابزار ست نشده است (AGENT_WORKER_URL)",
          missing: ["AGENT_WORKER_URL"],
          action:
            "آدرس ورکر واقعی (n8n / سرویس پایتون) را در AGENT_WORKER_URL بگذارید؛ تا آن زمان ابزار خروجی جعلی نمی‌سازد.",
        });
      }
      break;
    }

    case "status_report": {
      if (!ENV.geminiKey()) {
        blockers.push({
          code: "ai_key_missing",
          label: "کلید جمینای ست نشده است (GEMINI_API_KEY)",
          missing: ["GEMINI_API_KEY"],
          action:
            "برای گزارش تحلیلی، GEMINI_API_KEY را ست کنید. بدون آن گزارش متنی از داده واقعی دیتابیس تولید می‌شود.",
        });
      }
      break;
    }

    case "mission":
      // مأموریت‌های حلقهٔ ۲۴/۷ کار داخلی (تحلیل/تدوین/بازرسی) هستند و
      // هیچ تراکنش مالی از خودشان نمی‌سازند؛ پس پیش‌بررسی مالی ندارند.
      break;

    case "proposal":
    case "bounty":
    default:
      // این دو کار داده‌ی مالی نمی‌سازند؛ فقط وضعیت پروژه/فرصت را جلو می‌برند.
      break;
  }

  const ready = blockers.length === 0;
  const reason = ready
    ? kind === "trade"
      ? `آماده اجرای واقعی روی ${exchange?.network === "testnet" ? "Testnet" : "Mainnet"} است.`
      : "آماده اجراست."
    : blockers.map((b) => b.label).join(" • ");

  return { supported, ready, requiresApproval, reason, blockers };
}

export type ApprovalVerdict = {
  allowed: boolean;
  message: string;
  blockers: PreflightBlocker[];
  preflight?: JobPreflight;
};

/**
 * آیا این کار الان قابل تأیید (و اجرای واقعی) است؟
 * اگر نه، پیام دقیقاً همان دلیلی است که باید به مدیرعامل نشان داده شود
 * (به جای «این کار در وضعیت failed است و قابل تایید نیست»).
 */
export async function approvalVerdict(job: {
  kind: string;
  status: string;
  payload?: unknown;
  error?: string | null;
}): Promise<ApprovalVerdict> {
  const label = statusLabel(job.status);

  if (job.status === "succeeded") {
    return {
      allowed: false,
      message: "این کار قبلاً با موفقیت اجرا شده است؛ اجرای دوباره لازم نیست.",
      blockers: [],
    };
  }
  if (job.status === "failed") {
    return {
      allowed: false,
      message:
        "این کار ناموفق ثبت شده است و مستقیماً قابل تأیید نیست. ابتدا علت را رفع کنید و سپس «تلاش دوباره» را بزنید." +
        (job.error ? ` علت ثبت‌شده: ${job.error}` : ""),
      blockers: [],
    };
  }
  if (job.status === "running") {
    return {
      allowed: false,
      message: "این کار همین حالا در حال اجراست؛ تا پایان آن صبر کنید.",
      blockers: [],
    };
  }
  if (["rejected", "expired", "cancelled"].includes(job.status)) {
    return {
      allowed: false,
      message: `این کار در وضعیت «${label}» است و قابل تأیید نیست. برای اجرای مجدد یک کار تازه بسازید.`,
      blockers: [],
    };
  }
  if (!["awaiting_approval", "queued"].includes(job.status)) {
    return {
      allowed: false,
      message: `این کار در وضعیت «${label}» است و قابل تأیید نیست.`,
      blockers: [],
    };
  }

  const preflight = await preflightJobKind(
    job.kind as JobKind,
    (job.payload || {}) as Record<string, any>,
  );
  if (!preflight.ready) {
    return {
      allowed: false,
      message: `این کار هنوز آماده اجرای واقعی نیست: ${preflight.reason}`,
      blockers: preflight.blockers,
      preflight,
    };
  }
  return {
    allowed: true,
    message: "آماده اجرا — با تأیید شما اجرای واقعی شروع می‌شود.",
    blockers: [],
    preflight,
  };
}

export function statusLabel(status: string): string {
  const map: Record<string, string> = {
    queued: "در صف",
    awaiting_approval: "منتظر تأیید",
    approved: "تأییدشده",
    running: "در حال اجرا",
    succeeded: "موفق",
    failed: "ناموفق",
    rejected: "رد شده",
    expired: "منقضی",
    needs_config: "نیازمند تنظیمات",
  };
  return map[status] || status;
}

export { telegramConfigured };
