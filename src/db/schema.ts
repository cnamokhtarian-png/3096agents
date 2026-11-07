import {
  pgSchema,
  text,
  serial,
  integer,
  real,
  timestamp,
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
