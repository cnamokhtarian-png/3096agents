import {
  pgSchema,
  text,
  serial,
  bigserial,
  integer,
  real,
  boolean,
  timestamp,
  jsonb,
  numeric,
  bigint,
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
  department: text("department").notNull().default(""),
  goalTitle: text("goal_title").notNull().default(""),
  goalTargetUsdt: real("goal_target_usdt").notNull().default(0),
  officeFloor: text("office_floor").notNull().default("1"),
  officeRoom: text("office_room").notNull().default(""),
  currentFocus: text("current_focus").notNull().default(""),
  successCount: integer("success_count").notNull().default(0),
  errorCount: integer("error_count").notNull().default(0),
  lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
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
  verified: boolean("verified").notNull().default(false),
  source: text("source").notNull().default("manual"),
  reference: text("reference").notNull().default(""),
  jobId: integer("job_id"),
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


// ---------------------------------------------------------------------------
// Production tables (no mock data): real execution ledger, job queue,
// exchange orders, market snapshots, telegram dedupe, cron runs, system events.
// ---------------------------------------------------------------------------

export const agentActivityLogs = agentos.table("agent_activity_logs", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  agentId: integer("agent_id"),
  agentName: text("agent_name").notNull(),
  action: text("action").notNull(),
  status: text("status").notNull().default("success"),
  detail: text("detail").notNull().default(""),
  rewardUsdt: real("reward_usdt").notNull().default(0),
  txHash: text("tx_hash").notNull().default(""),
  jobId: integer("job_id"),
  source: text("source").notNull().default("system"),
  meta: jsonb("meta").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const agentJobs = agentos.table("agent_jobs", {
  id: serial("id").primaryKey(),
  agentId: integer("agent_id"),
  agentName: text("agent_name").notNull(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  detail: text("detail").notNull().default(""),
  payload: jsonb("payload").notNull().default({}),
  status: text("status").notNull().default("queued"),
  risk: text("risk").notNull().default("medium"),
  requiresApproval: boolean("requires_approval").notNull().default(true),
  attempts: integer("attempts").notNull().default(0),
  result: jsonb("result"),
  error: text("error").notNull().default(""),
  approvedBy: text("approved_by").notNull().default(""),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  telegramMessageId: bigint("telegram_message_id", { mode: "number" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const exchangeOrders = agentos.table("exchange_orders", {
  id: serial("id").primaryKey(),
  exchange: text("exchange").notNull().default("binance"),
  testnet: boolean("testnet").notNull().default(false),
  symbol: text("symbol").notNull(),
  side: text("side").notNull(),
  orderType: text("order_type").notNull().default("MARKET"),
  quantity: numeric("quantity"),
  quoteQty: numeric("quote_qty"),
  price: numeric("price"),
  status: text("status").notNull().default("NEW"),
  clientOrderId: text("client_order_id").notNull().unique(),
  exchangeOrderId: text("exchange_order_id").notNull().default(""),
  agentName: text("agent_name").notNull().default(""),
  jobId: integer("job_id"),
  raw: jsonb("raw"),
  error: text("error").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const marketSnapshots = agentos.table("market_snapshots", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull(),
  price: numeric("price").notNull(),
  changePct: numeric("change_pct"),
  rsi: real("rsi").notNull().default(0),
  macdHist: real("macd_hist").notNull().default(0),
  ma20: real("ma20").notNull().default(0),
  ma50: real("ma50").notNull().default(0),
  support: real("support").notNull().default(0),
  resistance: real("resistance").notNull().default(0),
  volumeUsdt: real("volume_usdt").notNull().default(0),
  volatilityPct: real("volatility_pct").notNull().default(0),
  candles: integer("candles").notNull().default(0),
  source: text("source").notNull().default("binance"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow(),
});

export const tradeSignals = agentos.table("trade_signals", {
  id: serial("id").primaryKey(),
  agentId: integer("agent_id").notNull(),
  agentName: text("agent_name").notNull(),
  symbol: text("symbol").notNull().default("BTCUSDT"),
  side: text("side").notNull(),
  entryPrice: real("entry_price").notNull(),
  takeProfit: real("take_profit").notNull(),
  stopLoss: real("stop_loss").notNull(),
  targetPct: real("target_pct").notNull().default(0),
  stopPct: real("stop_pct").notNull().default(0),
  riskReward: real("risk_reward").notNull().default(0),
  leverage: integer("leverage").notNull().default(2),
  positionUsdt: real("position_usdt").notNull().default(50),
  estimatedProfitUsdt: real("estimated_profit_usdt").notNull().default(0),
  estimatedHoursMin: integer("estimated_hours_min").notNull().default(4),
  estimatedHoursMax: integer("estimated_hours_max").notNull().default(12),
  confidence: real("confidence").notNull().default(0),
  rsi: real("rsi").notNull().default(0),
  macdHist: real("macd_hist").notNull().default(0),
  ma20: real("ma20").notNull().default(0),
  ma50: real("ma50").notNull().default(0),
  support: real("support").notNull().default(0),
  resistance: real("resistance").notNull().default(0),
  volatilityPct: real("volatility_pct").notNull().default(0),
  dataSource: text("data_source").notNull().default("binance"),
  analysisReason: text("analysis_reason").notNull().default(""),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const telegramUpdates = agentos.table("telegram_updates", {
  updateId: bigint("update_id", { mode: "number" }).primaryKey(),
  kind: text("kind").notNull().default("message"),
  payload: jsonb("payload").notNull().default({}),
  processed: boolean("processed").notNull().default(false),
  error: text("error").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const cronRuns = agentos.table("cron_runs", {
  id: serial("id").primaryKey(),
  job: text("job").notNull(),
  status: text("status").notNull().default("ok"),
  detail: text("detail").notNull().default(""),
  durationMs: integer("duration_ms").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const systemEvents = agentos.table("system_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  level: text("level").notNull().default("info"),
  scope: text("scope").notNull().default("app"),
  message: text("message").notNull(),
  meta: jsonb("meta").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});
