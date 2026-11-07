import {
  pgSchema,
  text,
  serial,
  integer,
  real,
  timestamp,
  boolean,
} from "drizzle-orm/pg-core";

// Isolated schema inside the shared Supabase database.
// The `public` schema belongs to another app (store tables), so all tables
// of this project live in `agentos` (see supabase/schema.sql).
export const agentos = pgSchema("agentos");

export const users = agentos.table("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull().default("admin"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const agents = agentos.table("agents", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  role: text("role").notNull(),
  specialty: text("specialty").notNull().default("crypto"), // crypto | freelance | content | bot | custom_api
  avatar: text("avatar").notNull().default("🤖"),
  status: text("status").notNull().default("active"), // active | working | paused
  apiEndpoint: text("api_endpoint").notNull().default("/api/agents/ingest"),
  apiKey: text("api_key").notNull(),
  earnedUsdt: real("earned_usdt").notNull().default(0),
  tasksCompleted: integer("tasks_completed").notNull().default(0),
  payoutMode: text("payout_mode").notNull().default("auto_unified"),
  strategy: text("strategy").notNull().default(""),
  createdAt: timestamp("created_at").defaultNow(),
});

export const projects = agentos.table("projects", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  clientName: text("client_name").notNull(),
  telegramUser: text("telegram_user").notNull().default(""),
  source: text("source").notNull().default("تلگرام"),
  type: text("type").notNull().default("nextjs"),
  status: text("status").notNull().default("new"),
  priority: text("priority").notNull().default("medium"),
  budgetUsdt: real("budget_usdt").notNull().default(0),
  receivedUsdt: real("received_usdt").notNull().default(0),
  wallet: text("wallet").notNull().default(""),
  deadline: text("deadline").notNull().default(""),
  description: text("description").notNull().default(""),
  createdAt: timestamp("created_at").defaultNow(),
});

export const tasks = agentos.table("tasks", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  agent: text("agent").notNull().default("ایجنت مذاکره"),
  actionType: text("action_type").notNull().default("send_message"),
  description: text("description").notNull().default(""),
  projectTitle: text("project_title").notNull().default(""),
  status: text("status").notNull().default("pending"),
  risk: text("risk").notNull().default("medium"),
  payload: text("payload").notNull().default(""),
  createdAt: timestamp("created_at").defaultNow(),
});

export const messages = agentos.table("messages", {
  id: serial("id").primaryKey(),
  chatId: text("chat_id").notNull().default(""),
  clientName: text("client_name").notNull(),
  username: text("username").notNull().default(""),
  direction: text("direction").notNull().default("in"),
  text: text("text").notNull(),
  status: text("status").notNull().default("read"),
  source: text("source").notNull().default("telegram"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const transactions = agentos.table("transactions", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  projectTitle: text("project_title").notNull().default(""),
  agentName: text("agent_name").notNull().default("سیستم مرکزی"),
  destinationWallet: text("destination_wallet").notNull().default(""),
  amountUsdt: real("amount_usdt").notNull().default(0),
  network: text("network").notNull().default("TRC20"),
  txHash: text("tx_hash").notNull().default(""),
  kind: text("kind").notNull().default("income"),
  status: text("status").notNull().default("confirmed"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const agentLogs = agentos.table("agent_logs", {
  id: serial("id").primaryKey(),
  agent: text("agent").notNull(),
  action: text("action").notNull(),
  status: text("status").notNull().default("success"),
  detail: text("detail").notNull().default(""),
  durationMs: integer("duration_ms").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const toolRuns = agentos.table("tool_runs", {
  id: serial("id").primaryKey(),
  tool: text("tool").notNull(),
  input: text("input").notNull().default(""),
  output: text("output").notNull().default(""),
  status: text("status").notNull().default("done"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const settings = agentos.table("settings", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value").notNull().default(""),
});

// ===========================================================================
// 🪙 میز کار ایجنت تریدر (A1 - آریا)
// ===========================================================================

// پیشنهادهای معامله (قبل از تأیید انسانی)
export const tradeSignals = agentos.table("trade_signals", {
  id: serial("id").primaryKey(),
  agentId: integer("agent_id").notNull(),
  agentName: text("agent_name").notNull(),
  symbol: text("symbol").notNull().default("BTC/USDT"),
  side: text("side").notNull(), // LONG | SHORT
  entryPrice: real("entry_price").notNull(),
  takeProfit: real("take_profit").notNull(),
  stopLoss: real("stop_loss").notNull(),
  targetPct: real("target_pct").notNull().default(0),
  stopPct: real("stop_pct").notNull().default(0),
  riskReward: real("risk_reward").notNull().default(0),
  leverage: integer("leverage").notNull().default(3),
  positionUsdt: real("position_usdt").notNull().default(500),
  estimatedProfitUsdt: real("estimated_profit_usdt").notNull().default(0),
  estimatedHoursMin: integer("estimated_hours_min").notNull().default(1),
  estimatedHoursMax: integer("estimated_hours_max").notNull().default(6),
  confidence: real("confidence").notNull().default(0),
  rsi: real("rsi").notNull().default(0),
  macdHist: real("macd_hist").notNull().default(0),
  ma20: real("ma20").notNull().default(0),
  ma50: real("ma50").notNull().default(0),
  support: real("support").notNull().default(0),
  resistance: real("resistance").notNull().default(0),
  fearGreed: integer("fear_greed").notNull().default(50),
  orderbookImbalance: real("orderbook_imbalance").notNull().default(0),
  whaleFlowUsdt: real("whale_flow_usdt").notNull().default(0),
  sentiment: real("sentiment").notNull().default(0),
  volatilityPct: real("volatility_pct").notNull().default(0),
  dataSource: text("data_source").notNull().default("fallback"),
  dataSources: text("data_sources").notNull().default("[]"),
  analysisReason: text("analysis_reason").notNull().default(""),
  riskNotes: text("risk_notes").notNull().default(""),
  telegramMessage: text("telegram_message").notNull().default(""),
  status: text("status").notNull().default("pending"), // pending|approved|rejected|expired
  decidedBy: text("decided_by").notNull().default(""),
  decidedAt: timestamp("decided_at"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// پوزیشنهای باز/بسته با PnL لحظهای
export const tradePositions = agentos.table("trade_positions", {
  id: serial("id").primaryKey(),
  signalId: integer("signal_id"),
  agentId: integer("agent_id").notNull(),
  agentName: text("agent_name").notNull(),
  symbol: text("symbol").notNull(),
  side: text("side").notNull(),
  entryPrice: real("entry_price").notNull(),
  currentPrice: real("current_price").notNull().default(0),
  takeProfit: real("take_profit").notNull(),
  stopLoss: real("stop_loss").notNull(),
  sizeUsdt: real("size_usdt").notNull(),
  leverage: integer("leverage").notNull().default(3),
  quantity: real("quantity").notNull().default(0),
  unrealizedPnl: real("unrealized_pnl").notNull().default(0),
  realizedPnl: real("realized_pnl").notNull().default(0),
  pnlPct: real("pnl_pct").notNull().default(0),
  mode: text("mode").notNull().default("paper"), // paper | live
  status: text("status").notNull().default("open"), // open | closed
  closeReason: text("close_reason").notNull().default(""),
  exchangeOrderId: text("exchange_order_id").notNull().default(""),
  openedAt: timestamp("opened_at").defaultNow(),
  closedAt: timestamp("closed_at"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// دفترچه خاطرات / لاگ تحلیل ایجنت (Brain Dump)
export const agentJournal = agentos.table("agent_journal", {
  id: serial("id").primaryKey(),
  agentId: integer("agent_id").notNull(),
  agentName: text("agent_name").notNull(),
  kind: text("kind").notNull().default("scan"), // scan|skip|signal|trade|close|review|system
  mood: text("mood").notNull().default("focused"),
  text: text("text").notNull(),
  meta: text("meta").notNull().default("{}"),
  createdAt: timestamp("created_at").defaultNow(),
});

// کش اسنپشات بازار (برای نمایشگر زنده و جلوگیری از تماس مکرر با API)
export const marketSnapshots = agentos.table("market_snapshots", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull(),
  price: real("price").notNull(),
  rsi: real("rsi").notNull().default(0),
  macdHist: real("macd_hist").notNull().default(0),
  ma20: real("ma20").notNull().default(0),
  ma50: real("ma50").notNull().default(0),
  support: real("support").notNull().default(0),
  resistance: real("resistance").notNull().default(0),
  fearGreed: integer("fear_greed").notNull().default(50),
  orderbookImbalance: real("orderbook_imbalance").notNull().default(0),
  whaleFlowUsdt: real("whale_flow_usdt").notNull().default(0),
  sentiment: real("sentiment").notNull().default(0),
  volumeUsdt: real("volume_usdt").notNull().default(0),
  volatilityPct: real("volatility_pct").notNull().default(0),
  source: text("source").notNull().default("fallback"),
  sources: text("sources").notNull().default("[]"),
  notes: text("notes").notNull().default("[]"),
  candles: integer("candles").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

// ===========================================================================
// 🏆 لیگ کارمندان (Agent Leaderboard / Employee of the Month)
// ===========================================================================

// دفترچهٔ تغییرناپذیر نتایج پروژه‌ها. هر ردیف = یک نتیجهٔ نهایی (تأیید/رد/خطا).
// source_ref یک کلید یکتا برای جلوگیری از دوباره‌شماری است (مثلاً task:12:approve).
export const agentScoreEvents = agentos.table("agent_score_events", {
  id: serial("id").primaryKey(),
  agentId: integer("agent_id").notNull(),
  agentName: text("agent_name").notNull(),
  period: text("period").notNull(), // YYYY-MM (UTC)
  outcome: text("outcome").notNull(), // success | failure | error
  projectTitle: text("project_title").notNull().default(""),
  durationMinutes: real("duration_minutes").notNull().default(0), // پیشنهاد → تأیید نهایی
  points: integer("points").notNull().default(0), // +10 موفقیت / -5 شکست / -8 خطای اجرایی
  source: text("source").notNull().default("manual"), // manual | hitl | ingest | api | seed
  sourceRef: text("source_ref").unique(),
  note: text("note").notNull().default(""),
  createdAt: timestamp("created_at").defaultNow(),
});

// اسنپ‌شات برندهٔ هر ماه (یک ردیف برای هر دوره) + وضعیت ارسال گزارش تلگرام.
export const agentMonthlyAwards = agentos.table("agent_monthly_awards", {
  id: serial("id").primaryKey(),
  period: text("period").notNull().unique(),
  agentId: integer("agent_id").notNull(),
  agentName: text("agent_name").notNull(),
  avatar: text("avatar").notNull().default("🤖"),
  score: real("score").notNull().default(0),
  successRate: real("success_rate").notNull().default(0),
  totalProjects: integer("total_projects").notNull().default(0),
  successCount: integer("success_count").notNull().default(0),
  revenueUsdt: real("revenue_usdt").notNull().default(0),
  avgDurationMinutes: real("avg_duration_minutes").notNull().default(0),
  points: integer("points").notNull().default(0),
  runnersUp: text("runners_up").notNull().default("[]"), // JSON string
  telegramMessage: text("telegram_message").notNull().default(""),
  telegramSent: boolean("telegram_sent").notNull().default(false),
  boostMultiplier: real("boost_multiplier").notNull().default(2),
  createdAt: timestamp("created_at").defaultNow(),
});
