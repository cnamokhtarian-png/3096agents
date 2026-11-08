"use client";

import ExchangeDetails from "@/components/ExchangeDetails";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import OfficeCard from "@/components/OfficeCard";
import { themeFor, relativeTime } from "@/lib/office-theme";

const fa = (n: any) => Number(n || 0).toLocaleString("fa-IR", { maximumFractionDigits: 2 });
const dt = (d: any) =>
  d ? new Date(d).toLocaleString("fa-IR", { dateStyle: "short", timeStyle: "short" }) : "—";

const statusMap: Record<string, [string, string]> = {
  new: ["جدید", "bg-blue-100 text-blue-700"],
  negotiating: ["در مذاکره", "bg-amber-100 text-amber-700"],
  approved: ["تأیید شده", "bg-violet-100 text-violet-700"],
  in_progress: ["در حال انجام", "bg-cyan-100 text-cyan-700"],
  delivered: ["تحویل شده", "bg-indigo-100 text-indigo-700"],
  paid: ["تسویه شده", "bg-emerald-100 text-emerald-700"],
  cancelled: ["لغو", "bg-red-100 text-red-600"],
  pending: ["در انتظار تأیید", "bg-amber-100 text-amber-700"],
};

const typeMap: Record<string, string> = {
  nextjs: "Next.js ⚛️",
  pptx: "PPTX 📊",
  translation: "ترجمه 🌐",
  bot: "ربات تلگرام 🤖",
  ai_agent: "ایجنت AI 🧠",
  other: "سایر",
};

const specialtyMap: Record<string, string> = {
  crypto: "🪙 رمزارز و ترید",
  freelance: "⚛️ توسعه و فریلنسری",
  bot: "🤖 فروش و تلگرام",
  content: "📊 محتوا و ترجمه",
  custom_api: "🔌 API خارجی",
};

const tradeStatus: Record<string, [string, string]> = {
  awaiting_approval: ["منتظر تأیید", "bg-amber-500/15 text-amber-300 border-amber-400/30"],
  approved: ["تأییدشده", "bg-sky-500/15 text-sky-300 border-sky-400/30"],
  running: ["در حال اجرا", "bg-cyan-500/15 text-cyan-300 border-cyan-400/30"],
  succeeded: ["موفق", "bg-emerald-500/15 text-emerald-300 border-emerald-400/30"],
  failed: ["ناموفق", "bg-red-500/15 text-red-300 border-red-400/30"],
  rejected: ["رد شده", "bg-slate-500/15 text-slate-300 border-slate-400/30"],
  queued: ["در صف", "bg-slate-500/15 text-slate-300 border-slate-400/30"],
  needs_config: ["نیازمند تنظیمات", "bg-orange-500/15 text-orange-300 border-orange-400/30"],
  expired: ["منقضی", "bg-slate-500/15 text-slate-400 border-slate-400/30"],
};

/** کارهایی که واقعاً آماده اجرا هستند (پیش‌بررسی سرور). */
const isApprovable = (j: any) => Boolean(j?.canApprove);
/** آیا وضعیت کار «قابل تصمیم» است؟ (کارهای failed/needs_config دکمه تلاش دوباره دارند) */
const JOB_DECIDABLE = ["awaiting_approval", "queued"];

export default function Control() {
  const [view, setView] = useState("hq");
  const [user, setUser] = useState<any>(null);
  const [projects, setProjects] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [msgs, setMsgs] = useState<any[]>([]);
  const [txs, setTxs] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [activity, setActivity] = useState<any[]>([]);
  const [tools, setTools] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [agentsList, setAgentsList] = useState<any[]>([]);
  const [walletInfo, setWalletInfo] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [cooData, setCooData] = useState<any>(null);
  const [logFilter, setLogFilter] = useState<"all" | "success" | "pending" | "error">("all");
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState("");
  const [dept, setDept] = useState("all");

  // پروژه‌ها
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [edit, setEdit] = useState<any>(null);
  const [form, setForm] = useState<any>({
    title: "",
    clientName: "",
    telegramUser: "",
    source: "تلگرام",
    type: "nextjs",
    status: "new",
    priority: "medium",
    budgetUsdt: "",
    receivedUsdt: "",
    deadline: "",
    description: "",
    wallet: "",
  });

  // چت و ابزار
  const [chatUser, setChatUser] = useState("");
  const [chatText, setChatText] = useState("");
  const [toolInput, setToolInput] = useState("");
  const [toolOut, setToolOut] = useState("");

  // درآمد دستی (با شاهد)
  const [txForm, setTxForm] = useState<any>({
    title: "",
    agentName: "",
    amountUsdt: "",
    network: "TRC20",
    txHash: "",
    projectTitle: "",
  });

  // کیف پول و کارمند جدید
  const [walletForm, setWalletForm] = useState({ address: "", network: "USDT-TRC20", autoSweep: true });
  // تنظیمات واقعی صرافی (کار واقعی)
  const [exInfo, setExInfo] = useState<any>(null);
  const [exForm, setExForm] = useState({ apiKey: "", apiSecret: "", testnet: true });
  const [exTest, setExTest] = useState<any>(null);
  const [exchangeTestedAt, setExchangeTestedAt] = useState<string | null>(null);

  const [newAgent, setNewAgent] = useState({
    name: "",
    role: "",
    specialty: "crypto",
    department: "",
    goalTitle: "",
    goalTargetUsdt: "",
  });

  const notify = (t: string) => {
    setToast(t);
    setTimeout(() => setToast(""), 4500);
  };
  const copyText = (txt: string, label = "کپی شد ✅") => {
    if (typeof navigator !== "undefined" && navigator.clipboard) navigator.clipboard.writeText(txt).catch(() => {});
    notify(label);
  };

  async function load() {
    const [p, t, m, tx, l, tl, ag, wl, s, act, jb, coo] = await Promise.all([
      fetch("/api/projects").then((r) => r.json()).catch(() => []),
      fetch("/api/rest?type=tasks").then((r) => r.json()).catch(() => []),
      fetch("/api/rest?type=messages").then((r) => r.json()).catch(() => []),
      fetch("/api/rest?type=transactions").then((r) => r.json()).catch(() => []),
      fetch("/api/rest?type=logs").then((r) => r.json()).catch(() => []),
      fetch("/api/rest?type=tools").then((r) => r.json()).catch(() => []),
      fetch("/api/agents").then((r) => r.json()).catch(() => ({})),
      fetch("/api/wallet").then((r) => r.json()).catch(() => null),
      fetch("/api/stats").then((r) => r.json()).catch(() => null),
      fetch("/api/rest?type=activity").then((r) => r.json()).catch(() => []),
      fetch("/api/jobs").then((r) => r.json()).catch(() => []),
      fetch("/api/coo").then((r) => r.json()).catch(() => null),
    ]);
    fetch("/api/exchange")
      .then((r) => r.json())
      .then((d) => d?.ok && setExInfo(d))
      .catch(() => {});
    setProjects(Array.isArray(p) ? p : []);
    setTasks(Array.isArray(t) ? t : []);
    setMsgs(Array.isArray(m) ? m : []);
    setTxs(Array.isArray(tx) ? tx : []);
    setLogs(Array.isArray(l) ? l : []);
    setTools(Array.isArray(tl) ? tl : []);
    setActivity(Array.isArray(act) ? act : []);
    setJobs(Array.isArray(jb) ? jb : []);
    if (coo?.ok) setCooData(coo);
    setAgentsList(Array.isArray(ag?.agents) ? ag.agents : []);
    setWalletInfo(wl);
    if (wl?.masterWallet) {
      setWalletForm({
        address: wl.masterWallet.address || "",
        network: wl.masterWallet.network || "USDT-TRC20",
        autoSweep: wl.masterWallet.autoSweep !== false,
      });
    }
    setStats(s);
    setLoading(false);
  }

  useEffect(() => {
    let iv: ReturnType<typeof setInterval> | null = null;
    fetch("/api/auth/login")
      .then((r) => r.json())
      .then((d) => {
        if (!d.user) {
          location.href = "/login";
          return;
        }
        setUser(d.user);
        load();
        iv = setInterval(() => {
          fetch("/api/stats").then((r) => r.json()).then(setStats).catch(() => {});
          fetch("/api/rest?type=activity")
            .then((r) => r.json())
            .then((x) => Array.isArray(x) && setActivity(x))
            .catch(() => {});
        }, 10000);
      })
      .catch(() => {
        location.href = "/login";
      });
    return () => {
      if (iv) clearInterval(iv);
    };
  }, []);

  /* ── محاسبات مشتق‌شده از داده واقعی ───────────────────────────── */
  const startOfDay = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, []);

  const byAgent = useMemo(() => {
    const map = new Map<string, { todayEarned: number; lastAt: string | null; failed: number }>();
    for (const a of activity) {
      const cur = map.get(a.agentName) || { todayEarned: 0, lastAt: null, failed: 0 };
      const t = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      if (t >= startOfDay) cur.todayEarned += Number(a.rewardUsdt || 0);
      if (a.status === "failed") cur.failed += 1;
      if (!cur.lastAt || t > new Date(cur.lastAt).getTime()) cur.lastAt = a.createdAt || cur.lastAt;
      map.set(a.agentName, cur);
    }
    return map;
  }, [activity, startOfDay]);

  const pendingJobsByAgent = useMemo(() => {
    const map = new Map<number, number>();
    for (const j of jobs) {
      if (["queued", "awaiting_approval", "approved", "running"].includes(j.status)) {
        map.set(j.agentId, (map.get(j.agentId) || 0) + 1);
      }
    }
    return map;
  }, [jobs]);

  const awaitingJobs = jobs.filter((j) => j.status === "awaiting_approval");
  const pendingTasks = tasks.filter((t) => t.status === "pending");
  const market = stats?.market;
  const marketLine = market?.entries?.length
    ? market.entries.map((e: any) => `${e.symbol.replace("USDT", "")} ${fa(e.price)}`).join(" · ")
    : "";
  const marketStale = market?.entries?.some((e: any) => e.stale);

  const filteredProjects = projects.filter(
    (p) =>
      (filter === "all" || p.status === filter) &&
      (p.title + p.clientName + (p.telegramUser || "")).includes(q)
  );

  const chatList = useMemo(() => {
    const map = new Map<string, any>();
    msgs.forEach((m) => {
      if (!map.has(m.clientName)) map.set(m.clientName, m);
    });
    return [...map.values()];
  }, [msgs]);
  const chatMsgs = msgs.filter((m) => m.clientName === chatUser).slice().reverse();
  const activeChat = chatUser || chatList[0]?.clientName || "";

  const offices = useMemo(
    () =>
      agentsList.filter((a) => dept === "all" || a.specialty === dept),
    [agentsList, dept]
  );

  const totalFleetEarned = agentsList.reduce((s, a) => s + Number(a.earnedUsdt || 0), 0);
  const maxChart = Math.max(1, ...(stats?.chart?.map((c: any) => Number(c.v) || 0) || [1]));

  /* ── عملیات ──────────────────────────────────────────────────── */
  async function api(url: string, method: string, body?: any) {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || `خطای ${res.status}`);
    return d;
  }

  async function saveProject(e: any) {
    e.preventDefault();
    try {
      if (edit) await api("/api/projects", "PUT", { ...form, id: edit.id });
      else await api("/api/projects", "POST", form);
      notify(edit ? "پروژه ویرایش شد ✅" : "پروژه جدید ساخته شد ✅");
      setShowForm(false);
      setEdit(null);
      await load();
    } catch (err: any) {
      notify(`⚠️ ${err.message}`);
    }
  }

  async function delProject(id: number) {
    if (!confirm("این پروژه حذف شود؟")) return;
    try {
      await api(`/api/projects?id=${id}`, "DELETE");
      notify("پروژه حذف شد 🗑️");
      await load();
    } catch (err: any) {
      notify(`⚠️ ${err.message}`);
    }
  }

  async function actTask(t: any, st: string) {
    try {
      await api("/api/rest", "PUT", { _type: "tasks", id: t.id, status: st });
      notify(st === "approved" ? "تسک تأیید و در لاگ ثبت شد ✅" : "تسک رد شد ❌");
      await load();
    } catch (err: any) {
      notify(`⚠️ ${err.message}`);
    }
  }

  async function jobAction(id: number, action: "approve" | "reject" | "retry") {
    setBusy(`job-${id}`);
    try {
      const d = await api("/api/jobs", "PATCH", { id, action });
      if (action === "reject") notify("کار رد شد ❌");
      else if (action === "retry") {
        if (d.ok) notify("اجرای دوباره با موفقیت انجام شد ✅");
        else notify(`⚠️ اجرای دوباره ناموفق: ${d.execution?.error || d.error || ""}`);
      } else if (d.execution?.ok) notify("کار با موفقیت اجرا شد ✅");
      else notify(`⚠️ اجرا ناموفق: ${d.execution?.error || d.error || ""}`);
      await load();
    } catch (err: any) {
      notify(`⚠️ ${err.message}`);
    } finally {
      setBusy("");
    }
  }

  async function sendChat() {
    if (!chatText.trim() || !activeChat) return;
    setBusy("chat");
    try {
      const target = chatList.find((c) => c.clientName === activeChat);
      const d = await api("/api/telegram/send", "POST", {
        action: "client_message",
        chatId: target?.chatId || "",
        clientName: activeChat,
        username: target?.username || "",
        text: chatText,
      });
      if (d.ok) {
        notify("پیام واقعی از طریق ربات تلگرام ارسال شد 📩");
        setChatText("");
        await load();
      } else {
        notify(`⚠️ ارسال نشد: ${d.telegram || "تلگرام تنظیم نشده"}`);
      }
    } catch (err: any) {
      notify(`⚠️ ${err.message}`);
    } finally {
      setBusy("");
    }
  }

  async function runTool(tool: string) {
    if (!toolInput.trim()) {
      notify("ورودی ابزار را وارد کنید");
      return;
    }
    setBusy("tool");
    setToolOut("⏳ در حال ارسال به ورکر واقعی…");
    try {
      const d = await api("/api/tools/run", "POST", { tool, input: toolInput });
      setToolOut(d.output || "ورکر خروجی متنی برنگرداند.");
      notify("اجرای ابزار در دفتر کارمند ثبت شد ✅");
      await load();
    } catch (err: any) {
      setToolOut(`⛔ ${err.message}`);
      notify(`⚠️ ${err.message}`);
    } finally {
      setBusy("");
    }
  }

  async function addIncome(e: any) {
    e.preventDefault();
    try {
      const d = await api("/api/rest", "POST", { _type: "transactions", ...txForm });
      notify(d.duplicate ? "این هش قبلاً ثبت شده بود ⚠️" : "درآمد واقعی با شاهد ثبت شد ✅");
      setTxForm({ title: "", agentName: "", amountUsdt: "", network: "TRC20", txHash: "", projectTitle: "" });
      await load();
    } catch (err: any) {
      notify(`⚠️ ${err.message}`);
    }
  }

  async function createNewAgent(e: any) {
    e.preventDefault();
    if (!newAgent.name.trim()) return;
    try {
      const created = await api("/api/agents", "POST", newAgent);
      notify(`کارمند «${created.name}» استخدام و اتاقش آماده شد ✅`);
      setNewAgent({ name: "", role: "", specialty: "crypto", department: "", goalTitle: "", goalTargetUsdt: "" });
      await load();
    } catch (err: any) {
      notify(`⚠️ ${err.message}`);
    }
  }

  async function toggleAgent(agent: any) {
    try {
      await api(`/api/agents/${agent.id}/command`, "POST", { action: "toggle" });
      await load();
      notify(agent.status === "active" ? "کارمند متوقف شد ⏸" : "کارمند فعال شد ▶️");
    } catch (err: any) {
      notify(`⚠️ ${err.message}`);
    }
  }

  async function deleteAgent(id: number) {
    if (!confirm("این کارمند و اتاقش حذف شود؟")) return;
    try {
      await api(`/api/agents?id=${id}`, "DELETE");
      notify("کارمند حذف شد 🗑️");
      await load();
    } catch (err: any) {
      notify(`⚠️ ${err.message}`);
    }
  }

  async function saveExchange(e: any) {
    e.preventDefault();
    try {
      const body: any = {};
      if (exForm.apiKey.trim()) body.apiKey = exForm.apiKey.trim();
      if (exForm.apiSecret.trim()) body.apiSecret = exForm.apiSecret.trim();
      body.testnet = exForm.testnet;
      const d = await api("/api/exchange", "PUT", body);
      if (d.ok) {
        notify(
          `کلیدهای صرافی ذخیره شد ✅ — حالت: ${d.status?.mode} • ` +
            (d.status?.canExecuteOrders ? "ارسال سفارش واقعی فعال است" : "تا روشن‌کردن قفل معامله، سفارش ارسال نمی‌شود")
        );
        setExForm({ apiKey: "", apiSecret: "", testnet: exForm.testnet });
        await load();
      }
    } catch (err: any) {
      notify(`⚠️ ${err.message}`);
    }
  }

  async function toggleRealTrading(next: boolean) {
    const msg = next
      ? "با فعال‌سازی، هر سفارشی که شما در پنل/تلگرام تأیید کنید به‌صورت واقعی به صرافی ارسال می‌شود. مطمئن هستید؟"
      : "ارسال سفارش واقعی قفل شود؟";
    if (!confirm(msg)) return;
    try {
      const d = await api("/api/exchange", "PUT", {
        tradingEnabled: next,
        confirm: next ? "ENABLE_REAL_TRADING" : undefined,
      });
      if (d.ok) {
        notify(next ? "ارسال سفارش واقعی فعال شد ⚠️ (هر سفارش هنوز نیاز به تأیید شما دارد)" : "ارسال سفارش واقعی قفل شد 🔒");
        await load();
      }
    } catch (err: any) {
      notify(`⚠️ ${err.message}`);
    }
  }

  async function testExchangeConnection() {
    setExTest({ loading: true });
    try {
      const d = await api("/api/exchange", "POST", {});
      setExTest(d);
      setExchangeTestedAt(new Date().toISOString());
      notify(d.test?.account ? "استعلام حساب صرافی انجام شد ✅" : `⚠️ حساب صرافی بررسی نشد: ${d.test?.accountError || "کلیدها را بررسی کنید"}`);
      await load();
    } catch (err: any) {
      setExTest({ error: err.message });
      notify(`⚠️ ${err.message}`);
    }
  }

  async function saveMasterWallet(e: any) {
    e.preventDefault();
    try {
      await api("/api/wallet", "PUT", walletForm);
      notify("آدرس کیف پول واحد ذخیره شد و در همه دفاتر اعمال شد 💳");
      await load();
    } catch (err: any) {
      notify(`⚠️ ${err.message}`);
    }
  }

  async function refreshMarket() {
    setBusy("market");
    try {
      const d = await api("/api/market", "POST");
      notify(`قیمت واقعی به‌روزرسانی شد: ${d.quotes?.map((x: any) => `${x.symbol} ${x.price}`).join(" • ")}`);
      await load();
    } catch (err: any) {
      notify(`⚠️ ${err.message}`);
    } finally {
      setBusy("");
    }
  }

  async function sendTelegramReport() {
    setBusy("tg");
    try {
      const d = await api("/api/coo", "POST", { action: "executive_report", sendTelegram: true });
      notify(
        d?.telegram?.ok
          ? "گزارش جامع RNAI (COO) به تلگرام شما ارسال شد ✅"
          : `گزارش در پنل ثبت شد (${d?.telegram?.error || "تلگرام نیاز به بررسی دارد"})`
      );
      await load();
    } catch (err: any) {
      notify(`⚠️ ${err.message}`);
    } finally {
      setBusy("");
    }
  }

  async function runCooCommand(action: "startup_directive" | "run_cycle" | "executive_report") {
    setBusy(`coo-${action}`);
    try {
      const d = await api("/api/coo", "POST", {
        action,
        forceAriaCard: true,
        sendTelegram: true,
      });
      if (action === "startup_directive") {
        notify("فرمان استارت‌آپ RNAI اجرا شد، موتورهای ناوگان روشن شدند و گزارش به تلگرام ارسال شد 🚀");
      } else if (action === "run_cycle") {
        notify("اسکن زنده آریا، بانتی‌هانتر و ایجنت‌های تخصصی با موفقیت اجرا شد 🔄");
      } else {
        notify("گزارش جامع اجرایی صادر و به تلگرام ارسال شد 📊");
      }
      if (d?.summary) setCooData((prev: any) => ({ ...(prev || {}), ok: true, summary: d.summary }));
      await load();
    } catch (err: any) {
      notify(`⚠️ ${err.message}`);
    } finally {
      setBusy("");
    }
  }

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#0B1220] text-white">
        <div className="text-center">
          <div className="text-5xl animate-bounce">🏢</div>
          <p className="mt-3 font-bold">در حال باز کردن ساختمان اداری…</p>
        </div>
      </div>
    );
  }

  const nav: [string, string][] = [
    ["hq", "🏢 ساختمان مرکزی"],
    ["agents", "👥 کارمندان و دفاتر"],
    ["projects", "💼 پروژه‌ها"],
    ["chats", "💬 گفتگوها"],
    ["approvals", "✅ صف تأیید"],
    ["earnings", "💰 کیف پول و درآمد"],
    ["tools", "⚡ ابزارها"],
    ["telegram", "📩 تلگرام"],
    ["logs", "🧾 گزارش کارمندان"],
  ];

  return (
    <div dir="rtl" className="min-h-screen bg-[#F3F5F9]">
      <div className="flex">
        {/* ── سایدبار ───────────────────────────────────────────── */}
        <aside className="sticky top-0 hidden h-screen w-72 flex-col overflow-y-auto bg-[#0B1220] p-5 text-white lg:flex">
          <Link href="/" className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 text-2xl">
              🏢
            </div>
            <div>
              <b className="text-sm">Agent Company OS</b>
              <p className="text-[11px] text-slate-400">دفتر مستقل هر کارمند</p>
            </div>
          </Link>

          <div className="mt-5 rounded-2xl border border-emerald-400/25 bg-emerald-500/10 p-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-bold text-emerald-300">💳 کیف پول واحد</span>
              <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-[9px] font-black text-black">
                {walletForm.network}
              </span>
            </div>
            <p className="mt-1 text-lg font-black">{fa(stats?.income ?? totalFleetEarned)} USDT</p>
            <p className="mt-0.5 truncate text-[10px] text-slate-300" dir="ltr">
              {walletForm.address || "آدرس ست نشده"}
            </p>
            {Number(stats?.incomePending) > 0 && (
              <p className="mt-1 rounded-lg bg-amber-500/15 px-2 py-1 text-[10px] text-amber-300">
                ⏳ {fa(stats.incomePending)} USDT در انتظار تأیید
              </p>
            )}
          </div>

          <nav className="mt-4 flex-1 space-y-1">
            {nav.map(([k, l]) => (
              <button
                key={k}
                onClick={() => setView(k)}
                className={`w-full rounded-xl px-3.5 py-2.5 text-right text-sm font-bold transition ${
                  view === k ? "bg-emerald-500 text-black" : "text-slate-200 hover:bg-white/10"
                }`}
              >
                {l}
                {k === "approvals" && awaitingJobs.length + pendingTasks.length > 0 && (
                  <span className="float-left rounded-full bg-red-500 px-1.5 text-[10px] text-white">
                    {fa(awaitingJobs.length + pendingTasks.length)}
                  </span>
                )}
              </button>
            ))}
            <Link
              href="/control/system"
              className="block w-full rounded-xl px-3.5 py-2.5 text-right text-sm font-bold text-slate-200 transition hover:bg-white/10"
            >
              🩺 دیباگ و لاگ سیستم
            </Link>
          </nav>

          <div className="mt-3 border-t border-white/10 pt-3 text-xs">
            <p className="font-bold">{user?.name || "مدیرعامل"}</p>
            <p className="text-slate-400">{user?.email}</p>
            <button
              onClick={async () => {
                await fetch("/api/auth/login", { method: "DELETE" }).catch(() => {});
                location.href = "/login";
              }}
              className="mt-2 text-red-300"
            >
              خروج ←
            </button>
          </div>
        </aside>

        {/* ── محتوا ─────────────────────────────────────────────── */}
        <main className="mx-auto w-full max-w-[1400px] p-4 md:p-7">
          <header className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-black md:text-3xl">{nav.find((n) => n[0] === view)?.[1] || "🏢 ساختمان مرکزی"}</h1>
              <p className="mt-1 text-xs text-slate-500">
                {fa(agentsList.length)} کارمند • {fa(agentsList.filter((a) => a.status === "active").length)} سر کار •{" "}
                {fa(awaitingJobs.length + pendingTasks.length)} مورد منتظر تأیید شما
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={refreshMarket}
                disabled={busy === "market"}
                className="rounded-full border bg-white px-3 py-2 text-xs font-bold disabled:opacity-50"
              >
                {busy === "market" ? "⏳" : "📡"} قیمت واقعی
              </button>
              {market?.entries?.length ? (
                <span className="rounded-full border bg-white px-3 py-2 text-xs">
                  {marketLine}{" "}
                  <span className={marketStale ? "text-amber-600" : "text-emerald-600"}>
                    {marketStale ? "• قدیمی" : "• زنده"}
                  </span>
                </span>
              ) : (
                <span className="rounded-full border bg-white px-3 py-2 text-xs text-slate-500">
                  قیمت بازار در دسترس نیست
                </span>
              )}
              <button
                onClick={sendTelegramReport}
                disabled={busy === "tg"}
                className="rounded-full bg-[#229ED9] px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
              >
                {busy === "tg" ? "⏳" : "📤"} گزارش روزانه به تلگرام
              </button>
            </div>
          </header>

          <div className="mt-4 flex gap-2 overflow-x-auto lg:hidden">
            {nav.map(([k, l]) => (
              <button
                key={k}
                onClick={() => setView(k)}
                className={`whitespace-nowrap rounded-full px-3 py-2 text-xs font-bold ${
                  view === k ? "bg-emerald-500 text-black" : "border bg-white"
                }`}
              >
                {l}
              </button>
            ))}
          </div>

          {/* ═══════════════ ساختمان مرکزی ═══════════════ */}
          {view === "hq" && (
            <section className="mt-4 space-y-4">
              <div className="relative overflow-hidden rounded-3xl bg-gradient-to-l from-[#0B1220] via-[#0f1b2e] to-[#081120] p-5 text-white md:p-7">
                <div className="pointer-events-none absolute -left-16 -top-16 h-52 w-52 rounded-full bg-emerald-500/20 blur-3xl" />
                <div className="pointer-events-none absolute -bottom-24 right-10 h-52 w-52 rounded-full bg-cyan-500/10 blur-3xl" />
                <div className="relative flex flex-wrap items-start justify-between gap-5">
                  <div>
                    <span className="rounded-full bg-emerald-500 px-3 py-1 text-[10px] font-black text-black">
                      دفتر مرکزی • مدیرعامل
                    </span>
                    <h2 className="mt-3 text-2xl font-black md:text-3xl">ساختمان اداری ایجنت‌ها</h2>
                    <p className="mt-2 max-w-xl text-xs leading-6 text-slate-300">
                      هر کارمند یک دفتر مستقل، هدف مشخص و گزارش واقعی دارد. درآمد فقط با شاهد تراکنش یا تأیید شما
                      ثبت می‌شود؛ هیچ عددی ساختگی نیست.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2 text-[10px]">
                      <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1">
                        کرون: {stats?.health?.lastCronAt ? relativeTime(stats.health.lastCronAt) : "اجرا نشده"}
                      </span>
                      <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1">
                        صرافی: {stats?.health?.exchange || "—"}
                      </span>
                      <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1">
                        معامله واقعی: {stats?.health?.trading ? "فعال" : "قفل"}
                      </span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-center md:grid-cols-4">
                    {[
                      ["درآمد تأییدشده", `${fa(stats?.income ?? 0)}`, "USDT"],
                      ["در انتظار تأیید", `${fa(stats?.incomePending ?? 0)}`, "USDT"],
                      ["کارمند فعال", `${fa(agentsList.filter((a) => a.status === "active").length)}`, "نفر"],
                      ["صف تأیید", `${fa(awaitingJobs.length)}`, "کار"],
                    ].map(([l, v, u]) => (
                      <div key={l} className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 backdrop-blur">
                        <p className="text-[9px] text-slate-400">{l}</p>
                        <p className="mt-0.5 text-lg font-black text-emerald-300">
                          {v}
                          <span className="mr-1 text-[8px] font-normal text-slate-400">{u}</span>
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* میز فرماندهی RNAI · مدیر ارشد اجرایی (COO) */}
              <div className="rounded-3xl border border-emerald-200/70 bg-gradient-to-l from-emerald-50/70 via-white to-cyan-50/60 p-4 md:p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-[#0B1220] px-2.5 py-0.5 text-[10px] font-black text-emerald-300">
                        🏛️ RNAI · مدیر ارشد اجرایی (COO)
                      </span>
                      <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-bold text-emerald-800">
                        🔒 قفل مالی Human-in-the-Loop فعال
                      </span>
                      {cooData?.summary?.topEmployee && (
                        <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-bold text-amber-800">
                          🥇 کارمند برتر: {cooData.summary.topEmployee.name} (+{fa(cooData.summary.topEmployee.realEarnedUsdt)} USDT)
                        </span>
                      )}
                    </div>
                    <p className="mt-1.5 text-[11px] leading-5 text-slate-600">
                      موتورهای پایش آریا (کریپتو)، بانتی‌هانتر (Web3) و ایجنت‌های تخصصی تحت نظارت مستقیم COO هستند؛ هیچ تراکنش مالی بدون تأیید [✅] شما اجرا نمی‌شود.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => runCooCommand("startup_directive")}
                      disabled={busy.startsWith("coo-")}
                      className="rounded-xl bg-[#0B1220] px-3.5 py-2 text-xs font-black text-emerald-300 transition hover:bg-slate-800 disabled:opacity-50"
                    >
                      {busy === "coo-startup_directive" ? "⏳ در حال اجرا…" : "🚀 فرمان استارت‌آپ ناوگان"}
                    </button>
                    <button
                      onClick={() => runCooCommand("run_cycle")}
                      disabled={busy.startsWith("coo-")}
                      className="rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-800 transition hover:bg-slate-50 disabled:opacity-50"
                    >
                      {busy === "coo-run_cycle" ? "⏳ اسکن…" : "🔄 اسکن زنده فرصت‌ها"}
                    </button>
                    <button
                      onClick={() => setView("logs")}
                      className="rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white transition hover:bg-emerald-700"
                    >
                      📊 لیدربورد و گزارش جامع
                    </button>
                  </div>
                </div>
              </div>

              {/* فیلتر دپارتمان */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1.5">
                  {[
                    ["all", "همه دفاتر"],
                    ["crypto", "🪙 بازار سرمایه"],
                    ["freelance", "⚛️ مهندسی"],
                    ["bot", "🤖 فروش"],
                    ["content", "📊 محتوا"],
                    ["custom_api", "🔌 یکپارچه‌سازی"],
                  ].map(([k, l]) => (
                    <button
                      key={k}
                      onClick={() => setDept(k)}
                      className={`rounded-full px-3 py-1.5 text-[11px] font-bold transition ${
                        dept === k ? "bg-[#0B1220] text-white" : "border bg-white text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {l}
                    </button>
                  ))}
                </div>
                <Link
                  href="/control/system"
                  className="text-[11px] font-bold text-slate-500 underline decoration-dotted"
                >
                  وضعیت زیرساخت و خطاها ←
                </Link>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {offices.map((a) => (
                  <OfficeCard
                    key={a.id}
                    agent={{
                      ...a,
                      lastActiveAt: a.lastActiveAt || byAgent.get(a.name)?.lastAt || null,
                    }}
                    todayEarned={byAgent.get(a.name)?.todayEarned || 0}
                    pendingJobs={pendingJobsByAgent.get(a.id) || 0}
                  />
                ))}
                {offices.length === 0 && (
                  <div className="col-span-full rounded-3xl border border-dashed bg-white p-10 text-center text-sm text-slate-500">
                    دفتری در این دپارتمان نیست. از بخش «کارمندان و دفاتر» کارمند جدید استخدام کنید.
                  </div>
                )}
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                {/* صف تأیید */}
                <div className="rounded-3xl border bg-white p-5">
                  <div className="flex items-center justify-between">
                    <h3 className="font-black">✅ منتظر تأیید شما</h3>
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                      {fa(awaitingJobs.length + pendingTasks.length)} مورد
                    </span>
                  </div>
                  {awaitingJobs.slice(0, 3).map((j: any) => (
                    <div key={j.id} className="mt-3 rounded-2xl border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-1">
                        <b className="text-xs">{j.title}</b>
                        <span className="rounded-full border px-2 py-0.5 text-[9px] text-slate-500">{j.kind}</span>
                      </div>
                      <p className="mt-1 text-[10px] text-slate-500">{j.agentName}</p>
                      {!isApprovable(j) && j.preflight?.blockers?.length > 0 && (
                        <p className="mt-1 rounded-lg bg-orange-50 px-2 py-1 text-[9px] leading-4 text-orange-700">
                          🔒 قفل: {j.preflight.blockers.map((b: any) => b.label).join(" • ")}
                        </p>
                      )}
                      <div className="mt-2 flex gap-2">
                        <button
                          onClick={() => jobAction(j.id, "approve")}
                          disabled={busy === `job-${j.id}` || !isApprovable(j)}
                          title={isApprovable(j) ? "" : j.preflight?.reason || "این کار آماده اجرا نیست"}
                          className="rounded-lg bg-emerald-500 px-3 py-1 text-[11px] font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          تأیید و اجرا ✅
                        </button>
                        <button
                          onClick={() => jobAction(j.id, "reject")}
                          className="rounded-lg bg-red-50 px-3 py-1 text-[11px] font-bold text-red-600"
                        >
                          رد ❌
                        </button>
                      </div>
                    </div>
                  ))}
                  {pendingTasks.slice(0, 2).map((t: any) => (
                    <div key={`t-${t.id}`} className="mt-3 rounded-2xl border p-3">
                      <b className="text-xs">{t.title}</b>
                      <p className="mt-1 text-[10px] text-slate-500">{t.agent}</p>
                      <div className="mt-2 flex gap-2">
                        <button
                          onClick={() => actTask(t, "approved")}
                          className="rounded-lg bg-emerald-500 px-3 py-1 text-[11px] font-black text-white"
                        >
                          تأیید ✅
                        </button>
                        <button
                          onClick={() => actTask(t, "rejected")}
                          className="rounded-lg bg-red-50 px-3 py-1 text-[11px] font-bold text-red-600"
                        >
                          رد ❌
                        </button>
                      </div>
                    </div>
                  ))}
                  {awaitingJobs.length + pendingTasks.length === 0 && (
                    <p className="mt-4 rounded-2xl bg-slate-50 p-6 text-center text-xs text-slate-400">
                      🎉 هیچ موردی منتظر تأیید نیست.
                    </p>
                  )}
                </div>

                {/* فعالیت زنده */}
                <div className="rounded-3xl border bg-white p-5">
                  <h3 className="font-black">📡 تابلوی فعالیت واقعی شرکت</h3>
                  <div className="mt-3 space-y-2">
                    {activity.slice(0, 6).map((a: any) => (
                      <div key={a.id} className="flex items-start gap-2 border-b pb-2 last:border-0">
                        <span
                          className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                            a.status === "failed" ? "bg-red-400" : a.status === "pending" ? "bg-amber-400" : "bg-emerald-400"
                          }`}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[11px] font-bold text-slate-700">{a.action}</p>
                          <p className="text-[10px] text-slate-400">
                            {a.agentName} • {relativeTime(a.createdAt)}
                            {Number(a.rewardUsdt) > 0 && (
                              <span className="mr-1 font-black text-emerald-600">+{fa(a.rewardUsdt)} USDT</span>
                            )}
                          </p>
                        </div>
                      </div>
                    ))}
                    {activity.length === 0 && (
                      <p className="rounded-2xl bg-slate-50 p-6 text-center text-xs text-slate-400">
                        هنوز رویدادی ثبت نشده. با «اسکن واقعی بازار» در دفتر کارمند رمزارز شروع کنید.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* ═══════════════ کارمندان و دفاتر ═══════════════ */}
          {view === "agents" && (
            <section className="mt-4 space-y-4">
              <div className="grid gap-4 lg:grid-cols-2">
                <form onSubmit={saveMasterWallet} className="rounded-3xl border bg-white p-5">
                  <h3 className="font-black">💳 کیف پول واحد (مقصد واریز همه کارمندان)</h3>
                  <p className="mt-1 text-[11px] text-slate-500">
                    هر درآمد تأییدشده به این آدرس و شبکه نسبت داده می‌شود.
                  </p>
                  <input
                    required
                    value={walletForm.address}
                    onChange={(e) => setWalletForm({ ...walletForm, address: e.target.value })}
                    placeholder="آدرس USDT"
                    dir="ltr"
                    className="mt-3 w-full rounded-xl border p-3 font-mono text-sm"
                  />
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <select
                      value={walletForm.network}
                      onChange={(e) => setWalletForm({ ...walletForm, network: e.target.value })}
                      className="rounded-xl border p-3 text-sm"
                    >
                      {["USDT-TRC20", "USDT-TON", "USDT-BEP20", "USDT-ERC20"].map((n) => (
                        <option key={n}>{n}</option>
                      ))}
                    </select>
                    <button className="rounded-xl bg-slate-900 py-3 text-sm font-bold text-white hover:bg-emerald-600">
                      ذخیره ✅
                    </button>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[10px]">
                    <div className="rounded-xl bg-slate-50 p-2">
                      <p className="text-slate-500">تأییدشده</p>
                      <b className="text-emerald-600">{fa(walletInfo?.confirmedDeposits ?? 0)}</b>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-2">
                      <p className="text-slate-500">در انتظار</p>
                      <b className="text-amber-600">{fa(walletInfo?.pendingDeposits ?? 0)}</b>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-2">
                      <p className="text-slate-500">موجودی صرافی</p>
                      <b className="text-slate-700">
                        {walletInfo?.exchange?.balance?.find((b: any) => b.asset === "USDT")?.total !== undefined
                          ? fa(walletInfo.exchange.balance.find((b: any) => b.asset === "USDT").total)
                          : "—"}
                      </b>
                    </div>
                  </div>
                </form>

                {/* ── کار واقعی: کلید صرافی + قفل معامله ─────────────── */}
                <div className="rounded-3xl border border-amber-200 bg-amber-50/40 p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-black">🏦 صرافی و روشن‌کردن کار واقعی</h3>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[10px] font-black ${
                        exInfo?.status?.canExecuteOrders
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-orange-100 text-orange-700"
                      }`}
                    >
                      {exInfo?.status?.canExecuteOrders
                        ? `تنظیمات ارسال سفارش فعال است (${exInfo?.status?.network})`
                        : "ارسال سفارش قفل است"}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] leading-5 text-slate-600">
                    {exInfo?.status?.message || "وضعیت صرافی در حال خواندن است…"}
                  </p>
                  <p className="mt-1 text-xs font-bold text-slate-700">صرافی انتخاب‌شده: {exInfo?.status?.exchange || "نامشخص"}</p>

                  {/* چراغ‌های وضعیت */}
                  <div className="mt-3 grid grid-cols-2 gap-2 text-[10px]">
                    <div className="rounded-xl bg-white p-2">
                      <p className="text-slate-500">کلید API</p>
                      <b className={exInfo?.status?.keysConfigured ? "text-emerald-600" : "text-red-600"}>
                        {exInfo?.keys?.apiKeyPreview || "ست نشده"}
                      </b>
                      <p className="text-[9px] text-slate-400">
                        منبع: {exInfo?.keys?.apiKeySource === "env" ? "Vercel Env" : exInfo?.keys?.apiKeySource === "db" ? "ذخیره‌شده در پنل" : "—"}
                      </p>
                    </div>
                    <div className="rounded-xl bg-white p-2">
                      <p className="text-slate-500">قفل معامله (AGENT_TRADING_ENABLED)</p>
                      <b className={exInfo?.status?.tradingEnabled ? "text-emerald-600" : "text-red-600"}>
                        {exInfo?.status?.tradingEnabled ? "باز — ارسال واقعی" : "بسته — ارسال واقعی ممنوع"}
                      </b>
                      <p className="text-[9px] text-slate-400">
                        شبکه: {exInfo?.keys?.testnet ? "Testnet (پیش‌فرض امن)" : "Mainnet ⚠️"}
                      </p>
                    </div>
                  </div>

                  {exInfo?.status?.blockers?.length > 0 && (
                    <ul className="mt-2 space-y-1 rounded-xl bg-white p-2">
                      {exInfo.status.blockers.map((b: any) => (
                        <li key={b.code} className="text-[10px] leading-4 text-orange-700">
                          • {b.label}
                          <span className="block text-[9px] text-slate-500">↳ {b.action}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  <form onSubmit={saveExchange} className="mt-3 space-y-2">
                    <input
                      value={exForm.apiKey}
                      onChange={(e) => setExForm({ ...exForm, apiKey: e.target.value })}
                      placeholder="EXCHANGE_API_KEY (خالی بگذارید تا تغییر نکند)"
                      dir="ltr"
                      autoComplete="off"
                      className="w-full rounded-xl border p-2.5 font-mono text-xs"
                    />
                    <input
                      value={exForm.apiSecret}
                      onChange={(e) => setExForm({ ...exForm, apiSecret: e.target.value })}
                      placeholder="EXCHANGE_SECRET_KEY (خالی بگذارید تا تغییر نکند)"
                      dir="ltr"
                      type="password"
                      autoComplete="off"
                      className="w-full rounded-xl border p-2.5 font-mono text-xs"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="flex items-center gap-1 rounded-xl bg-white px-2.5 py-1.5 text-[10px] font-bold">
                        <input
                          type="checkbox"
                          checked={exForm.testnet}
                          onChange={(e) => setExForm({ ...exForm, testnet: e.target.checked })}
                        />
                        Testnet (توصیه‌شده)
                      </label>
                      <button className="rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-bold text-white">
                        💾 ذخیره کلیدهای صرافی
                      </button>
                      <button
                        type="button"
                        onClick={testExchangeConnection}
                        className="rounded-xl border bg-white px-3.5 py-2 text-xs font-bold"
                      >
                        {exTest?.loading ? "⏳ تست…" : "🔍 تست واقعی اتصال"}
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleRealTrading(!exInfo?.status?.tradingEnabled)}
                        className={`rounded-xl px-3.5 py-2 text-xs font-black ${
                          exInfo?.status?.tradingEnabled
                            ? "bg-red-100 text-red-700"
                            : "bg-amber-400 text-black"
                        }`}
                      >
                        {exInfo?.status?.tradingEnabled ? "🔒 قفل ارسال سفارش" : "⚠️ باز کردن قفل ارسال واقعی"}
                      </button>
                    </div>
                  </form>

                  <ExchangeDetails test={exTest?.test} testedAt={exchangeTestedAt} wallet={walletInfo?.masterWallet} />
                  {exTest?.error && <p role="alert" className="mt-2 text-xs text-red-700">خطای تست: {exTest.error}</p>}
                  <p className="mt-2 text-[9px] leading-4 text-slate-500">
                    قفل HITL: حتی با باز بودن این کلید، هیچ سفارشی بدون تأیید شما در پنل یا تلگرام ارسال نمی‌شود.
                    کلیدها فقط در دیتابیس همین پروژه ذخیره می‌شوند و در گیت نوشته نمی‌شوند.
                  </p>
                </div>

                <form onSubmit={createNewAgent} className="rounded-3xl border bg-white p-5">
                  <h3 className="font-black">➕ استخدام کارمند و افتتاح دفتر جدید</h3>
                  <p className="mt-1 text-[11px] text-slate-500">
                    برای کارمند جدید کلید API واقعی ساخته می‌شود و درآمدش از صفر شروع می‌شود.
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <input
                      required
                      value={newAgent.name}
                      onChange={(e) => setNewAgent({ ...newAgent, name: e.target.value })}
                      placeholder="نام کارمند"
                      className="col-span-2 rounded-xl border p-2.5 text-sm"
                    />
                    <input
                      value={newAgent.role}
                      onChange={(e) => setNewAgent({ ...newAgent, role: e.target.value })}
                      placeholder="نقش سازمانی"
                      className="col-span-2 rounded-xl border p-2.5 text-sm"
                    />
                    <select
                      value={newAgent.specialty}
                      onChange={(e) => setNewAgent({ ...newAgent, specialty: e.target.value })}
                      className="rounded-xl border p-2.5 text-sm"
                    >
                      <option value="crypto">🪙 رمزارز</option>
                      <option value="freelance">⚛️ فریلنسری</option>
                      <option value="bot">🤖 فروش تلگرام</option>
                      <option value="content">📊 محتوا</option>
                      <option value="custom_api">🔌 API خارجی</option>
                    </select>
                    <input
                      value={newAgent.department}
                      onChange={(e) => setNewAgent({ ...newAgent, department: e.target.value })}
                      placeholder="دپارتمان"
                      className="rounded-xl border p-2.5 text-sm"
                    />
                    <input
                      value={newAgent.goalTitle}
                      onChange={(e) => setNewAgent({ ...newAgent, goalTitle: e.target.value })}
                      placeholder="هدف ماه (مثلاً ۱۰ قرارداد)"
                      className="col-span-2 rounded-xl border p-2.5 text-sm"
                    />
                    <input
                      type="number"
                      value={newAgent.goalTargetUsdt}
                      onChange={(e) => setNewAgent({ ...newAgent, goalTargetUsdt: e.target.value })}
                      placeholder="هدف درآمدی USDT"
                      className="col-span-2 rounded-xl border p-2.5 text-sm"
                    />
                  </div>
                  <button className="mt-3 w-full rounded-xl bg-emerald-500 py-3 text-sm font-black text-black hover:bg-emerald-400">
                    استخدام و ساخت دفتر ✅
                  </button>
                </form>
              </div>

              <div className="overflow-hidden rounded-3xl border bg-white">
                <table className="w-full min-w-[820px] text-right text-xs">
                  <thead className="bg-slate-50 text-[11px] text-slate-500">
                    <tr>
                      {["کارمند", "دپارتمان / اتاق", "هدف", "درآمد", "موفق/خطا", "وضعیت", "کلید API", "عملیات"].map((h) => (
                        <th key={h} className="px-3 py-3 font-normal">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {agentsList.map((a) => (
                      <tr key={a.id} className="border-t">
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2">
                            <span className="text-lg">{a.avatar}</span>
                            <div>
                              <b>{a.name}</b>
                              <p className="text-[10px] text-slate-400">{a.role}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-[10px] text-slate-500">
                          {a.department || "—"}
                          <br />
                          اتاق {a.officeRoom || "—"} / طبقه {a.officeFloor}
                        </td>
                        <td className="max-w-[180px] px-3 py-3 text-[10px] text-slate-500">
                          <p className="line-clamp-2">{a.goalTitle || "—"}</p>
                        </td>
                        <td className="px-3 py-3 font-black text-emerald-600">{fa(a.earnedUsdt)}</td>
                        <td className="px-3 py-3 text-[10px]">
                          <span className="text-emerald-600">{a.successCount}</span> /{" "}
                          <span className="text-red-500">{a.errorCount}</span>
                        </td>
                        <td className="px-3 py-3">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${
                              a.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
                            }`}
                          >
                            {a.status === "active" ? "سر کار" : "متوقف"}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <button
                            onClick={() => copyText(a.apiKey, "کلید API کپی شد 🔑")}
                            className="rounded-lg bg-slate-100 px-2 py-1 font-mono text-[9px]"
                            dir="ltr"
                          >
                            {String(a.apiKey).slice(0, 12)}…
                          </button>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex flex-wrap gap-1">
                            <Link
                              href={`/control/office/${a.id}`}
                              className="rounded-lg bg-[#0B1220] px-2 py-1 text-[10px] font-bold text-white"
                            >
                              ورود به دفتر
                            </Link>
                            <button onClick={() => toggleAgent(a)} className="rounded-lg bg-slate-100 px-2 py-1 text-[10px]">
                              {a.status === "active" ? "توقف" : "فعال"}
                            </button>
                            <button
                              onClick={() => deleteAgent(a.id)}
                              className="rounded-lg bg-red-50 px-2 py-1 text-[10px] text-red-600"
                            >
                              حذف
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="rounded-3xl border bg-white p-5">
                <h3 className="font-black">🔌 اتصال ایجنت خارجی به API واقعی</h3>
                <p className="mt-1 text-[11px] text-slate-500">
                  ربات پایتون/TradingView/n8n خود را با کلید اختصاصی به این مسیر وصل کنید. بدون هش تراکنش، هیچ مبلغی
                  «درآمد» محسوب نمی‌شود.
                </p>
                <pre className="mt-3 overflow-x-auto rounded-2xl bg-[#0B1220] p-4 text-[10px] leading-6 text-emerald-200" dir="ltr">
{`curl -X POST ${typeof window !== "undefined" ? window.location.origin : "https://YOUR-APP.vercel.app"}/api/agents/ingest \\
  -H "Content-Type: application/json" \\
  -H "x-agent-key: ag_live_xxxxxxxx" \\
  -d '{
    "amountUsdt": 55.25,
    "txHash": "0x9f41c0d2b7a8e6f5d4c3b2a1908f7e6d5c4b3a2910f8e7d6c5b4a39281706f5e",
    "network": "BEP20",
    "title": "سود واقعی آربیتراژ"
  }'`}
                </pre>
                <p className="mt-2 text-[10px] text-slate-500">
                  اگر تأیید زنجیره‌ای فعال باشد، واریز بلافاصله تأیید می‌شود؛ در غیر این صورت در صف تأیید مدیرعامل قرار
                  می‌گیرد و به تلگرام ارسال می‌شود.
                </p>
              </div>
            </section>
          )}

          {/* ═══════════════ پروژه‌ها ═══════════════ */}
          {view === "projects" && (
            <section className="mt-4">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="جستجوی پروژه یا مشتری…"
                  className="min-w-[220px] flex-1 rounded-xl border bg-white px-3 py-2 text-sm"
                />
                <select value={filter} onChange={(e) => setFilter(e.target.value)} className="rounded-xl border bg-white px-3 py-2 text-sm">
                  <option value="all">همه وضعیت‌ها</option>
                  {Object.keys(statusMap).map((s) => (
                    <option key={s} value={s}>{statusMap[s][0]}</option>
                  ))}
                </select>
                <button
                  onClick={() => {
                    setEdit(null);
                    setForm({ title: "", clientName: "", telegramUser: "", source: "تلگرام", type: "nextjs", status: "new", priority: "medium", budgetUsdt: "", receivedUsdt: "", deadline: "", description: "", wallet: walletForm.address });
                    setShowForm(true);
                  }}
                  className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-black text-black"
                >
                  + پروژه جدید
                </button>
              </div>

              {showForm && (
                <form onSubmit={saveProject} className="mt-3 grid gap-2 rounded-3xl border bg-white p-4 md:grid-cols-3">
                  <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="عنوان پروژه" className="rounded-xl border p-2.5 text-sm md:col-span-2" />
                  <input required value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} placeholder="نام مشتری" className="rounded-xl border p-2.5 text-sm" />
                  <input value={form.telegramUser} onChange={(e) => setForm({ ...form, telegramUser: e.target.value })} placeholder="@telegram" className="rounded-xl border p-2.5 text-sm" dir="ltr" />
                  <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="rounded-xl border p-2.5 text-sm">
                    {Object.keys(typeMap).map((t) => <option key={t} value={t}>{typeMap[t]}</option>)}
                  </select>
                  <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="rounded-xl border p-2.5 text-sm">
                    {Object.keys(statusMap).map((s) => <option key={s} value={s}>{statusMap[s][0]}</option>)}
                  </select>
                  <input type="number" value={form.budgetUsdt} onChange={(e) => setForm({ ...form, budgetUsdt: e.target.value })} placeholder="بودجه USDT" className="rounded-xl border p-2.5 text-sm" />
                  <input type="number" value={form.receivedUsdt} onChange={(e) => setForm({ ...form, receivedUsdt: e.target.value })} placeholder="دریافت‌شده USDT" className="rounded-xl border p-2.5 text-sm" />
                  <input value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} placeholder="ددلاین" className="rounded-xl border p-2.5 text-sm" />
                  <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="توضیحات" className="rounded-xl border p-2.5 text-sm md:col-span-2" />
                  <div className="flex gap-2">
                    <button className="flex-1 rounded-xl bg-emerald-500 py-2.5 text-sm font-black text-black">ذخیره</button>
                    <button type="button" onClick={() => setShowForm(false)} className="rounded-xl border px-3 text-sm">لغو</button>
                  </div>
                </form>
              )}

              <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {filteredProjects.map((p) => (
                  <div key={p.id} className="rounded-3xl border bg-white p-4">
                    <div className="flex items-start justify-between gap-2">
                      <b className="text-sm">{p.title}</b>
                      <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${statusMap[p.status]?.[1] || "bg-slate-100"}`}>
                        {statusMap[p.status]?.[0] || p.status}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">
                      {p.clientName} {p.telegramUser && <span dir="ltr">{p.telegramUser}</span>}
                    </p>
                    <p className="mt-2 line-clamp-2 text-[11px] leading-5 text-slate-600">{p.description}</p>
                    <div className="mt-2 flex items-center justify-between text-[11px]">
                      <span className="font-black text-emerald-600">{fa(p.receivedUsdt)} / {fa(p.budgetUsdt)} USDT</span>
                      <span className="text-slate-400">{p.deadline || "—"}</span>
                    </div>
                    <div className="mt-3 flex gap-2 text-[10px]">
                      <button
                        onClick={() => {
                          setEdit(p);
                          setForm({ ...p, budgetUsdt: String(p.budgetUsdt), receivedUsdt: String(p.receivedUsdt) });
                          setShowForm(true);
                          window.scrollTo({ top: 0, behavior: "smooth" });
                        }}
                        className="rounded-lg bg-slate-100 px-2.5 py-1 font-bold"
                      >
                        ویرایش
                      </button>
                      <button onClick={() => delProject(p.id)} className="rounded-lg bg-red-50 px-2.5 py-1 text-red-600">
                        حذف
                      </button>
                    </div>
                  </div>
                ))}
                {filteredProjects.length === 0 && (
                  <div className="col-span-full rounded-3xl border border-dashed bg-white p-10 text-center text-sm text-slate-500">
                    پروژه‌ای یافت نشد. با «+ پروژه جدید» اولین پروژه واقعی را ثبت کنید.
                  </div>
                )}
              </div>
            </section>
          )}

          {/* ═══════════════ گفتگوها ═══════════════ */}
          {view === "chats" && (
            <section className="mt-4 grid gap-3 lg:grid-cols-3">
              <div className="rounded-3xl border bg-white p-3">
                <h3 className="px-2 font-black">گفتگوهای تلگرام</h3>
                {chatList.map((c: any) => (
                  <button
                    key={c.clientName}
                    onClick={() => setChatUser(c.clientName)}
                    className={`mt-2 w-full rounded-2xl p-2.5 text-right transition ${
                      activeChat === c.clientName ? "bg-[#0B1220] text-white" : "hover:bg-slate-50"
                    }`}
                  >
                    <b className="text-xs">{c.clientName}</b>
                    <p className={`truncate text-[10px] ${activeChat === c.clientName ? "text-slate-300" : "text-slate-500"}`}>
                      {c.text}
                    </p>
                  </button>
                ))}
                {chatList.length === 0 && (
                  <p className="mt-4 p-4 text-center text-[11px] text-slate-400">
                    پیامی نیست. با ثبت وبهوک تلگرام، پیام مشتریان واقعی اینجا ظاهر می‌شود.
                  </p>
                )}
              </div>

              <div className="rounded-3xl border bg-white p-4 lg:col-span-2">
                <h3 className="font-black">{activeChat || "گفتگو"}</h3>
                <div className="mt-3 max-h-[420px] space-y-2 overflow-y-auto">
                  {chatMsgs.map((m: any) => (
                    <div key={m.id} className={`flex ${m.direction === "out" ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[80%] rounded-2xl px-3 py-2 text-[11px] leading-5 ${
                          m.direction === "out" ? "bg-emerald-500 text-white" : "bg-slate-100 text-slate-700"
                        }`}
                      >
                        {m.text}
                        <div className={`mt-1 text-[8px] ${m.direction === "out" ? "text-emerald-100" : "text-slate-400"}`}>
                          {dt(m.createdAt)} • {m.source}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex gap-2">
                  <input
                    value={chatText}
                    onChange={(e) => setChatText(e.target.value)}
                    placeholder="پاسخ شما (واقعاً از ربات تلگرام ارسال می‌شود)"
                    className="flex-1 rounded-xl border px-3 py-2 text-sm"
                  />
                  <button
                    onClick={sendChat}
                    disabled={busy === "chat"}
                    className="rounded-xl bg-[#229ED9] px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                  >
                    ارسال 📩
                  </button>
                </div>
              </div>
            </section>
          )}

          {/* ═══════════════ صف تأیید ═══════════════ */}
          {view === "approvals" && (
            <section className="mt-4 space-y-3">
              <div className="rounded-3xl border bg-white p-5">
                <h3 className="font-black">🗂 کارهای ایجنت‌ها (Job Queue واقعی)</h3>
                <p className="mt-1 text-[11px] text-slate-500">
                  تأیید هر کار، همان لحظه اجرا می‌شود (سفارش صرافی / تأیید واریز). نتیجه در تلگرام هم به‌روزرسانی می‌شود.
                </p>
                <ul className="mt-3 space-y-2">
                  {jobs.slice(0, 30).map((j: any) => (
                    <li key={j.id} className="rounded-2xl border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px]">#{j.id}</span>
                          <b className="text-xs">{j.title}</b>
                          <span className={`rounded-full border px-2 py-0.5 text-[9px] ${tradeStatus[j.status]?.[1] || "border-slate-300 text-slate-500"}`}>
                            {tradeStatus[j.status]?.[0] || j.status}
                          </span>
                        </div>
                        <span className="text-[9px] text-slate-400">{dt(j.createdAt)}</span>
                      </div>
                      <p className="mt-1 text-[10px] text-slate-500">{j.agentName}{j.detail ? ` • ${j.detail}` : ""}</p>
                      {j.payload && typeof j.payload === "object" && (
                        <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
                          {j.payload.estimatedProfitUsdt !== undefined && (
                            <span className="rounded-lg bg-emerald-50 px-2 py-0.5 font-bold text-emerald-700">
                              💰 سود تخمینی: +{fa(j.payload.estimatedProfitUsdt)} USDT
                            </span>
                          )}
                          {j.payload.estimatedDuration && (
                            <span className="rounded-lg bg-slate-100 px-2 py-0.5 text-slate-700">
                              ⏱ زمان تقریبی: {j.payload.estimatedDuration}
                            </span>
                          )}
                          {j.payload.stopLoss && (
                            <span className="rounded-lg bg-rose-50 px-2 py-0.5 font-bold text-rose-700">
                              🛑 حد ضرر: ${j.payload.stopLoss} | اهرم {j.payload.leverage || 1}x
                            </span>
                          )}
                          {j.payload.trustScore !== undefined && (
                            <span className="rounded-lg bg-cyan-50 px-2 py-0.5 font-bold text-cyan-800">
                              🛡️ امتیاز ضداسکم: {fa(j.payload.trustScore)}/۱۰۰
                            </span>
                          )}
                        </div>
                      )}
                      {j.preflight?.blockers?.length > 0 && (
                        <div className="mt-2 rounded-xl border border-orange-200 bg-orange-50 p-2">
                          <p className="text-[10px] font-black text-orange-800">🔒 این کار آماده اجرای واقعی نیست — دکمه تأیید قفل است:</p>
                          <ul className="mt-1 space-y-1">
                            {j.preflight.blockers.map((b: any) => (
                              <li key={b.code} className="text-[9px] leading-4 text-orange-700">
                                • {b.label}
                                {b.action ? <span className="block text-orange-600/80">↳ {b.action}</span> : null}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {j.error && <p className="mt-1 rounded bg-red-50 p-2 text-[10px] text-red-600">⛔ {j.error}</p>}
                      {["awaiting_approval", "queued"].includes(j.status) && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            onClick={() => jobAction(j.id, "approve")}
                            disabled={busy === `job-${j.id}` || !isApprovable(j)}
                            title={isApprovable(j) ? "" : j.preflight?.reason || "این کار آماده اجرا نیست"}
                            className="rounded-lg bg-emerald-500 px-3 py-1 text-[11px] font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {isApprovable(j) ? "✅ تأیید و اجرا" : "🔒 تأیید قفل است"}
                          </button>
                          <button onClick={() => jobAction(j.id, "reject")} className="rounded-lg bg-red-50 px-3 py-1 text-[11px] font-bold text-red-600">
                            ❌ رد
                          </button>
                        </div>
                      )}
                      {j.canRetry && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            onClick={() => jobAction(j.id, "retry")}
                            disabled={busy === `job-${j.id}`}
                            className="rounded-lg bg-slate-900 px-3 py-1 text-[11px] font-black text-white disabled:opacity-40"
                          >
                            🔄 تلاش دوباره
                          </button>
                          <span className="text-[9px] leading-5 text-slate-500">
                            تلاش دوباره فقط وقتی موفق می‌شود که علت خطا (کلید/تنظیمات) رفع شده باشد.
                          </span>
                        </div>
                      )}
                    </li>
                  ))}
                  {jobs.length === 0 && (
                    <p className="rounded-2xl bg-slate-50 p-6 text-center text-xs text-slate-400">
                      صف کار خالی است. از دفتر کارمند یک مأموریت بسازید.
                    </p>
                  )}
                </ul>
              </div>

              <div className="rounded-3xl border bg-white p-5">
                <h3 className="font-black">✅ تسک‌های منتظر تأیید</h3>
                <ul className="mt-3 space-y-2">
                  {pendingTasks.map((t: any) => (
                    <li key={t.id} className="rounded-2xl border p-3">
                      <b className="text-xs">{t.title}</b>
                      <p className="mt-1 text-[10px] text-slate-500">{t.agent} • {t.projectTitle}</p>
                      <p className="mt-1 text-[10px] text-slate-400">{t.description}</p>
                      <div className="mt-2 flex gap-2">
                        <button onClick={() => actTask(t, "approved")} className="rounded-lg bg-emerald-500 px-3 py-1 text-[11px] font-black text-white">تأیید ✅</button>
                        <button onClick={() => actTask(t, "rejected")} className="rounded-lg bg-red-50 px-3 py-1 text-[11px] font-bold text-red-600">رد ❌</button>
                      </div>
                    </li>
                  ))}
                  {pendingTasks.length === 0 && <p className="text-xs text-slate-400">تسکی نیست.</p>}
                </ul>
              </div>
            </section>
          )}

          {/* ═══════════════ کیف پول و درآمد ═══════════════ */}
          {view === "earnings" && (
            <section className="mt-4 space-y-4">
              <div className="grid gap-3 md:grid-cols-4">
                {[
                  ["درآمد تأییدشده", fa(stats?.income ?? 0), "text-emerald-600"],
                  ["در انتظار تأیید", fa(stats?.incomePending ?? 0), "text-amber-600"],
                  ["برداشت‌ها", fa(walletInfo?.withdrawals ?? 0), "text-slate-700"],
                  ["خالص", fa(walletInfo?.netBalance ?? 0), "text-[#0B1220]"],
                ].map(([l, v, c]) => (
                  <div key={l} className="rounded-3xl border bg-white p-4">
                    <p className="text-[11px] text-slate-500">{l}</p>
                    <p className={`mt-1 text-xl font-black ${c}`}>{v} <span className="text-[10px] font-normal">USDT</span></p>
                  </div>
                ))}
              </div>

              <div className="rounded-3xl border bg-white p-5">
                <h3 className="font-black">📈 درآمد ماهانه (از تراکنش‌های واقعی)</h3>
                {stats?.chart?.length ? (
                  <div className="mt-5 flex h-44 items-end gap-3">
                    {stats.chart.map((c: any) => (
                      <div key={c.m} className="flex-1 text-center">
                        <div className="mx-auto w-full max-w-[54px] rounded-t-xl bg-emerald-500" style={{ height: `${(Number(c.v) / maxChart) * 150}px`, minHeight: Number(c.v) > 0 ? 4 : 0 }} />
                        <p className="mt-1 text-[10px] font-bold">{fa(c.v)}</p>
                        <p className="text-[9px] text-slate-400">{c.m}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-4 rounded-2xl bg-slate-50 p-6 text-center text-xs text-slate-400">
                    داده‌ای برای نمودار نیست؛ درآمد فقط با تراکنش واقعی ثبت می‌شود.
                  </p>
                )}
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <form onSubmit={addIncome} className="rounded-3xl border bg-white p-5">
                  <h3 className="font-black">➕ ثبت درآمد واقعی (با شاهد)</h3>
                  <p className="mt-1 text-[11px] text-slate-500">هش تراکنش اجباری است؛ ورود مبلغ بدون شاهد رد می‌شود.</p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <input required value={txForm.title} onChange={(e) => setTxForm({ ...txForm, title: e.target.value })} placeholder="عنوان درآمد" className="col-span-2 rounded-xl border p-2.5 text-sm" />
                    <select value={txForm.agentName} onChange={(e) => setTxForm({ ...txForm, agentName: e.target.value })} className="col-span-2 rounded-xl border p-2.5 text-sm">
                      <option value="">انتخاب کارمند</option>
                      {agentsList.map((a) => <option key={a.id} value={a.name}>{a.name}</option>)}
                    </select>
                    <input type="number" required value={txForm.amountUsdt} onChange={(e) => setTxForm({ ...txForm, amountUsdt: e.target.value })} placeholder="مبلغ USDT" className="rounded-xl border p-2.5 text-sm" />
                    <select value={txForm.network} onChange={(e) => setTxForm({ ...txForm, network: e.target.value })} className="rounded-xl border p-2.5 text-sm">
                      {["TRC20", "BEP20", "ERC20", "TON"].map((n) => <option key={n}>{n}</option>)}
                    </select>
                    <input required value={txForm.txHash} onChange={(e) => setTxForm({ ...txForm, txHash: e.target.value })} placeholder="هش تراکنش (txHash)" className="col-span-2 rounded-xl border p-2.5 font-mono text-xs" dir="ltr" />
                  </div>
                  <button className="mt-3 w-full rounded-xl bg-emerald-500 py-2.5 text-sm font-black text-black">ثبت درآمد ✅</button>
                </form>

                <div className="overflow-hidden rounded-3xl border bg-white">
                  <div className="border-b px-4 py-3 text-sm font-black">تراکنش‌های اخیر</div>
                  <div className="max-h-[360px] overflow-y-auto">
                    <table className="w-full text-right text-[10px]">
                      <tbody>
                        {(txs.length ? txs : walletInfo?.transactions || []).slice(0, 30).map((t: any) => (
                          <tr key={t.id} className="border-b last:border-0">
                            <td className="px-3 py-2">
                              <b>{t.title}</b>
                              <p className="text-[9px] text-slate-400">{t.agentName} • {dt(t.createdAt)}</p>
                            </td>
                            <td className={`px-3 py-2 font-black ${Number(t.amountUsdt) < 0 ? "text-red-500" : "text-emerald-600"}`}>
                              {fa(t.amountUsdt)}
                            </td>
                            <td className="px-3 py-2">
                              <span className={`rounded-full px-2 py-0.5 text-[8px] ${t.status === "confirmed" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                                {t.status === "confirmed" ? "تأییدشده" : "در انتظار"}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* ═══════════════ ابزارها ═══════════════ */}
          {view === "tools" && (
            <section className="mt-4 space-y-4">
              <div className="rounded-3xl border bg-white p-5">
                <h3 className="font-black">⚡ اجرای واقعی ابزارها با ورکر</h3>
                <p className="mt-1 text-[11px] text-slate-500">
                  ابزارها بدون سرویس واقعی خروجی نمی‌سازند. AGENT_WORKER_URL را ست کنید تا درخواست‌ها به n8n یا سرویس
                  خودتان برود.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <input
                    value={toolInput}
                    onChange={(e) => setToolInput(e.target.value)}
                    placeholder="ورودی ابزار (مثلاً: لندینگ صرافی ارز دیجیتال)"
                    className="min-w-[260px] flex-1 rounded-xl border px-3 py-2 text-sm"
                  />
                  {["Next.js", "PPTX", "مترجم"].map((t) => (
                    <button
                      key={t}
                      onClick={() => runTool(t)}
                      disabled={busy === "tool"}
                      className="rounded-xl bg-[#0B1220] px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                    >
                      اجرای {t}
                    </button>
                  ))}
                </div>
                {toolOut && (
                  <pre className="mt-3 whitespace-pre-wrap rounded-2xl bg-slate-50 p-4 text-[11px] leading-6">{toolOut}</pre>
                )}
              </div>
              <div className="rounded-3xl border bg-white p-5">
                <h3 className="font-black">آخرین اجراها</h3>
                {tools.length === 0 ? (
                  <p className="mt-3 text-xs text-slate-400">هنوز اجرایی ثبت نشده است.</p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {tools.slice(0, 10).map((t: any) => (
                      <li key={t.id} className="rounded-2xl border p-3 text-[11px]">
                        <b>{t.tool}</b>
                        <span className={`float-left rounded-full px-2 py-0.5 text-[9px] ${t.status === "done" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                          {t.status}
                        </span>
                        <p className="mt-1 text-slate-500">{t.input}</p>
                        {t.output && <p className="mt-1 whitespace-pre-wrap text-slate-700">{t.output}</p>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          )}

          {/* ═══════════════ تلگرام ═══════════════ */}
          {view === "telegram" && (
            <section className="mt-4 space-y-4">
              <div className="rounded-3xl border bg-white p-5">
                <h3 className="font-black">📩 مکانیزم تأیید انسانی در تلگرام</h3>
                <p className="mt-1 text-[11px] leading-6 text-slate-500">
                  با ست کردن TELEGRAM_BOT_TOKEN و TELEGRAM_ADMIN_CHAT_ID، هر درخواست تأیید با دکمه‌های شیشه‌ای به شما
                  ارسال می‌شود. کلیک روی «تأیید» همان لحظه Job را در دیتابیس و صرافی اجرا می‌کند.
                </p>
                <div className="mt-3 grid gap-2 text-[11px] md:grid-cols-3">
                  <div className="rounded-xl bg-slate-50 p-3">
                    <p className="text-slate-500">توکن ربات</p>
                    <b className={walletInfo?.deployment?.telegramConfigured ? "text-emerald-600" : "text-amber-600"}>
                      {walletInfo?.deployment?.telegramConfigured ? "ست شده" : "ست نشده"}
                    </b>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3">
                    <p className="text-slate-500">سکرت وبهوک</p>
                    <b className="text-slate-700">در فایل env بررسی شود</b>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3">
                    <p className="text-slate-500">کرون</p>
                    <b className={walletInfo?.deployment?.cronConfigured ? "text-emerald-600" : "text-amber-600"}>
                      {walletInfo?.deployment?.cronConfigured ? "فعال" : "CRON_SECRET ست نشده"}
                    </b>
                  </div>
                </div>
                <button
                  onClick={async () => {
                    setBusy("webhook");
                    try {
                      const d = await api("/api/telegram/setup", "POST", { action: "set" });
                      notify(d.ok ? `وبهوک ثبت شد: ${d.url}` : `⚠️ ${d.telegram || "خطا"}`);
                    } catch (err: any) {
                      notify(`⚠️ ${err.message}`);
                    } finally {
                      setBusy("");
                    }
                  }}
                  disabled={busy === "webhook"}
                  className="mt-3 rounded-xl bg-[#229ED9] px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                >
                  {busy === "webhook" ? "⏳" : "🔗"} ثبت وبهوک روی دامنه فعلی
                </button>
              </div>

              <div className="rounded-3xl border bg-white p-5">
                <h3 className="font-black">پیام‌های واقعی دریافت‌شده</h3>
                <ul className="mt-3 space-y-2">
                  {msgs.slice(0, 12).map((m: any) => (
                    <li key={m.id} className="rounded-2xl border p-3">
                      <div className="flex items-center justify-between">
                        <b className="text-xs">{m.clientName}</b>
                        <span className="text-[9px] text-slate-400">{dt(m.createdAt)}</span>
                      </div>
                      <p className="mt-1 text-[11px] text-slate-600">{m.text}</p>
                    </li>
                  ))}
                  {msgs.length === 0 && <p className="text-xs text-slate-400">پیامی ثبت نشده است.</p>}
                </ul>
              </div>
            </section>
          )}

          {/* ═══════════════ گزارش کارمندان و فرماندهی RNAI (COO) ═══════════════ */}
          {view === "logs" && (
            <section className="mt-4 space-y-4">
              {/* هدر فرماندهی RNAI */}
              <div className="rounded-3xl bg-gradient-to-l from-[#0B1220] via-[#101d33] to-[#0B1220] p-5 text-white">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <span className="rounded-full bg-emerald-500 px-3 py-0.5 text-[10px] font-black text-black">
                      پروتکل گزارش‌دهی رسمی • RNAI (COO)
                    </span>
                    <h3 className="mt-2 text-lg font-black md:text-xl">
                      گزارش جامع عملکرد شرکت، لیدربورد کارمندان و لاگ زنده عملیات
                    </h3>
                    <p className="mt-1 text-[11px] text-slate-300">
                      تمامی ارقام مستقیماً از تراکنش‌های تأییدشده و جدول <code className="text-emerald-300">agent_activity_logs</code> استخراج می‌شوند. قفل مالی Human-in-the-Loop فعال است.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => runCooCommand("startup_directive")}
                      disabled={busy.startsWith("coo-")}
                      className="rounded-xl bg-emerald-500 px-3.5 py-2 text-xs font-black text-black disabled:opacity-50"
                    >
                      {busy === "coo-startup_directive" ? "⏳ در حال اجرا…" : "🚀 استارت‌آپ و اسکن کامل"}
                    </button>
                    <button
                      onClick={() => runCooCommand("executive_report")}
                      disabled={busy.startsWith("coo-")}
                      className="rounded-xl bg-[#229ED9] px-3.5 py-2 text-xs font-bold text-white disabled:opacity-50"
                    >
                      {busy === "coo-executive_report" ? "⏳ ارسال…" : "📨 ارسال این گزارش به تلگرام"}
                    </button>
                  </div>
                </div>
              </div>

              {/* ۱. خلاصه عملکرد کل شرکت */}
              {cooData?.summary && (
                <div className="rounded-3xl border bg-white p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-black text-slate-900">📊 خلاصه عملکرد کل شرکت</h3>
                    <span className="text-[10px] text-slate-400">
                      به‌روزرسانی: {dt(cooData.summary.generatedAt)}
                    </span>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-3.5">
                      <p className="text-[10px] font-bold text-emerald-800">درآمد واقعی محقق‌شده (Confirmed)</p>
                      <p className="mt-1 text-2xl font-black text-emerald-700">
                        {fa(cooData.summary.company.confirmedIncomeUsdt)} <span className="text-xs font-bold">USDT</span>
                      </p>
                      <p className="mt-1 text-[10px] text-emerald-700/80">
                        طی {fa(cooData.summary.company.confirmedTxCount)} تراکنش تأییدشده
                      </p>
                    </div>
                    <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-3.5">
                      <p className="text-[10px] font-bold text-amber-800">در انتظار تأیید نهایی شما (HITL)</p>
                      <p className="mt-1 text-2xl font-black text-amber-700">
                        {fa(cooData.summary.company.pendingIncomeUsdt)} <span className="text-xs font-bold">USDT</span>
                      </p>
                      <p className="mt-1 text-[10px] text-amber-700/80">
                        {fa(cooData.summary.company.pendingApprovalsCount)} کارت پیشنهاد منتظر دکمه [✅]/[❌]
                      </p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5">
                      <p className="text-[10px] font-bold text-slate-600">وضعیت ناوگان و پایپ‌لاین پروژه‌ها</p>
                      <p className="mt-1 text-lg font-black text-slate-900">
                        {fa(cooData.summary.company.activeAgentsCount)} از {fa(cooData.summary.company.totalAgentsCount)} کارمند فعال
                      </p>
                      <p className="mt-1 text-[10px] text-slate-500">
                        ظرفیت پروژه‌های باز: {fa(cooData.summary.company.openProjectsPipelineUsdt)} USDT ({fa(cooData.summary.company.openProjectsCount)} پروژه)
                      </p>
                    </div>
                    <div className="rounded-2xl border border-cyan-200 bg-cyan-50/50 p-3.5">
                      <p className="text-[10px] font-bold text-cyan-900">کیف پول واحد شرکت (Master Wallet)</p>
                      <p className="mt-1 truncate font-mono text-[11px] font-bold text-slate-800" dir="ltr">
                        {cooData.summary.company.masterWallet.address || "ثبت نشده"}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-1 text-[10px]">
                        <span className="rounded bg-cyan-100 px-1.5 py-0.5 font-bold text-cyan-900">
                          {cooData.summary.company.masterWallet.activeNetwork}
                        </span>
                        {cooData.summary.company.masterWallet.address && (
                          <button
                            onClick={() => copyText(cooData.summary.company.masterWallet.address, "آدرس کیف پول واحد کپی شد ✅")}
                            className="font-bold text-cyan-700 underline"
                          >
                            کپی آدرس
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ۲. وضعیت لیدربورد و کارمند برتر */}
              {cooData?.summary?.leaderboard?.length > 0 && (
                <div className="rounded-3xl border bg-white p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-black text-slate-900">🏆 وضعیت لیدربورد و کارمند برتر</h3>
                    <span className="text-[10px] text-slate-500">
                      معیار رتبه‌بندی: سودآوری واقعی (USDT) + پروژه‌های موفق − نرخ خطا
                    </span>
                  </div>

                  {cooData.summary.topEmployee && (
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-300 bg-gradient-to-l from-amber-50 via-yellow-50/60 to-white p-4">
                      <div>
                        <span className="rounded-full bg-amber-400 px-2.5 py-0.5 text-[10px] font-black text-slate-950">
                          🌟 کارمند برتر فعلی شرکت
                        </span>
                        <h4 className="mt-1.5 text-base font-black text-slate-900">
                          {cooData.summary.topEmployee.name}
                        </h4>
                        <p className="text-[11px] text-slate-600">
                          دپارتمان: {cooData.summary.topEmployee.department}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-3 text-center text-xs">
                        <div className="rounded-xl bg-white px-3 py-2 shadow-sm">
                          <p className="text-[9px] text-slate-400">سود واقعی</p>
                          <b className="text-emerald-600">+{fa(cooData.summary.topEmployee.realEarnedUsdt)} USDT</b>
                        </div>
                        <div className="rounded-xl bg-white px-3 py-2 shadow-sm">
                          <p className="text-[9px] text-slate-400">پروژه موفق</p>
                          <b>{fa(cooData.summary.topEmployee.tasksCompleted)}</b>
                        </div>
                        <div className="rounded-xl bg-white px-3 py-2 shadow-sm">
                          <p className="text-[9px] text-slate-400">نرخ خطا</p>
                          <b className="text-emerald-700">{fa(cooData.summary.topEmployee.errorRatePct)}٪</b>
                        </div>
                        <div className="rounded-xl bg-white px-3 py-2 shadow-sm">
                          <p className="text-[9px] text-slate-400">امتیاز کل</p>
                          <b className="text-amber-700">{fa(cooData.summary.topEmployee.compositeScore)}</b>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-right text-xs">
                      <thead>
                        <tr className="border-b text-[10px] text-slate-400">
                          <th className="py-2 pr-2">رتبه</th>
                          <th className="py-2">کارمند و دپارتمان</th>
                          <th className="py-2">سود واقعی (USDT)</th>
                          <th className="py-2">پروژه‌های موفق</th>
                          <th className="py-2">نرخ خطا</th>
                          <th className="py-2">تحقق هدف ماهانه</th>
                          <th className="py-2 pl-2">امتیاز عملکرد</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {cooData.summary.leaderboard.map((row: any) => (
                          <tr key={row.id} className={row.isTopEmployee ? "bg-amber-50/40 font-bold" : ""}>
                            <td className="py-2.5 pr-2">
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black">
                                {row.rank === 1 ? "🥇 ۱" : row.rank === 2 ? "🥈 ۲" : row.rank === 3 ? "🥉 ۳" : fa(row.rank)}
                              </span>
                            </td>
                            <td className="py-2.5">
                              <div className="font-bold text-slate-900">{row.name}</div>
                              <div className="text-[10px] font-normal text-slate-500">{row.department}</div>
                            </td>
                            <td className="py-2.5 font-black text-emerald-600">
                              {row.realEarnedUsdt > 0 ? `+${fa(row.realEarnedUsdt)}` : "۰"} USDT
                            </td>
                            <td className="py-2.5">{fa(row.tasksCompleted)}</td>
                            <td className="py-2.5">
                              <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${row.errorRatePct > 10 ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}>
                                {fa(row.errorRatePct)}٪
                              </span>
                            </td>
                            <td className="py-2.5 text-[10px] text-slate-600">
                              {fa(row.targetProgressPct)}٪ از {fa(row.monthlyTargetUsdt)} USDT
                            </td>
                            <td className="py-2.5 pl-2 font-black text-slate-800">{fa(row.compositeScore)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* ۳. چالش‌ها و موانع */}
              {cooData?.summary?.blockers && (
                <div className="rounded-3xl border bg-white p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-black text-slate-900">⚠️ چالش‌ها و موانع (نیازمند بررسی مدیرعامل)</h3>
                    <Link href="/control/system" className="text-[11px] font-bold text-slate-500 underline">
                      مشاهده کامل سلامت سیستم ←
                    </Link>
                  </div>
                  <div className="mt-3 space-y-2.5">
                    {cooData.summary.blockers.map((b: any) => (
                      <div
                        key={b.code}
                        className={`rounded-2xl border p-3.5 ${
                          b.severity === "critical"
                            ? "border-red-200 bg-red-50/70"
                            : b.severity === "warning"
                            ? "border-amber-200 bg-amber-50/60"
                            : "border-slate-200 bg-slate-50/70"
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <b className="text-xs text-slate-900">
                            {b.severity === "critical" ? "🔴" : b.severity === "warning" ? "🟠" : "🔵"} {b.component} — {b.title}
                          </b>
                          <span className="rounded-full bg-white px-2 py-0.5 text-[9px] font-bold text-slate-600">
                            {b.severity === "critical" ? "اقدام فوری" : b.severity === "warning" ? "نیازمند بررسی" : "اطلاع‌رسانی"}
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] leading-5 text-slate-600">{b.detail}</p>
                        <p className="mt-1 text-[10px] font-bold text-slate-800">💡 راهکار پیشنهادی COO: {b.actionRequired}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ۴. نسخه متنی رسمی گزارش اجرایی */}
              {cooData?.summary?.reportText && (
                <div className="rounded-3xl border bg-white p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-black">📜 متن رسمی گزارش استارت‌آپ RNAI (COO)</h3>
                    <button
                      onClick={() => copyText(cooData.summary.reportText, "متن کامل گزارش اجرایی کپی شد ✅")}
                      className="rounded-xl border px-3 py-1.5 text-[11px] font-bold hover:bg-slate-50"
                    >
                      📋 کپی متن گزارش
                    </button>
                  </div>
                  <pre className="mt-3 whitespace-pre-wrap rounded-2xl bg-slate-900 p-4 font-sans text-[11px] leading-6 text-slate-100">
                    {cooData.summary.reportText}
                  </pre>
                </div>
              )}

              {/* ۵. دفتر زنده رویدادهای واقعی (agent_activity_logs) */}
              <div className="rounded-3xl border bg-white p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-black">🧾 جدول زنده فعالیت کارمندان (agent_activity_logs)</h3>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {(
                      [
                        ["all", "همه"],
                        ["success", "موفق"],
                        ["pending", "در انتظار تأیید"],
                        ["error", "خطاها"],
                      ] as const
                    ).map(([k, label]) => (
                      <button
                        key={k}
                        onClick={() => setLogFilter(k)}
                        className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${
                          logFilter === k ? "bg-[#0B1220] text-white" : "border bg-slate-50 text-slate-600"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <ul className="mt-3 space-y-2">
                  {activity
                    .filter((a: any) => {
                      if (logFilter === "all") return true;
                      if (logFilter === "error") return a.status === "failed" || a.status === "error";
                      return a.status === logFilter;
                    })
                    .slice(0, 80)
                    .map((a: any) => (
                      <li key={a.id} className="rounded-2xl border p-3">
                        <div className="flex flex-wrap items-center justify-between gap-1">
                          <div className="flex items-center gap-2">
                            <span
                              className={`h-2 w-2 rounded-full ${
                                a.status === "failed" || a.status === "error"
                                  ? "bg-red-500"
                                  : a.status === "pending"
                                  ? "bg-amber-500"
                                  : a.status === "info"
                                  ? "bg-cyan-500"
                                  : "bg-emerald-500"
                              }`}
                            />
                            <b className="text-xs">{a.action}</b>
                            {Number(a.rewardUsdt) > 0 && (
                              <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-black text-emerald-700">
                                +{fa(a.rewardUsdt)} USDT
                              </span>
                            )}
                          </div>
                          <span className="text-[9px] text-slate-400">
                            {a.agentName} • {dt(a.createdAt)} • {a.source}
                          </span>
                        </div>
                        {a.detail && <p className="mt-1 whitespace-pre-wrap text-[10px] leading-5 text-slate-600">{a.detail}</p>}
                        {a.txHash && (
                          <p className="mt-1 truncate font-mono text-[9px] text-slate-400" dir="ltr">{a.txHash}</p>
                        )}
                      </li>
                    ))}
                  {activity.length === 0 && (
                    <p className="rounded-2xl bg-slate-50 p-6 text-center text-xs text-slate-400">
                      هنوز رویدادی ثبت نشده است.
                    </p>
                  )}
                </ul>
              </div>

              <div className="rounded-3xl border bg-white p-5">
                <h3 className="font-black">🧠 لاگ فنی ایجنت‌ها (legacy)</h3>
                <ul className="mt-3 space-y-1.5 text-[11px]">
                  {logs.slice(0, 20).map((l: any) => (
                    <li key={l.id} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
                      <span>
                        <b>{l.agent}</b> — {l.action}
                      </span>
                      <span className="text-[9px] text-slate-400">{dt(l.createdAt)}</span>
                    </li>
                  ))}
                  {logs.length === 0 && <p className="text-xs text-slate-400">خالی است.</p>}
                </ul>
              </div>
            </section>
          )}
        </main>
      </div>

      {toast && (
        <div className="fixed bottom-5 left-1/2 z-50 w-[92%] max-w-lg -translate-x-1/2 rounded-2xl bg-[#0B1220] px-5 py-3 text-center text-xs font-bold text-emerald-200 shadow-2xl">
          {toast}
        </div>
      )}
    </div>
  );
}
