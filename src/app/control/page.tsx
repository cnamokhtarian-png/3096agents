"use client";
import { useEffect, useMemo, useState } from "react";

const fa = (n: any) => Number(n || 0).toLocaleString("fa-IR");
const persianMonth = (p: string) => {
  const [y, m] = String(p).split("-").map(Number);
  try {
    return new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(y, m - 1, 1)));
  } catch {
    return p;
  }
};
const medal = (rank: number) => ["🥇", "🥈", "🥉"][rank - 1] || fa(rank);

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

const specialtyMap: Record<string, [string, string]> = {
  crypto: ["🪙 کارمند رمزارز / کریپتو", "bg-amber-100 text-amber-800"],
  freelance: ["⚛️ توسعه و فریلنسری", "bg-cyan-100 text-cyan-800"],
  bot: ["🤖 ربات فروش تلگرام", "bg-sky-100 text-sky-800"],
  content: ["📊 محتوا و ترجمه", "bg-violet-100 text-violet-800"],
  custom_api: ["🔌 وب‌هوک / API خارجی", "bg-emerald-100 text-emerald-800"],
};

export default function Control() {
  const [view, setView] = useState("dashboard");
  const [user, setUser] = useState<any>(null);
  const [projects, setProjects] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [msgs, setMsgs] = useState<any[]>([]);
  const [txs, setTxs] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [tools, setTools] = useState<any[]>([]);
  const [agentsList, setAgentsList] = useState<any[]>([]);
  const [walletInfo, setWalletInfo] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");

  // 🏆 لیگ کارمندان / کارمند برتر ماه
  const [league, setLeague] = useState<any>(null);
  const [leaguePeriod, setLeaguePeriod] = useState("");
  const [leagueConfig, setLeagueConfig] = useState<any>(null);
  const [leagueBusy, setLeagueBusy] = useState(false);
  const [leaguePreview, setLeaguePreview] = useState("");
  const [leagueEvent, setLeagueEvent] = useState<any>({
    agentId: "",
    outcome: "success",
    projectTitle: "",
    durationMinutes: "45",
    note: "",
  });

  // فیلتر و فرم پروژه
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

  // چت و ابزارها
  const [chatUser, setChatUser] = useState("آرش کریمی");
  const [chatText, setChatText] = useState("");
  const [toolInput, setToolInput] = useState("فروشگاه اینترنتی");
  const [toolOut, setToolOut] = useState("");

  // تراکنش دستی
  const [txForm, setTxForm] = useState<any>({
    title: "",
    projectTitle: "",
    agentName: "سیستم مرکزی",
    amountUsdt: "",
    network: "TRC20",
    txHash: "",
    kind: "income",
    status: "confirmed",
  });

  // کارمند رمزارز + ناوگان ایجنت‌ها + کیف پول واحد
  const [cryptoStrategy, setCryptoStrategy] = useState("arbitrage");
  const [cryptoCustomAmount, setCryptoCustomAmount] = useState("");
  const [cryptoReport, setCryptoReport] = useState("");
  const [runningAgentId, setRunningAgentId] = useState<number | null>(null);
  const [selectedApiAgent, setSelectedApiAgent] = useState<any>(null);

  // فرم ساخت ایجنت / کارمند جدید
  const [newAgent, setNewAgent] = useState({
    name: "",
    role: "",
    specialty: "crypto",
    avatar: "🪙",
    strategy: "",
  });

  // فرم تنظیم کیف پول واحد
  const [walletForm, setWalletForm] = useState({
    address: "",
    network: "USDT-TRC20",
    autoSweep: true,
  });

  const notify = (t: string) => {
    setToast(t);
    setTimeout(() => setToast(""), 3500);
  };

  const copyText = (txt: string, label = "کپی شد ✅") => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(txt).catch(() => {});
    }
    notify(label);
  };

  // ---------- 🏆 لیگ کارمندان ----------
  function changeLeaguePeriod(p: string) {
    setLeaguePeriod(p);
    setLeaguePreview("");
    load(p);
  }

  async function saveLeagueEvent(e: any) {
    e.preventDefault();
    if (!leagueEvent.agentId) {
      notify("ابتدا ایجنت را انتخاب کنید ⚠️");
      return;
    }
    setLeagueBusy(true);
    const res = await fetch("/api/leaderboard/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: Number(leagueEvent.agentId),
        outcome: leagueEvent.outcome,
        projectTitle: leagueEvent.projectTitle,
        durationMinutes: Number(leagueEvent.durationMinutes) || 0,
        note: leagueEvent.note,
        period: league?.period,
      }),
    });
    const d = await res.json();
    setLeagueBusy(false);
    notify(d.message || d.error || "نتیجه ثبت شد");
    if (d.ok) {
      setLeagueEvent((prev: any) => ({ ...prev, projectTitle: "", note: "" }));
      load();
    }
  }

  async function deleteLeagueEvent(id: number) {
    if (!confirm("این نتیجه از دفترچهٔ لیگ حذف شود؟")) return;
    await fetch(`/api/leaderboard/events?id=${id}`, { method: "DELETE" });
    notify("نتیجه حذف و امتیازها دوباره محاسبه شد 🗑️");
    load();
  }

  async function clearDemoEvents() {
    if (!confirm("همهٔ دادههای نمونهٔ لیگ حذف شوند؟ (نتایج واقعی باقی میمانند)")) return;
    await fetch("/api/leaderboard/events?source=seed", { method: "DELETE" });
    notify("دادههای نمونه پاک شدند 🧹");
    load();
  }

  async function saveLeagueConfig(e: any) {
    e.preventDefault();
    setLeagueBusy(true);
    const res = await fetch("/api/leaderboard", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(leagueConfig),
    });
    const d = await res.json();
    setLeagueBusy(false);
    if (!d.ok) {
      notify(d.error || "خطا در ذخیرهٔ تنظیمات");
      return;
    }
    setLeagueConfig(d.config);
    notify("وزنها و اهداف فرمول ذخیره شد ⚙️");
    load();
  }

  async function previewLeague() {
    setLeagueBusy(true);
    const r = await fetch(
      `/api/leaderboard/close${league?.period ? `?period=${league.period}` : ""}`
    );
    const d = await r.json();
    setLeagueBusy(false);
    setLeaguePreview(d.telegramMessage || d.error || "");
    notify("پیشنمایش پیام تلگرام آماده شد 👁️");
  }

  async function closeLeagueMonth(force = false, periodOverride?: string) {
    setLeagueBusy(true);
    const r = await fetch("/api/leaderboard/close", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ period: periodOverride || league?.period, force }),
    });
    const d = await r.json();
    setLeagueBusy(false);
    setLeaguePreview(d.telegramMessage || "");
    notify(
      d.error
        ? d.error
        : d.alreadyAwarded
        ? "این دوره قبلاً اعلام شده است (برای ارسال مجدد، force را بزنید) 🏆"
        : d.telegram?.sent
        ? "🏆 کارمند برتر ماه اعلام و به تلگرام ارسال شد"
        : "🏆 برنده ثبت شد (ارسال تلگرام: توکن/چت تنظیم نشده یا شبیهسازی)"
    );
    load();
  }

  async function load(periodOverride?: string) {
    const lp = periodOverride !== undefined ? periodOverride : leaguePeriod;
    const [p, t, m, tx, l, tl, ag, wl, s, lg] = await Promise.all([
      fetch("/api/projects").then((r) => r.json()),
      fetch("/api/rest?type=tasks").then((r) => r.json()),
      fetch("/api/rest?type=messages").then((r) => r.json()),
      fetch("/api/rest?type=transactions").then((r) => r.json()),
      fetch("/api/rest?type=logs").then((r) => r.json()),
      fetch("/api/rest?type=tools").then((r) => r.json()),
      fetch("/api/agents").then((r) => r.json()),
      fetch("/api/wallet").then((r) => r.json()),
      fetch("/api/stats").then((r) => r.json()),
      fetch(`/api/leaderboard${lp ? `?period=${lp}` : ""}`)
        .then((r) => r.json())
        .catch(() => null),
    ]);
    setProjects(Array.isArray(p) ? p : []);
    setTasks(Array.isArray(t) ? t : []);
    setMsgs(Array.isArray(m) ? m : []);
    setTxs(Array.isArray(tx) ? tx : []);
    setLogs(Array.isArray(l) ? l : []);
    setTools(Array.isArray(tl) ? tl : []);
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
    if (lg && !lg.error) {
      setLeague(lg);
      setLeagueConfig((prev: any) => prev ?? lg.config ?? null);
    }
    setLoading(false);
  }

  useEffect(() => {
    fetch("/api/auth/login")
      .then((r) => r.json())
      .then((d) => {
        if (!d.user) {
          location.href = "/login";
        } else {
          setUser(d.user);
        }
      });
    load();
    const iv = setInterval(() => {
      fetch("/api/stats")
        .then((r) => r.json())
        .then(setStats)
        .catch(() => {});
    }, 6000);
    return () => clearInterval(iv);
    // load() فقط یکبار در mount اجرا میشود؛ بقیهٔ بروزرسانیها صریحاً فراخوانی میشوند.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = projects.filter(
    (p) =>
      (filter === "all" || p.status === filter) &&
      (p.title + p.clientName + p.telegramUser).includes(q)
  );

  const chatList = useMemo(() => {
    const map = new Map();
    msgs.forEach((m) => {
      if (!map.has(m.clientName)) map.set(m.clientName, m);
    });
    return [...map.values()];
  }, [msgs]);

  const chatMsgs = msgs
    .filter((m) => m.clientName === chatUser)
    .slice()
    .reverse();

  const cryptoEmployee = useMemo(
    () =>
      agentsList.find((a) => a.specialty === "crypto") || agentsList[0] || null,
    [agentsList]
  );

  const totalFleetEarned = useMemo(
    () =>
      agentsList.reduce((sum, a) => sum + Number(a.earnedUsdt || 0), 0),
    [agentsList]
  );

  async function saveProject(e: any) {
    e.preventDefault();
    const method = edit ? "PUT" : "POST";
    const body = edit ? { ...form, id: edit.id } : form;
    const res = await fetch("/api/projects", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await res.json();
    if (edit) setProjects((prev) => prev.map((p) => (p.id === d.id ? d : p)));
    else setProjects((prev) => [d, ...prev]);
    setShowForm(false);
    setEdit(null);
    notify(edit ? "پروژه ویرایش شد ✅" : "پروژه جدید ساخته شد ✅");
    load();
  }

  async function delProject(id: number) {
    if (!confirm("این پروژه حذف شود؟")) return;
    setProjects((prev) => prev.filter((p) => p.id !== id));
    await fetch(`/api/projects?id=${id}`, { method: "DELETE" });
    notify("پروژه حذف شد 🗑️");
  }

  async function actTask(t: any, st: string) {
    setTasks((prev) =>
      prev.map((x) => (x.id === t.id ? { ...x, status: st } : x))
    );
    await fetch("/api/rest", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        _type: "tasks",
        id: t.id,
        status: st,
        title: t.title,
        agent: t.agent,
        actionType: t.actionType,
        description: t.description,
        projectTitle: t.projectTitle,
        risk: t.risk,
        payload: t.payload,
      }),
    });
    await fetch("/api/telegram/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        callback_query: {
          data: `${st === "approved" ? "approve" : "reject"}:${t.id}`,
          from: { username: "admin" },
        },
      }),
    });
    notify(
      st === "approved"
        ? "از طریق پنل و تلگرام تأیید شد ✅"
        : "تسک رد شد ❌"
    );
    load();
  }

  async function sendChat() {
    if (!chatText.trim()) return;
    const body = {
      _type: "messages",
      chatId: "1001",
      clientName: chatUser,
      username:
        chatList.find((c) => c.clientName === chatUser)?.username || "",
      direction: "out",
      text: chatText,
      status: "read",
      source: "panel",
    };
    const res = await fetch("/api/rest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await res.json();
    setMsgs((prev) => [d, ...prev]);
    setChatText("");
    notify("پیام از طریق ربات تلگرام ارسال شد 📩");
    setTimeout(async () => {
      const r = await fetch("/api/telegram/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientName: chatUser,
          username: body.username,
          text: "ممنون! متوجه شدم، لطفاً آدرس کیف پول واحد USDT رو هم بفرستید 🙏",
        }),
      });
      const dd = await r.json();
      if (dd.message) setMsgs((prev) => [dd.message, ...prev]);
    }, 1800);
  }

  async function simulateWebhook() {
    const texts = [
      "سلام، یه پروژه Next.js دارم بودجه ۶۰۰ USDT",
      "برای تحلیل رمزارز و ربات ترید چقدر می‌گیرید؟",
      "پروژه رو شروع کنیم، پیش‌پرداخت USDT می‌زنم",
    ];
    const t = texts[Math.floor(Math.random() * texts.length)];
    await fetch("/api/telegram/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          text: t,
          from: { first_name: "کاربر جدید", username: "new_client" },
          chat: { id: 777 },
        },
      }),
    });
    notify("Webhook تلگرام: پیام جدید + تسک تأیید ساخته شد 🔔");
    load();
  }

  async function runTool(tool: string) {
    setToolOut("⏳ ایجنت در حال اجرا...");
    const r = await fetch("/api/tools/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool, input: toolInput }),
    });
    const d = await r.json();
    setToolOut(d.output);
    setTools((prev) => [d, ...prev]);
    load();
  }

  async function addTx(e: any) {
    e.preventDefault();
    const r = await fetch("/api/rest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        _type: "transactions",
        ...txForm,
        destinationWallet: walletForm.address,
      }),
    });
    const d = await r.json();
    setTxs((prev) => [d, ...prev]);
    setTxForm({
      title: "",
      projectTitle: "",
      agentName: "سیستم مرکزی",
      amountUsdt: "",
      network: "TRC20",
      txHash: "",
      kind: "income",
      status: "confirmed",
    });
    notify("تراکنش در کیف پول واحد ثبت شد 💰");
    load();
  }

  // اجرای کارمند رمزارز یا هر ایجنت دیگر و واریز مستقیم به کیف پول واحد
  async function executeAgentPayout(
    agent: any,
    options?: { strategy?: string; amountUsdt?: number; title?: string }
  ) {
    setRunningAgentId(agent.id);
    try {
      const res = await fetch("/api/agents/ingest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-agent-key": agent.apiKey,
        },
        body: JSON.stringify({
          agentId: agent.id,
          slug: agent.slug,
          strategy: options?.strategy || "arbitrage",
          amountUsdt: options?.amountUsdt,
          title: options?.title,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        if (agent.specialty === "crypto" || options?.strategy) {
          setCryptoReport(data.report);
        }
        notify(
          `+${fa(data.amountUsdt)} USDT توسط «${agent.name}» به کیف پول واحد واریز شد 🪙`
        );
        await load();
      } else {
        notify(data.error || "خطا در اجرای ایجنت");
      }
    } finally {
      setRunningAgentId(null);
    }
  }

  // استخدام کارمند دیجیتال / ساخت API ایجنت جدید
  async function createNewAgent(e: any) {
    e.preventDefault();
    if (!newAgent.name.trim()) return;
    const res = await fetch("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newAgent),
    });
    const created = await res.json();
    setAgentsList((prev) => [created, ...prev]);
    setSelectedApiAgent(created);
    setNewAgent({
      name: "",
      role: "",
      specialty: "crypto",
      avatar: "🪙",
      strategy: "",
    });
    notify(`کارمند/API جدید «${created.name}» ساخته و به کیف پول واحد متصل شد ✅`);
    load();
  }

  async function toggleAgentStatus(agent: any) {
    const nextStatus = agent.status === "active" ? "paused" : "active";
    setAgentsList((prev) =>
      prev.map((a) => (a.id === agent.id ? { ...a, status: nextStatus } : a))
    );
    await fetch("/api/agents", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...agent, status: nextStatus }),
    });
    notify(
      nextStatus === "active"
        ? `ایجنت «${agent.name}» فعال شد 🟢`
        : `ایجنت «${agent.name}» متوقف شد ⏸️`
    );
  }

  async function deleteAgent(id: number) {
    if (!confirm("این ایجنت حذف شود؟")) return;
    setAgentsList((prev) => prev.filter((a) => a.id !== id));
    await fetch(`/api/agents?id=${id}`, { method: "DELETE" });
    notify("ایجنت حذف شد 🗑️");
  }

  async function saveMasterWallet(e: any) {
    e.preventDefault();
    const res = await fetch("/api/wallet", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(walletForm),
    });
    const d = await res.json();
    if (d.ok) {
      notify("آدرس کیف پول واحد ذخیره شد و همه ایجنت‌ها به آن متصل شدند 💳✅");
      load();
    }
  }

  const maxChart = Math.max(...(stats?.chart?.map((c: any) => c.v) || [1]));

  const lb = league;
  const lbRows: any[] = Array.isArray(lb?.rows) ? lb.rows : [];
  const lbWinner = lb?.winner || null;
  const lbEvents: any[] = Array.isArray(lb?.recentEvents) ? lb.recentEvents : [];
  const lbAwards: any[] = Array.isArray(lb?.awards) ? lb.awards : [];
  const lbPeriods: string[] = Array.isArray(lb?.periods) ? lb.periods : [];
  const lbCfg = leagueConfig ||
    lb?.config || {
      weightSuccess: 60,
      weightRevenue: 30,
      weightSpeed: 10,
      revenueTarget: 1000,
      durationTarget: 60,
      boostMultiplier: 2,
    };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-5xl animate-bounce">🤖</div>
          <p className="mt-3 font-bold">
            در حال بارگذاری ناوگان ایجنت‌ها و کیف پول واحد...
          </p>
        </div>
      </div>
    );
  }

  const nav: [string, string][] = [
    ["dashboard", "🏠 داشبورد"],
    ["agents", "🪙 ناوگان ایجنت‌ها و رمزارز"],
    ["leaderboard", "🏆 لیگ کارمندان"],
    ["projects", "💼 پروژه‌ها"],
    ["chats", "💬 گفتگوها"],
    ["approvals", "✅ تأیید انسانی"],
    ["earnings", "💰 کیف پول واحد و درآمد"],
    ["tools", "⚡ ابزارهای خودکار"],
    ["telegram", "📩 تلگرام و Webhook"],
    ["deploy", "☁️ اتصال Supabase & Vercel"],
    ["logs", "🧠 لاگ ایجنت‌ها"],
  ];

  const originUrl =
    typeof window !== "undefined"
      ? window.location.origin
      : "https://your-app.vercel.app";

  return (
    <div className="min-h-screen flex bg-[#F6F7F9]">
      {/* سایدبار دسکتاپ */}
      <aside className="hidden lg:flex w-72 flex-col bg-[#0B1220] text-white p-5 sticky top-0 h-screen overflow-y-auto">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 bg-emerald-500 rounded-2xl grid place-items-center text-2xl">
            🤖
          </div>
          <div>
            <b>Freelance & Crypto OS</b>
            <p className="text-xs text-slate-400">
              ناوگان ایجنت + کیف پول واحد
            </p>
          </div>
        </div>

        {/* کارت خلاصه کیف پول واحد در سایدبار */}
        <div className="bg-emerald-500/15 border border-emerald-400/30 rounded-2xl p-3 mt-5 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-emerald-300 font-bold">💳 کیف پول واحد</span>
            <span className="bg-emerald-500 text-black px-2 py-0.5 rounded-full font-bold text-[10px]">
              {walletForm.network}
            </span>
          </div>
          <p className="text-lg font-black text-white mt-1">
            {fa(stats?.income || totalFleetEarned)} USDT
          </p>
          <p
            className="text-slate-300 truncate mt-1 cursor-pointer"
            dir="ltr"
            onClick={() => copyText(walletForm.address, "آدرس کیف پول کپی شد 💳")}
          >
            {walletForm.address}
          </p>
        </div>

        <div className="bg-white/10 rounded-2xl p-3 mt-3 text-xs">
          <span className="live-dot inline-block w-2 h-2 bg-emerald-400 rounded-full ml-2"></span>
          {fa(stats?.activeAgents || agentsList.length)} ایجنت فعال متصل
          <p className="text-emerald-300 mt-1" dir="ltr">
            @FreelanceAgentBot
          </p>
        </div>

        <nav className="mt-5 space-y-1 flex-1">
          {nav.map(([k, l]) => (
            <button
              key={k}
              onClick={() => setView(k)}
              className={`w-full text-right px-4 py-2.5 rounded-xl font-bold text-sm transition ${
                view === k
                  ? "bg-emerald-500 text-black"
                  : "hover:bg-white/10 text-slate-200"
              }`}
            >
              {l}
              {k === "approvals" && stats?.pendingTasks > 0 && (
                <span className="bg-red-500 text-white text-xs px-2 py-0.5 rounded-full float-left">
                  {fa(stats.pendingTasks)}
                </span>
              )}
              {k === "chats" && stats?.unread > 0 && (
                <span className="bg-red-500 text-white text-xs px-2 py-0.5 rounded-full float-left">
                  {fa(stats.unread)}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="border-t border-white/10 pt-4 mt-4">
          <p className="font-bold text-sm">{user?.name || "مدیر سیستم"}</p>
          <p className="text-xs text-slate-400">{user?.email}</p>
          <button
            onClick={async () => {
              await fetch("/api/auth/login", { method: "DELETE" }).catch(
                () => {}
              );
              location.href = "/login";
            }}
            className="text-red-300 text-xs mt-2"
          >
            خروج از حساب ←
          </button>
        </div>
      </aside>

      {/* محتوای اصلی */}
      <main className="flex-1 p-4 md:p-7 max-w-[1400px] mx-auto w-full">
        <header className="flex flex-wrap gap-3 items-center justify-between">
          <div>
            <h1 className="text-2xl md:text-3xl font-black">
              {nav.find((n) => n[0] === view)?.[1]}
            </h1>
            <p className="text-slate-500 text-sm mt-1">
              {fa(agentsList.length)} ایجنت فعال • {fa(stats?.projects)} پروژه •{" "}
              {fa(stats?.pendingTasks)} تسک منتظر تأیید
            </p>
          </div>

          <div className="flex gap-2 flex-wrap items-center">
            <span className="bg-white border rounded-full px-3 py-2 text-sm">
              USDT{" "}
              <b className="text-emerald-600">
                ${stats?.livePrice?.toFixed(3) || "1.000"}
              </b>
            </span>
            <span className="bg-white border rounded-full px-3 py-2 text-sm">
              BTC <b>${fa(stats?.btc)}</b>
            </span>
            <span className="bg-white border rounded-full px-3 py-2 text-sm">
              ETH <b>${fa(stats?.eth)}</b>
            </span>
            {cryptoEmployee && (
              <button
                onClick={() =>
                  executeAgentPayout(cryptoEmployee, {
                    strategy: cryptoStrategy,
                  })
                }
                disabled={runningAgentId === cryptoEmployee.id}
                className="bg-amber-500 hover:bg-amber-400 text-black px-4 py-2 rounded-full font-bold text-sm transition"
              >
                {runningAgentId === cryptoEmployee.id
                  ? "⏳ در حال معامله..."
                  : "🪙 اجرای فوری کارمند رمزارز"}
              </button>
            )}
            <button
              onClick={simulateWebhook}
              className="bg-[#229ED9] text-white px-4 py-2 rounded-full font-bold text-sm"
            >
              📩 پیام تلگرام
            </button>
          </div>
        </header>

        {/* منوی موبایل */}
        <div className="lg:hidden flex gap-2 overflow-x-auto py-4">
          {nav.map(([k, l]) => (
            <button
              key={k}
              onClick={() => setView(k)}
              className={`whitespace-nowrap px-3 py-2 rounded-full text-sm font-bold ${
                view === k ? "bg-emerald-500 text-black" : "bg-white border"
              }`}
            >
              {l}
            </button>
          ))}
        </div>

        {/* ==================== ۱. داشبورد اصلی ==================== */}
        {view === "dashboard" && (
          <section>
            {/* بنر کیف پول واحد مرکزی */}
            <div className="bg-[#0B1220] text-white rounded-3xl p-5 mt-4 flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="bg-emerald-500 text-black text-xs font-black px-3 py-1 rounded-full">
                    کیف پول واحد مرکزی (Unified Master Vault)
                  </span>
                  <span className="text-xs text-emerald-300">
                    ● همه ایجنت‌ها مستقیم به این آدرس واریز می‌کنند
                  </span>
                </div>
                <p className="text-3xl font-black mt-3">
                  {fa(stats?.income || totalFleetEarned)}{" "}
                  <span className="text-emerald-400 text-lg">USDT</span>
                </p>
                <p className="text-xs text-slate-300 mt-1">
                  آدرس مقصد:{" "}
                  <span dir="ltr" className="font-mono text-emerald-300">
                    {walletForm.address}
                  </span>{" "}
                  ({walletForm.network})
                </p>
              </div>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() =>
                    copyText(walletForm.address, "آدرس کیف پول واحد کپی شد ✅")
                  }
                  className="bg-white/10 hover:bg-white/20 px-4 py-2.5 rounded-2xl text-sm font-bold"
                >
                  📋 کپی آدرس کیف پول
                </button>
                <button
                  onClick={() => setView("agents")}
                  className="bg-emerald-500 hover:bg-emerald-400 text-black px-5 py-2.5 rounded-2xl text-sm font-bold"
                >
                  🪙 مدیریت کارمند رمزارز و ایجنت‌ها ←
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
              {[
                [
                  "💰 کل واریزی به کیف پول واحد",
                  fa(stats?.income) + " USDT",
                  "text-emerald-600",
                ],
                [
                  "🪙 تولید ناوگان ایجنت‌ها",
                  fa(totalFleetEarned) + " USDT",
                  "text-amber-600",
                ],
                ["🚀 پروژه فعال", fa(stats?.active), ""],
                [
                  "⏳ منتظر تأیید انسانی",
                  fa(stats?.pendingTasks),
                  "text-amber-600",
                ],
              ].map(([l, v, c]: any) => (
                <div key={l} className="bg-white rounded-3xl p-5 border">
                  <p className="text-slate-500 text-sm">{l}</p>
                  <p className={`text-2xl font-black mt-2 ${c}`}>{v}</p>
                </div>
              ))}
            </div>

            <div className="grid lg:grid-cols-5 gap-4 mt-4">
              <div className="lg:col-span-3 bg-white rounded-3xl border p-5">
                <h3 className="font-black">📈 نمودار درآمد USDT (۶ ماه)</h3>
                <div className="flex items-end gap-3 h-48 mt-6">
                  {stats?.chart?.map((c: any) => (
                    <div key={c.m} className="flex-1 text-center">
                      <div
                        className="bg-emerald-500 rounded-t-xl mx-auto w-full max-w-[52px]"
                        style={{ height: `${(c.v / maxChart) * 160}px` }}
                      ></div>
                      <p className="text-xs mt-2 font-bold">{fa(c.v)}</p>
                      <p className="text-[11px] text-slate-400">{c.m}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="lg:col-span-2 bg-white rounded-3xl border p-5">
                <h3 className="font-black mb-2">
                  🤖 سهم ایجنت‌ها در کیف پول واحد
                </h3>
                {agentsList.slice(0, 5).map((a) => {
                  const share = totalFleetEarned
                    ? Math.round((a.earnedUsdt / totalFleetEarned) * 100)
                    : 0;
                  return (
                    <div key={a.id} className="py-2 border-b last:border-0">
                      <div className="flex justify-between text-sm">
                        <span className="truncate font-bold">
                          {a.avatar} {a.name}
                        </span>
                        <b className="text-emerald-600">
                          {fa(a.earnedUsdt)} USDT ({fa(share)}٪)
                        </b>
                      </div>
                      <div className="h-1.5 bg-slate-100 rounded-full mt-1">
                        <div
                          className="h-full bg-emerald-500 rounded-full"
                          style={{ width: `${share}%` }}
                        ></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="grid lg:grid-cols-2 gap-4 mt-4">
              <div className="bg-white rounded-3xl border p-5">
                <h3 className="font-black">✅ تسک‌های منتظر تأیید</h3>
                {tasks
                  .filter((t) => t.status === "pending")
                  .slice(0, 3)
                  .map((t) => (
                    <div key={t.id} className="border rounded-2xl p-3 mt-3">
                      <b>{t.title}</b>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {t.agent} • {t.projectTitle}
                      </p>
                      <div className="flex gap-2 mt-2">
                        <button
                          onClick={() => actTask(t, "approved")}
                          className="bg-emerald-500 text-white px-3 py-1 rounded-full text-sm font-bold"
                        >
                          تأیید ✅
                        </button>
                        <button
                          onClick={() => actTask(t, "rejected")}
                          className="bg-red-50 text-red-600 px-3 py-1 rounded-full text-sm font-bold"
                        >
                          رد ❌
                        </button>
                      </div>
                    </div>
                  ))}
                {tasks.filter((t) => t.status === "pending").length === 0 && (
                  <p className="text-slate-400 mt-4">🎉 تسک منتظری نیست</p>
                )}
              </div>

              <div className="bg-white rounded-3xl border p-5">
                <h3 className="font-black">💬 پیام‌های اخیر تلگرام</h3>
                {msgs.slice(0, 4).map((m) => (
                  <div key={m.id} className="py-2 border-b last:border-0">
                    <b>{m.clientName}</b>{" "}
                    <span className="text-slate-400 text-xs">{m.username}</span>
                    <p className="text-sm text-slate-600 truncate">{m.text}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* خلاصهٔ لیگ کارمندان روی داشبورد */}
            <div className="bg-gradient-to-l from-amber-50 via-white to-white border border-amber-200 rounded-3xl p-5 mt-4">
              <div className="flex flex-wrap justify-between items-center gap-2">
                <h3 className="font-black">
                  🏆 لیگ کارمندان — {lb?.periodTitle || "دورهٔ جاری"}
                </h3>
                <button
                  onClick={() => setView("leaderboard")}
                  className="text-xs bg-amber-400 text-black px-3 py-1.5 rounded-full font-bold"
                >
                  مشاهدهٔ جدول کامل ←
                </button>
              </div>
              <div className="grid md:grid-cols-3 gap-3 mt-3">
                {lbRows.slice(0, 3).map((r) => (
                  <div key={r.agentId} className="bg-white border rounded-2xl p-3">
                    <div className="flex justify-between items-center gap-2">
                      <span className="font-bold text-sm truncate">
                        {medal(r.rank)} {r.avatar} {r.name}
                      </span>
                      <b className="text-amber-600">{fa(r.score)}</b>
                    </div>
                    <div className="h-1.5 bg-slate-100 rounded-full mt-2">
                      <div
                        className="h-full bg-amber-400 rounded-full"
                        style={{ width: `${Math.min(100, r.score)}%` }}
                      ></div>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      {fa(r.successRate)}٪ موفق • {fa(r.revenueUsdt)} USDT
                      {r.boosted ? " • 🚀 اولویت ویژه" : ""}
                    </p>
                  </div>
                ))}
                {lbRows.length === 0 && (
                  <p className="text-slate-400 text-sm">دادهای برای لیگ ثبت نشده است</p>
                )}
              </div>
            </div>
          </section>
        )}

        {/* ==================== 🏆 لیگ کارمندان / کارمند برتر ماه ==================== */}
        {view === "leaderboard" && (
          <section className="mt-4 space-y-4">
            {/* هدر و کنترل دوره */}
            <div className="bg-gradient-to-l from-[#0B1220] to-[#16263f] text-white rounded-3xl p-5 flex flex-wrap items-center justify-between gap-4">
              <div>
                <span className="bg-amber-400 text-black text-xs font-black px-3 py-1 rounded-full">
                  🏆 سیستم ارزیابی و رقابت ایجنتها
                </span>
                <h2 className="text-2xl font-black mt-3">
                  کارمند برتر ماه — {lb?.periodTitle || "در حال بارگذاری"}
                </h2>
                <p className="text-slate-300 text-xs mt-2 leading-6">
                  {lb?.formula || "موفقیت ۶۰٪ • درآمد ۳۰٪ • سرعت و دقت ۱۰٪"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <select
                  value={leaguePeriod}
                  onChange={(e) => changeLeaguePeriod(e.target.value)}
                  className="bg-white text-slate-900 rounded-xl px-3 py-2 text-sm font-bold"
                >
                  <option value="">دورهٔ جاری</option>
                  {lbPeriods.map((p) => (
                    <option key={p} value={p}>
                      {persianMonth(p)}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => load()}
                  className="bg-white/15 hover:bg-white/25 px-3 py-2 rounded-xl text-sm font-bold"
                >
                  🔄 بروزرسانی
                </button>
                <button
                  onClick={previewLeague}
                  disabled={leagueBusy}
                  className="bg-white/15 hover:bg-white/25 px-3 py-2 rounded-xl text-sm font-bold disabled:opacity-50"
                >
                  👁️ پیشنمایش تلگرام
                </button>
                <button
                  onClick={() => closeLeagueMonth(false)}
                  disabled={leagueBusy}
                  className="bg-amber-400 hover:bg-amber-300 text-black px-4 py-2 rounded-xl text-sm font-black disabled:opacity-50"
                >
                  🏆 اعلام و ارسال
                </button>
              </div>
            </div>

            {/* کارت برنده + پاداش ساختاری */}
            <div className="grid lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2 bg-white border rounded-3xl p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <span className="bg-amber-100 text-amber-800 text-xs font-black px-3 py-1 rounded-full">
                      🥇 مقام اول دوره
                    </span>
                    <h3 className="text-xl font-black mt-3">
                      {lbWinner ? `${lbWinner.avatar} ${lbWinner.name}` : "هنوز برندهای نداریم"}
                    </h3>
                    <p className="text-xs text-slate-500 mt-1">
                      {lbWinner?.slug ? `کد ایجنت: ${lbWinner.slug}` : "برای شروع، نتیجهٔ یک پروژه را ثبت کنید"}
                    </p>
                  </div>
                  <div className="text-left">
                    <p className="text-3xl font-black text-amber-600">
                      {fa(lbWinner?.score || 0)}
                    </p>
                    <p className="text-xs text-slate-400">امتیاز از ۱۰۰</p>
                  </div>
                </div>

                {lbWinner && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-4">
                    <div className="bg-emerald-50 rounded-2xl p-3">
                      <p className="text-xs text-slate-500">نرخ موفقیت</p>
                      <b className="text-emerald-700">{fa(lbWinner.successRate)}٪</b>
                      <p className="text-[11px] text-slate-500">
                        {fa(lbWinner.successes)} از {fa(lbWinner.totalProjects)} پروژه
                      </p>
                    </div>
                    <div className="bg-sky-50 rounded-2xl p-3">
                      <p className="text-xs text-slate-500">سود خالص</p>
                      <b className="text-sky-700">{fa(lbWinner.revenueUsdt)} USDT</b>
                      <p className="text-[11px] text-slate-500">تراکنشهای تأییدشده</p>
                    </div>
                    <div className="bg-violet-50 rounded-2xl p-3">
                      <p className="text-xs text-slate-500">زمان تأیید</p>
                      <b className="text-violet-700">{fa(lbWinner.avgDurationMinutes)} دقیقه</b>
                      <p className="text-[11px] text-slate-500">پیشنهاد → تحویل</p>
                    </div>
                    <div className="bg-amber-50 rounded-2xl p-3">
                      <p className="text-xs text-slate-500">امتیاز انگیزشی</p>
                      <b className="text-amber-700">{fa(lbWinner.points)}</b>
                      <p className="text-[11px] text-slate-500">+۱۰ / -۵ / -۸</p>
                    </div>
                  </div>
                )}

                {lbWinner && (
                  <div className="mt-4 space-y-2">
                    {([
                      ["success", "نرخ موفقیت (هموارشده)", "weightSuccess", "bg-emerald-500"],
                      ["revenue", "حجم و ارزش خروجی", "weightRevenue", "bg-sky-500"],
                      ["speed", "سرعت عمل و دقت", "weightSpeed", "bg-violet-500"],
                    ] as const).map(([key, label, weightKey, color]) => {
                      const part = Number(lbWinner.breakdown?.[key] || 0);
                      const max = Number(lbCfg[weightKey] || 1);
                      return (
                        <div key={key}>
                          <div className="flex justify-between text-xs font-bold">
                            <span>
                              {label} — {fa(max)}٪ وزن
                            </span>
                            <span>
                              {fa(part)} / {fa(max)} امتیاز
                            </span>
                          </div>
                          <div className="h-2 bg-slate-100 rounded-full mt-1">
                            <div
                              className={`h-full ${color} rounded-full`}
                              style={{ width: `${Math.min(100, (part / max) * 100)}%` }}
                            ></div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="bg-white border rounded-3xl p-5">
                <h3 className="font-black">🎁 پاداش ساختاری</h3>
                <p className="text-sm text-slate-500 mt-2 leading-7">
                  برندهٔ هر دوره در دورهٔ بعدیِ تخصیص منابع، اولویت اسکن بازار و
                  پردازش بیشتری میگیرد؛ وقتی در <code dir="ltr">/api/agents/ingest</code>{" "}
                  ایجنتی صریحاً مشخص نشود، مأموریت به برنده سپرده میشود.
                </p>
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 mt-3 text-sm">
                  <b>
                    🚀 اولویت{" "}
                    {fa(lb?.boost?.multiplier || lbCfg.boostMultiplier)} برابری
                  </b>
                  <p className="text-xs text-slate-600 mt-1">
                    ایجنت: {lb?.boost?.name || "هنوز برندهای اعلام نشده"}
                  </p>
                  <p className="text-xs text-slate-600">
                    دورهٔ مشمول:{" "}
                    {lb?.boost?.period ? persianMonth(lb.boost.period) : "—"}
                  </p>
                </div>
                <button
                  onClick={() => closeLeagueMonth(false)}
                  disabled={leagueBusy}
                  className="w-full bg-[#0B1220] text-white py-2.5 rounded-xl font-bold text-sm mt-3 disabled:opacity-50"
                >
                  🏆 بستن دوره و اعلام برنده
                </button>
                <button
                  onClick={() => closeLeagueMonth(true)}
                  disabled={leagueBusy}
                  className="w-full border py-2.5 rounded-xl font-bold text-xs mt-2 disabled:opacity-50"
                >
                  ارسال مجدد گزارش (force)
                </button>
              </div>
            </div>

            {/* جدول لیگ */}
            <div className="bg-white border rounded-3xl p-5">
              <div className="flex flex-wrap justify-between items-center gap-2">
                <h3 className="font-black">📊 جدول لیگ — {fa(lbRows.length)} ایجنت</h3>
                <span className="text-xs text-slate-500">
                  {fa(lb?.totalEvents)} نتیجهٔ ثبتشده •{" "}
                  {fa(lb?.totalRevenue)} USDT درآمد منتسب
                </span>
              </div>
              <div className="mt-3 space-y-2">
                {lbRows.map((r) => (
                  <div
                    key={r.agentId}
                    className={`border rounded-2xl p-3 ${
                      r.rank === 1 ? "border-amber-300 bg-amber-50/60" : ""
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xl w-8 text-center">{medal(r.rank)}</span>
                        <span className="text-2xl">{r.avatar}</span>
                        <div className="min-w-0">
                          <b className="text-sm block truncate">{r.name}</b>
                          <span className="text-xs text-slate-500">
                            {specialtyMap[r.specialty]?.[0] || r.specialty} •{" "}
                            {fa(r.totalProjects)} پروژه
                          </span>
                        </div>
                        {r.boosted && (
                          <span className="bg-amber-100 text-amber-800 text-[11px] px-2 py-0.5 rounded-full font-bold">
                            🚀 اولویت ویژه
                          </span>
                        )}
                        {r.needsReview && (
                          <span className="bg-red-100 text-red-700 text-[11px] px-2 py-0.5 rounded-full font-bold">
                            ⚠️ نیازمند بازبینی پرامپت
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        {r.rankDelta !== null && r.rankDelta !== 0 && (
                          <span
                            className={`text-xs font-bold ${
                              r.rankDelta > 0 ? "text-emerald-600" : "text-red-500"
                            }`}
                          >
                            {r.rankDelta > 0
                              ? `▲ ${fa(r.rankDelta)} رتبه صعود`
                              : `▼ ${fa(-r.rankDelta)} رتبه نزول`}
                          </span>
                        )}
                        <div className="text-left">
                          <b className="text-lg text-amber-600">{fa(r.score)}</b>
                          <span className="text-xs text-slate-400"> / ۱۰۰</span>
                        </div>
                      </div>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full mt-2">
                      <div
                        className="h-full bg-amber-400 rounded-full"
                        style={{ width: `${Math.min(100, r.score)}%` }}
                      ></div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mt-2 text-xs items-center">
                      <span>✅ {fa(r.successRate)}٪ موفق ({fa(r.successes)}/{fa(r.totalProjects)})</span>
                      <span>💰 {fa(r.revenueUsdt)} USDT</span>
                      <span>⏱ {fa(r.avgDurationMinutes)} دقیقه</span>
                      <span className={r.points < 0 ? "text-red-600" : "text-emerald-600"}>
                        ⭐ {fa(r.points)} امتیاز انگیزشی
                      </span>
                      <button
                        onClick={() => {
                          setLeagueEvent((p: any) => ({
                            ...p,
                            agentId: String(r.agentId),
                          }));
                          notify(`ایجنت «${r.name}» برای ثبت نتیجه انتخاب شد ✍️`);
                        }}
                        className="border rounded-full px-2 py-1 font-bold hover:bg-slate-50"
                      >
                        ✍️ ثبت نتیجه
                      </button>
                    </div>
                  </div>
                ))}
                {lbRows.length === 0 && (
                  <p className="text-slate-400 text-sm text-center py-6">
                    ایجنتی برای نمایش وجود ندارد
                  </p>
                )}
              </div>
            </div>

            {/* تنظیمات فرمول + ثبت نتیجه */}
            <div className="grid lg:grid-cols-2 gap-4">
              <form onSubmit={saveLeagueConfig} className="bg-white border rounded-3xl p-5">
                <h3 className="font-black">⚙️ تنظیم فرمول امتیازدهی (KPI)</h3>
                <p className="text-xs text-slate-500 mt-1">
                  وزنها بهطور خودکار نرمالسازی میشوند؛ نیازی به جمع دقیق ۱۰۰ نیست.
                </p>
                <div className="grid grid-cols-2 gap-3 mt-3">
                  {([
                    ["weightSuccess", "وزن نرخ موفقیت (٪)"],
                    ["weightRevenue", "وزن درآمد (٪)"],
                    ["weightSpeed", "وزن سرعت و دقت (٪)"],
                    ["revenueTarget", "هدف درآمد دوره (USDT)"],
                    ["durationTarget", "زمان هدف تأیید (دقیقه)"],
                    ["boostMultiplier", "ضریب پاداش برنده"],
                  ] as const).map(([k, label]) => (
                    <label key={k} className="text-xs font-bold">
                      {label}
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={lbCfg[k] ?? 0}
                        onChange={(e) =>
                          setLeagueConfig({
                            ...lbCfg,
                            [k]: Number(e.target.value),
                          })
                        }
                        className="w-full border rounded-xl p-2.5 mt-1 font-normal"
                      />
                    </label>
                  ))}
                </div>
                <p className="text-xs text-slate-500 mt-3">
                  مجموع وزنها:{" "}
                  {fa(
                    Number(lbCfg.weightSuccess) +
                      Number(lbCfg.weightRevenue) +
                      Number(lbCfg.weightSpeed)
                  )}
                  ٪
                </p>
                <button
                  disabled={leagueBusy}
                  className="w-full bg-[#0B1220] text-white py-2.5 rounded-xl font-bold text-sm mt-3 disabled:opacity-50"
                >
                  ذخیرهٔ تنظیمات ⚙️
                </button>
              </form>

              <form onSubmit={saveLeagueEvent} className="bg-white border rounded-3xl p-5">
                <h3 className="font-black">✍️ ثبت نتیجهٔ پروژه (پاداش / تنبیه دیجیتال)</h3>
                <p className="text-xs text-slate-500 mt-1">
                  تأیید انسانی (HITL) از پنل و تلگرام هم بهصورت خودکار اینجا ثبت میشود.
                </p>
                <div className="grid grid-cols-2 gap-3 mt-3">
                  <select
                    value={leagueEvent.agentId}
                    onChange={(e) =>
                      setLeagueEvent({ ...leagueEvent, agentId: e.target.value })
                    }
                    className="border rounded-xl p-2.5 text-sm col-span-2"
                  >
                    <option value="">انتخاب ایجنت *</option>
                    {agentsList.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.avatar} {a.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={leagueEvent.outcome}
                    onChange={(e) =>
                      setLeagueEvent({ ...leagueEvent, outcome: e.target.value })
                    }
                    className="border rounded-xl p-2.5 text-sm col-span-2"
                  >
                    <option value="success">✅ موفق و تأییدشده (+۱۰)</option>
                    <option value="failure">❌ شکست / رد شده (-۵)</option>
                    <option value="error">⚠️ خطای اجرایی (-۸)</option>
                  </select>
                  <input
                    value={leagueEvent.projectTitle}
                    onChange={(e) =>
                      setLeagueEvent({ ...leagueEvent, projectTitle: e.target.value })
                    }
                    placeholder="عنوان پروژه"
                    className="border rounded-xl p-2.5 text-sm col-span-2"
                  />
                  <label className="text-xs font-bold">
                    زمان پیشنهاد تا تأیید (دقیقه)
                    <input
                      type="number"
                      min="0"
                      value={leagueEvent.durationMinutes}
                      onChange={(e) =>
                        setLeagueEvent({
                          ...leagueEvent,
                          durationMinutes: e.target.value,
                        })
                      }
                      className="w-full border rounded-xl p-2.5 mt-1 font-normal"
                    />
                  </label>
                  <label className="text-xs font-bold">
                    توضیح / دلیل خطا
                    <input
                      value={leagueEvent.note}
                      onChange={(e) =>
                        setLeagueEvent({ ...leagueEvent, note: e.target.value })
                      }
                      placeholder="اختیاری"
                      className="w-full border rounded-xl p-2.5 mt-1 font-normal"
                    />
                  </label>
                </div>
                <div className="flex gap-2 mt-3">
                  <button
                    disabled={leagueBusy}
                    className="flex-1 bg-emerald-500 text-white py-2.5 rounded-xl font-bold text-sm disabled:opacity-50"
                  >
                    ثبت نتیجه ✅
                  </button>
                  <button
                    type="button"
                    onClick={clearDemoEvents}
                    className="border px-4 rounded-xl font-bold text-xs"
                  >
                    🧹 حذف دادههای نمونه
                  </button>
                </div>
              </form>
            </div>

            {/* دفترچهٔ نتایج + تاریخچه + پیام تلگرام */}
            <div className="grid lg:grid-cols-2 gap-4">
              <div className="bg-white border rounded-3xl p-5">
                <h3 className="font-black">🧾 دفترچهٔ نتایج ({fa(lbEvents.length)})</h3>
                <div className="space-y-2 mt-3 max-h-80 overflow-y-auto">
                  {lbEvents.map((e) => (
                    <div
                      key={e.id}
                      className="flex justify-between items-center gap-2 border rounded-2xl px-3 py-2 text-xs"
                    >
                      <div className="min-w-0">
                        <b className="block truncate">{e.agentName}</b>
                        <span className="text-slate-500">
                          {e.projectTitle || e.note || e.source} • {fa(e.durationMinutes)} دقیقه
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span
                          className={`px-2 py-0.5 rounded-full font-bold ${
                            e.outcome === "success"
                              ? "bg-emerald-100 text-emerald-700"
                              : e.outcome === "failure"
                              ? "bg-red-100 text-red-600"
                              : "bg-amber-100 text-amber-700"
                          }`}
                        >
                          {e.outcome === "success"
                            ? "✅ موفق"
                            : e.outcome === "failure"
                            ? "❌ شکست"
                            : "⚠️ خطا"}
                        </span>
                        <b className={e.points >= 0 ? "text-emerald-600" : "text-red-600"}>
                          {e.points > 0 ? "+" : ""}
                          {fa(e.points)}
                        </b>
                        <button
                          onClick={() => deleteLeagueEvent(e.id)}
                          className="text-red-500"
                          title="حذف نتیجه"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  ))}
                  {lbEvents.length === 0 && (
                    <p className="text-slate-400 text-sm text-center py-6">
                      نتیجهای در این دوره ثبت نشده است
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-4">
                <div className="bg-white border rounded-3xl p-5">
                  <h3 className="font-black">📅 تاریخچهٔ کارمندان برتر</h3>
                  <div className="space-y-2 mt-3">
                    {lbAwards.map((a) => (
                      <div
                        key={a.id}
                        className="border rounded-2xl p-3 flex flex-wrap justify-between items-center gap-2 text-xs"
                      >
                        <div>
                          <b>
                            🏆 {a.avatar} {a.agentName}
                          </b>
                          <p className="text-slate-500 mt-0.5">
                            {persianMonth(a.period)} • {fa(a.score)} امتیاز •{" "}
                            {fa(a.successRate)}٪ موفق • {fa(a.revenueUsdt)} USDT
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2 py-0.5 rounded-full font-bold ${
                              a.telegramSent
                                ? "bg-emerald-100 text-emerald-700"
                                : "bg-slate-100 text-slate-600"
                            }`}
                          >
                            {a.telegramSent ? "📩 ارسال شد" : "📝 اعلام نشده"}
                          </span>
                          <button
                            onClick={() => closeLeagueMonth(true, a.period)}
                            className="border rounded-full px-2 py-1 font-bold"
                          >
                            ارسال مجدد
                          </button>
                        </div>
                      </div>
                    ))}
                    {lbAwards.length === 0 && (
                      <p className="text-slate-400 text-sm text-center py-4">
                        هنوز دورهای بسته نشده است
                      </p>
                    )}
                  </div>
                </div>

                <div className="bg-white border rounded-3xl p-5">
                  <h3 className="font-black">📩 گزارش ماهانهٔ تلگرام</h3>
                  {leaguePreview ? (
                    <>
                      <pre className="bg-slate-50 border rounded-2xl p-3 mt-3 text-xs whitespace-pre-wrap leading-6 max-h-72 overflow-y-auto">
                        {leaguePreview}
                      </pre>
                      <button
                        onClick={() => copyText(leaguePreview, "پیام کپی شد ✅")}
                        className="border px-4 py-2 rounded-xl font-bold text-xs mt-2"
                      >
                        📋 کپی پیام
                      </button>
                    </>
                  ) : (
                    <p className="text-sm text-slate-400 mt-3 leading-7">
                      دکمهٔ «پیشنمایش تلگرام» را بزنید تا متن پیام «کارمند برتر ماه»
                      بدون ارسال یا تغییر در دیتابیس ساخته شود.
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* توضیح روششناسی */}
            <div className="bg-[#0B1220] text-white rounded-3xl p-5 text-xs leading-7">
              <h3 className="font-black text-base">🧠 چرا این رقابت عادلانه و مهندسیشده است؟</h3>
              <ul className="list-disc pr-5 mt-2 space-y-1 text-slate-300">
                <li>
                  <b>کیفیت بر کمیت:</b> ۶۰٪ وزن روی نرخ موفقیت است و هموارسازی لاپلاس{" "}
                  <span dir="ltr">(s+1)/(n+2)</span> جلوی صدرنشینی با یک پروژهٔ موفق را میگیرد؛
                  ایجنت یاد میگیرد شتابزده پیشنهاد ندهد.
                </li>
                <li>
                  <b>درآمد واقعی:</b> ۳۰٪ وزن فقط از تراکنشهای تأییدشدهٔ{" "}
                  <span dir="ltr">transactions</span> خوانده میشود، پس ثبت نتیجه و واریز سود
                  دوبار شمرده نمیشود.
                </li>
                <li>
                  <b>سرعت و دقت:</b> ۱۰٪ وزن از میانگین زمان «پیشنهاد ← تأیید نهایی»
                  پروژههای موفق (بدون خطای اجرایی) بهدست میآید.
                </li>
                <li>
                  <b>جلوگیری از تقلب:</b> کلید <span dir="ltr">source_ref</span> باعث میشود
                  تأیید تکراری یک تسک از پنل یا تلگرام فقط یک بار امتیاز بدهد.
                </li>
                <li>
                  <b>کاهش خطاهای تکراری:</b> ایجنت با کمتر از ۶۰٪ موفقیت (حداقل ۳ پروژه)
                  بهصورت خودکار در لاگها «⚠️ نیازمند بازبینی پرامپت» علامت میخورد.
                </li>
                <li>
                  <b>اتوماسیون:</b> Vercel Cron اول هر ماه{" "}
                  <span dir="ltr">/api/leaderboard/cron</span> را صدا میزند، برنده را ذخیره،
                  پاداش دورهٔ بعد را فعال و گزارش را به تلگرام میفرستد.
                </li>
              </ul>
            </div>
          </section>
        )}

        {/* ==================== ۲. ناوگان ایجنت‌ها و کارمند رمزارز ==================== */}
        {view === "agents" && (
          <section className="mt-4 space-y-5">
            {/* پنل اختصاصی کارمند رمزارز */}
            {cryptoEmployee && (
              <div className="bg-gradient-to-l from-[#0B1220] to-[#132238] text-white rounded-3xl p-6 shadow-lg">
                <div className="flex flex-wrap justify-between items-start gap-4">
                  <div>
                    <span className="bg-amber-400 text-black text-xs font-black px-3 py-1 rounded-full">
                      کارمند تخصصی رمزارز و بلاک‌چین
                    </span>
                    <h2 className="text-2xl font-black mt-3">
                      {cryptoEmployee.avatar} {cryptoEmployee.name}
                    </h2>
                    <p className="text-slate-300 text-sm mt-1">
                      {cryptoEmployee.strategy}
                    </p>
                  </div>
                  <div className="bg-white/10 rounded-2xl p-4 text-left">
                    <p className="text-xs text-slate-300">
                      مجموع واریزی به کیف پول واحد
                    </p>
                    <p className="text-2xl font-black text-emerald-400 mt-1">
                      {fa(cryptoEmployee.earnedUsdt)} USDT
                    </p>
                    <p className="text-xs text-slate-400">
                      {fa(cryptoEmployee.tasksCompleted)} مأموریت موفق
                    </p>
                  </div>
                </div>

                <div className="grid md:grid-cols-4 gap-3 mt-5">
                  <div className="md:col-span-2">
                    <label className="text-xs text-slate-300 block mb-1">
                      انتخاب مأموریت کارمند رمزارز:
                    </label>
                    <select
                      value={cryptoStrategy}
                      onChange={(e) => setCryptoStrategy(e.target.value)}
                      className="w-full bg-white text-slate-900 rounded-xl p-3 text-sm font-bold"
                    >
                      <option value="arbitrage">
                        ⚡ آربیتراژ صرافی‌ها (DEX/CEX Spread)
                      </option>
                      <option value="whale_alert">
                        🐋 رصد نهنگ‌ها و فروش سیگنال آن‌چین
                      </option>
                      <option value="airdrop">
                        🪂 شکار ایردراپ و پاداش تست‌نت
                      </option>
                      <option value="signal_fee">
                        📈 کارمزد عملکرد ربات کپی‌ترید
                      </option>
                    </select>
                  </div>

                  <div>
                    <label className="text-xs text-slate-300 block mb-1">
                      سود خالص (اختیاری - USDT):
                    </label>
                    <input
                      type="number"
                      value={cryptoCustomAmount}
                      onChange={(e) => setCryptoCustomAmount(e.target.value)}
                      placeholder="محاسبه هوشمند خودکار"
                      className="w-full bg-white text-slate-900 rounded-xl p-3 text-sm"
                    />
                  </div>

                  <div className="flex items-end">
                    <button
                      onClick={() =>
                        executeAgentPayout(cryptoEmployee, {
                          strategy: cryptoStrategy,
                          amountUsdt: cryptoCustomAmount
                            ? Number(cryptoCustomAmount)
                            : undefined,
                        })
                      }
                      disabled={runningAgentId === cryptoEmployee.id}
                      className="w-full bg-emerald-500 hover:bg-emerald-400 text-black font-black py-3 px-4 rounded-xl text-sm transition"
                    >
                      {runningAgentId === cryptoEmployee.id
                        ? "⏳ در حال اجرا..."
                        : "⚡ اجرا و واریز به کیف پول واحد"}
                    </button>
                  </div>
                </div>

                {cryptoReport && (
                  <pre className="bg-black/40 border border-emerald-400/30 rounded-2xl p-4 mt-4 text-xs text-emerald-200 whitespace-pre-wrap leading-6">
                    {cryptoReport}
                  </pre>
                )}
              </div>
            )}

            {/* فرم تنظیم کیف پول واحد + فرم استخدام کارمند / ساخت API جدید */}
            <div className="grid lg:grid-cols-2 gap-4">
              <form
                onSubmit={saveMasterWallet}
                className="bg-white border rounded-3xl p-5"
              >
                <h3 className="font-black text-lg">
                  💳 تنظیم کیف پول واحد (مقصد واریز همه ایجنت‌ها)
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  هر ایجنتی که درآمد کسب کند، به‌صورت خودکار به این کیف پول واریز
                  می‌کند.
                </p>
                <div className="space-y-3 mt-4">
                  <div>
                    <label className="text-xs font-bold text-slate-600">
                      آدرس کیف پول واحد (USDT / TON / EVM)
                    </label>
                    <input
                      required
                      value={walletForm.address}
                      onChange={(e) =>
                        setWalletForm({ ...walletForm, address: e.target.value })
                      }
                      className="w-full border rounded-xl p-3 mt-1 font-mono text-sm"
                      dir="ltr"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-bold text-slate-600">
                        شبکه واریز
                      </label>
                      <select
                        value={walletForm.network}
                        onChange={(e) =>
                          setWalletForm({
                            ...walletForm,
                            network: e.target.value,
                          })
                        }
                        className="w-full border rounded-xl p-3 mt-1 text-sm"
                      >
                        <option value="USDT-TRC20">USDT-TRC20 (ترون)</option>
                        <option value="USDT-TON">USDT-TON (تون)</option>
                        <option value="USDT-BEP20">USDT-BEP20 (بایننس)</option>
                        <option value="USDT-ERC20">USDT-ERC20 (اتریوم)</option>
                        <option value="USDC-SOL">USDC-SOL (سولانا)</option>
                      </select>
                    </div>
                    <div className="flex items-end">
                      <button className="w-full bg-slate-900 hover:bg-emerald-600 text-white font-bold py-3 rounded-xl text-sm transition">
                        ذخیره کیف پول واحد ✅
                      </button>
                    </div>
                  </div>
                </div>
              </form>

              <form
                onSubmit={createNewAgent}
                className="bg-white border rounded-3xl p-5"
              >
                <h3 className="font-black text-lg">
                  ➕ استخدام کارمند جدید / ساخت API ایجنت
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  ایجنت جدید با کلید API اختصاصی ساخته و به کیف پول واحد متصل
                  می‌شود.
                </p>
                <div className="grid grid-cols-2 gap-2 mt-4">
                  <input
                    required
                    value={newAgent.name}
                    onChange={(e) =>
                      setNewAgent({ ...newAgent, name: e.target.value })
                    }
                    placeholder="نام ایجنت (مثلاً: ربات ترید سولانا)"
                    className="border rounded-xl p-2.5 text-sm col-span-2"
                  />
                  <input
                    value={newAgent.role}
                    onChange={(e) =>
                      setNewAgent({ ...newAgent, role: e.target.value })
                    }
                    placeholder="نقش (مثلاً: شکارچی آربیتراژ DEX)"
                    className="border rounded-xl p-2.5 text-sm"
                  />
                  <select
                    value={newAgent.specialty}
                    onChange={(e) =>
                      setNewAgent({ ...newAgent, specialty: e.target.value })
                    }
                    className="border rounded-xl p-2.5 text-sm"
                  >
                    <option value="crypto">🪙 کارمند رمزارز / ترید</option>
                    <option value="custom_api">🔌 وب‌هوک / API خارجی</option>
                    <option value="freelance">⚛️ پروژه فنی / کدنویسی</option>
                    <option value="bot">🤖 ایجنت فروش تلگرام</option>
                    <option value="content">📊 محتوا و ترجمه</option>
                  </select>
                  <input
                    value={newAgent.strategy}
                    onChange={(e) =>
                      setNewAgent({ ...newAgent, strategy: e.target.value })
                    }
                    placeholder="استراتژی درآمدزایی..."
                    className="border rounded-xl p-2.5 text-sm col-span-2"
                  />
                </div>
                <button className="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-2.5 rounded-xl mt-3 text-sm">
                  ساخت ایجنت و تولید کلید API ⚡
                </button>
              </form>
            </div>

            {/* کارت‌های ناوگان ایجنت‌ها */}
            <div>
              <h3 className="font-black text-lg mb-3">
                🤖 ناوگان ایجنت‌های متصل به کیف پول واحد ({fa(agentsList.length)})
              </h3>
              <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
                {agentsList.map((ag) => (
                  <article
                    key={ag.id}
                    className="bg-white border rounded-3xl p-5 flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex justify-between items-center gap-2">
                        <span
                          className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                            specialtyMap[ag.specialty]?.[1] ||
                            "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {specialtyMap[ag.specialty]?.[0] || ag.specialty}
                        </span>
                        <button
                          onClick={() => toggleAgentStatus(ag)}
                          className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                            ag.status === "active"
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-slate-100 text-slate-500"
                          }`}
                        >
                          {ag.status === "active" ? "● فعال" : "⏸ متوقف"}
                        </button>
                      </div>

                      <h4 className="font-black text-lg mt-3">
                        {ag.avatar} {ag.name}
                      </h4>
                      <p className="text-xs text-slate-500 mt-1">{ag.role}</p>
                      <p className="text-xs text-slate-600 mt-2 line-clamp-2">
                        {ag.strategy}
                      </p>

                      <div className="bg-slate-50 rounded-2xl p-3 mt-3 flex justify-between items-center">
                        <div>
                          <p className="text-[11px] text-slate-400">
                            درآمد واریزشده
                          </p>
                          <p className="text-lg font-black text-emerald-600">
                            {fa(ag.earnedUsdt)} USDT
                          </p>
                        </div>
                        <div className="text-left">
                          <p className="text-[11px] text-slate-400">مأموریت‌ها</p>
                          <p className="font-black">{fa(ag.tasksCompleted)}</p>
                        </div>
                      </div>

                      <div
                        onClick={() =>
                          copyText(
                            ag.apiKey,
                            `کلید API ایجنت «${ag.name}» کپی شد 🔑`
                          )
                        }
                        className="mt-2 bg-slate-100 hover:bg-slate-200 cursor-pointer rounded-xl px-3 py-1.5 text-[11px] font-mono flex justify-between items-center"
                        dir="ltr"
                      >
                        <span className="truncate">{ag.apiKey}</span>
                        <span className="text-emerald-700 font-bold ml-2">
                          Copy Key
                        </span>
                      </div>
                    </div>

                    <div className="flex gap-2 mt-4">
                      <button
                        onClick={() => executeAgentPayout(ag)}
                        disabled={runningAgentId === ag.id}
                        className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-2 rounded-xl text-xs"
                      >
                        {runningAgentId === ag.id
                          ? "⏳ اجرا..."
                          : "⚡ اجرای مأموریت (+USDT)"}
                      </button>
                      <button
                        onClick={() => setSelectedApiAgent(ag)}
                        className="px-3 bg-slate-900 text-white rounded-xl text-xs font-bold"
                      >
                        🔌 API
                      </button>
                      <button
                        onClick={() => deleteAgent(ag.id)}
                        className="px-2.5 bg-red-50 text-red-600 rounded-xl text-xs"
                      >
                        🗑️
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </div>

            {/* راهنمای زنده API اتصال ایجنت خارجی */}
            <div className="bg-slate-900 text-white rounded-3xl p-6">
              <div className="flex flex-wrap justify-between items-center gap-2">
                <div>
                  <h3 className="font-black text-lg">
                    🔌 اندپوینت اتصال ایجنت‌های خارجی به کیف پول واحد
                  </h3>
                  <p className="text-xs text-slate-300 mt-1">
                    هر ربات پایتون، TradingView، n8n یا سرویس خارجی می‌تواند با
                    این API سود خود را مستقیم به کیف پول واحد شما واریز کند.
                  </p>
                </div>
                <span
                  className="bg-emerald-500 text-black px-3 py-1 rounded-full text-xs font-mono font-bold"
                  dir="ltr"
                >
                  POST {originUrl}/api/agents/ingest
                </span>
              </div>

              <pre
                className="bg-black/50 border border-white/10 rounded-2xl p-4 mt-4 text-xs text-emerald-300 overflow-x-auto"
                dir="ltr"
              >{`curl -X POST ${originUrl}/api/agents/ingest \\
  -H "Content-Type: application/json" \\
  -H "x-agent-key: ${
    selectedApiAgent?.apiKey ||
    cryptoEmployee?.apiKey ||
    "ag_live_crypto_arya_9821"
  }" \\
  -d '{
    "amountUsdt": 75,
    "title": "سود ربات آربیتراژ / سیگنال کریپتو",
    "strategy": "arbitrage"
  }'`}</pre>
            </div>
          </section>
        )}

        {/* ==================== ۳. پروژه‌ها (CRUD) ==================== */}
        {view === "projects" && (
          <section className="mt-4">
            <div className="flex flex-wrap gap-2">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="🔍 جستجو پروژه، مشتری، تلگرام..."
                className="bg-white border rounded-full px-4 py-2 flex-1 min-w-[200px]"
              />
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="bg-white border rounded-full px-3 py-2"
              >
                <option value="all">همه وضعیت‌ها</option>
                {Object.entries(statusMap).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v[0]}
                  </option>
                ))}
              </select>
              <button
                onClick={() => {
                  setEdit(null);
                  setForm({
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
                    wallet: walletForm.address,
                  });
                  setShowForm(true);
                }}
                className="bg-emerald-500 text-white px-5 py-2 rounded-full font-bold"
              >
                + پروژه جدید
              </button>
            </div>

            {filtered.length === 0 ? (
              <div className="bg-white rounded-3xl border p-12 text-center mt-4">
                <div className="text-5xl">📭</div>
                <p className="font-bold mt-3">پروژه‌ای پیدا نشد</p>
                <p className="text-slate-400 text-sm">
                  فیلتر را عوض کنید یا پروژه جدید بسازید
                </p>
              </div>
            ) : (
              <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4 mt-4">
                {filtered.map((p) => {
                  const pct = p.budgetUsdt
                    ? Math.round((p.receivedUsdt / p.budgetUsdt) * 100)
                    : 0;
                  return (
                    <article key={p.id} className="bg-white rounded-3xl border p-5">
                      <div className="flex justify-between">
                        <span
                          className={`px-2 py-1 rounded-full text-xs font-bold ${
                            statusMap[p.status]?.[1]
                          }`}
                        >
                          {statusMap[p.status]?.[0]}
                        </span>
                        <span className="text-xs bg-slate-100 px-2 py-1 rounded-full">
                          {typeMap[p.type]}
                        </span>
                      </div>
                      <h3 className="font-black mt-3 leading-7">{p.title}</h3>
                      <p className="text-sm text-slate-500">
                        {p.clientName} •{" "}
                        <span dir="ltr">{p.telegramUser}</span>
                      </p>
                      <p className="text-sm text-slate-600 mt-2 line-clamp-2">
                        {p.description}
                      </p>
                      <div className="mt-3">
                        <div className="flex justify-between text-sm">
                          <span>
                            💰 {fa(p.receivedUsdt)} / {fa(p.budgetUsdt)} USDT
                          </span>
                          <b>{fa(pct)}٪</b>
                        </div>
                        <div className="h-2 bg-slate-100 rounded-full mt-1">
                          <div
                            className="h-full bg-emerald-500 rounded-full"
                            style={{ width: pct + "%" }}
                          ></div>
                        </div>
                      </div>
                      <p className="text-xs text-slate-400 mt-2">
                        📅 ددلاین: {p.deadline || "—"} • منبع: {p.source}
                      </p>
                      <div className="flex gap-2 mt-4">
                        <button
                          onClick={() => {
                            setEdit(p);
                            setForm(p);
                            setShowForm(true);
                          }}
                          className="flex-1 bg-slate-900 text-white py-2 rounded-xl text-sm font-bold"
                        >
                          ویرایش
                        </button>
                        <button
                          onClick={() => {
                            const ns = prompt(
                              "وضعیت جدید: new, negotiating, approved, in_progress, delivered, paid",
                              p.status
                            );
                            if (ns) {
                              fetch("/api/projects", {
                                method: "PUT",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ ...p, status: ns }),
                              }).then(() => load());
                            }
                          }}
                          className="flex-1 bg-amber-100 text-amber-800 py-2 rounded-xl text-sm font-bold"
                        >
                          تغییر وضعیت
                        </button>
                        <button
                          onClick={() => delProject(p.id)}
                          className="px-3 bg-red-50 text-red-600 rounded-xl"
                        >
                          🗑️
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* ==================== ۴. گفتگوها ==================== */}
        {view === "chats" && (
          <section className="grid lg:grid-cols-3 gap-4 mt-4">
            <div className="bg-white rounded-3xl border p-4">
              <h3 className="font-black mb-3">گفتگوها</h3>
              {chatList.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setChatUser(c.clientName)}
                  className={`w-full text-right p-3 rounded-2xl mb-1 ${
                    chatUser === c.clientName
                      ? "bg-emerald-50 border border-emerald-200"
                      : "hover:bg-slate-50"
                  }`}
                >
                  <b>{c.clientName}</b>
                  {c.status === "unread" && (
                    <span className="bg-red-500 text-white text-[10px] px-2 rounded-full float-left">
                      جدید
                    </span>
                  )}
                  <p className="text-xs text-slate-400">
                    {c.username} • تلگرام
                  </p>
                </button>
              ))}
            </div>

            <div className="lg:col-span-2 bg-white rounded-3xl border p-4 flex flex-col min-h-[520px]">
              <h3 className="font-black">
                {chatUser}{" "}
                <span className="text-emerald-500 text-sm">
                  ● آنلاین از تلگرام
                </span>
              </h3>
              <div className="flex-1 space-y-3 mt-4 overflow-y-auto">
                {chatMsgs.map((m) => (
                  <div
                    key={m.id}
                    className={`max-w-[80%] p-3 rounded-2xl text-sm ${
                      m.direction === "out"
                        ? "bg-emerald-500 text-white mr-auto rounded-bl-md"
                        : "bg-slate-100 ml-auto rounded-br-md"
                    }`}
                  >
                    {m.text}
                    <p
                      className={`text-[10px] mt-1 ${
                        m.direction === "out"
                          ? "text-emerald-100"
                          : "text-slate-400"
                      }`}
                    >
                      {m.direction === "out"
                        ? "شما • از پنل"
                        : "تلگرام • Webhook"}
                    </p>
                  </div>
                ))}
                {chatMsgs.length === 0 && (
                  <p className="text-center text-slate-400">
                    پیامی نیست — اولین پیام را بفرستید
                  </p>
                )}
              </div>
              <div className="flex gap-2 mt-4">
                <input
                  value={chatText}
                  onChange={(e) => setChatText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && sendChat()}
                  placeholder="پیام به مشتری از طریق ربات..."
                  className="flex-1 border rounded-full px-4 py-3"
                />
                <button
                  onClick={sendChat}
                  className="bg-emerald-500 text-white px-6 rounded-full font-bold"
                >
                  ارسال 📩
                </button>
              </div>
            </div>
          </section>
        )}

        {/* ==================== ۵. تأیید انسانی ==================== */}
        {view === "approvals" && (
          <section className="mt-4 space-y-3">
            {tasks.map((t) => (
              <div key={t.id} className="bg-white rounded-3xl border p-5">
                <div className="flex flex-wrap justify-between gap-2">
                  <b>{t.title}</b>
                  <span
                    className={`px-2 py-1 rounded-full text-xs font-bold ${
                      t.status === "pending"
                        ? "bg-amber-100 text-amber-700"
                        : t.status === "approved"
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-red-100 text-red-600"
                    }`}
                  >
                    {t.status === "pending"
                      ? "⏳ منتظر تأیید شما"
                      : t.status === "approved"
                      ? "✅ تأیید شده"
                      : "❌ رد شده"}
                  </span>
                </div>
                <p className="text-sm text-slate-500 mt-1">
                  {t.agent} • {t.projectTitle} • ریسک:{" "}
                  {t.risk === "high"
                    ? "🔴 بالا"
                    : t.risk === "low"
                    ? "🟢 کم"
                    : "🟡 متوسط"}
                </p>
                <p className="text-sm mt-2">{t.description}</p>
                {t.payload && (
                  <pre className="bg-slate-50 border rounded-2xl p-3 text-xs whitespace-pre-wrap mt-3">
                    {t.payload}
                  </pre>
                )}
                {t.status === "pending" && (
                  <div className="flex gap-2 mt-4 flex-wrap">
                    <button
                      onClick={() => actTask(t, "approved")}
                      className="bg-emerald-500 text-white px-5 py-2 rounded-full font-bold"
                    >
                      ✅ تأیید و اجرا
                    </button>
                    <button
                      onClick={() => actTask(t, "rejected")}
                      className="bg-red-500 text-white px-5 py-2 rounded-full font-bold"
                    >
                      ❌ رد
                    </button>
                    <button
                      onClick={() => {
                        const v = prompt("ویرایش متن ایجنت:", t.payload);
                        if (v) {
                          setTasks((prev) =>
                            prev.map((x) =>
                              x.id === t.id ? { ...x, payload: v } : x
                            )
                          );
                          notify("متن ویرایش شد ✏️");
                        }
                      }}
                      className="border px-5 py-2 rounded-full font-bold"
                    >
                      ✏️ ویرایش قبل از تأیید
                    </button>
                  </div>
                )}
              </div>
            ))}
          </section>
        )}

        {/* ==================== ۶. کیف پول واحد و درآمد USDT ==================== */}
        {view === "earnings" && (
          <section className="mt-4">
            <div className="bg-[#0B1220] text-white rounded-3xl p-5 mb-4 flex flex-wrap justify-between items-center gap-3">
              <div>
                <p className="text-xs text-emerald-300 font-bold">
                  💳 مقصد تجمیع تمام واریزی‌ها (کیف پول واحد)
                </p>
                <p className="font-mono text-sm md:text-base mt-1" dir="ltr">
                  {walletForm.address} ({walletForm.network})
                </p>
              </div>
              <button
                onClick={() => setView("agents")}
                className="bg-emerald-500 text-black px-4 py-2 rounded-xl text-xs font-bold"
              >
                تغییر آدرس کیف پول واحد
              </button>
            </div>

            <div className="grid grid-cols-3 gap-4">
              {[
                ["کل واریزی به کیف پول واحد", fa(stats?.income)],
                ["درآمد ناوگان ایجنت‌ها", fa(totalFleetEarned)],
                ["در انتظار وصول پروژه‌ها", fa(stats?.pendingAmount)],
              ].map(([l, v]) => (
                <div
                  key={l}
                  className="bg-white border rounded-3xl p-5 text-center"
                >
                  <p className="text-slate-500 text-sm">{l}</p>
                  <p className="text-2xl font-black text-emerald-600 mt-1">
                    {v} USDT
                  </p>
                </div>
              ))}
            </div>

            <form
              onSubmit={addTx}
              className="bg-white border rounded-3xl p-4 mt-4 grid md:grid-cols-5 gap-2"
            >
              <input
                required
                value={txForm.title}
                onChange={(e) =>
                  setTxForm({ ...txForm, title: e.target.value })
                }
                placeholder="عنوان تراکنش"
                className="border rounded-xl p-2"
              />
              <input
                value={txForm.agentName}
                onChange={(e) =>
                  setTxForm({ ...txForm, agentName: e.target.value })
                }
                placeholder="نام ایجنت واریزکننده"
                className="border rounded-xl p-2"
              />
              <input
                required
                type="number"
                value={txForm.amountUsdt}
                onChange={(e) =>
                  setTxForm({ ...txForm, amountUsdt: e.target.value })
                }
                placeholder="مبلغ USDT"
                className="border rounded-xl p-2"
              />
              <select
                value={txForm.network}
                onChange={(e) =>
                  setTxForm({ ...txForm, network: e.target.value })
                }
                className="border rounded-xl p-2"
              >
                <option>TRC20</option>
                <option>TON</option>
                <option>BEP20</option>
                <option>ERC20</option>
              </select>
              <button className="bg-emerald-500 text-white rounded-xl font-bold">
                + ثبت واریزی
              </button>
            </form>

            <div className="bg-white border rounded-3xl mt-4 overflow-hidden">
              {txs.map((t) => (
                <div
                  key={t.id}
                  className="flex flex-wrap justify-between items-center gap-2 p-4 border-b last:border-0"
                >
                  <div>
                    <b>{t.title}</b>
                    <p className="text-xs text-slate-500 mt-0.5">
                      🤖 واریز از:{" "}
                      <span className="font-bold text-slate-700">
                        {t.agentName || "سیستم مرکزی"}
                      </span>{" "}
                      ← مقصد:{" "}
                      <span dir="ltr" className="font-mono">
                        {(t.destinationWallet || walletForm.address).slice(
                          0,
                          12
                        )}
                        ...
                      </span>{" "}
                      • {t.network} • <span dir="ltr">{t.txHash}</span>
                    </p>
                  </div>
                  <div className="text-left">
                    <b
                      className={
                        t.amountUsdt >= 0
                          ? "text-emerald-600"
                          : "text-red-500"
                      }
                    >
                      {t.amountUsdt >= 0 ? "+" : ""}
                      {fa(t.amountUsdt)} USDT
                    </b>
                    <p className="text-xs">
                      {t.status === "confirmed"
                        ? "✅ تأیید شبکه"
                        : "⏳ در انتظار"}
                    </p>
                  </div>
                  <button
                    onClick={async () => {
                      setTxs((prev) => prev.filter((x) => x.id !== t.id));
                      await fetch(
                        `/api/rest?type=transactions&id=${t.id}`,
                        { method: "DELETE" }
                      );
                    }}
                    className="text-red-500"
                  >
                    🗑️
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ==================== ۷. ابزارهای خودکار ==================== */}
        {view === "tools" && (
          <section className="mt-4">
            <div className="bg-white border rounded-3xl p-5">
              <input
                value={toolInput}
                onChange={(e) => setToolInput(e.target.value)}
                placeholder="موضوع پروژه / متن..."
                className="w-full border rounded-2xl p-3"
              />
              <div className="grid md:grid-cols-3 gap-3 mt-4">
                {[
                  ["⚛️ سازنده Next.js", "Next.js"],
                  ["📊 سازنده PPTX", "PPT"],
                  ["🌐 مترجم FA→EN", "مترجم"],
                ].map(([l, k]) => (
                  <button
                    key={k}
                    onClick={() => runTool(k)}
                    className="bg-[#0B1220] text-white rounded-2xl p-5 font-bold hover:bg-emerald-600"
                  >
                    {l}
                    <p className="text-xs font-normal text-slate-300 mt-1">
                      اجرای خودکار توسط ایجنت
                    </p>
                  </button>
                ))}
              </div>
              {toolOut && (
                <pre className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 whitespace-pre-wrap text-sm mt-4">
                  {toolOut}
                </pre>
              )}
            </div>
            <h3 className="font-black mt-6 mb-3">اجراهای اخیر</h3>
            {tools.map((t) => (
              <div key={t.id} className="bg-white border rounded-2xl p-4 mb-2">
                <b>{t.tool}</b>
                <p className="text-sm text-slate-500">{t.input}</p>
                <p className="text-sm mt-1 whitespace-pre-wrap">{t.output}</p>
              </div>
            ))}
          </section>
        )}

        {/* ==================== ۸. تلگرام و Webhook ==================== */}
        {view === "telegram" && (
          <section className="grid lg:grid-cols-2 gap-4 mt-4">
            <div className="bg-white border rounded-3xl p-6">
              <h3 className="font-black text-lg">📩 ربات تلگرام</h3>
              <div className="space-y-3 mt-4 text-sm">
                <p>
                  🤖 ربات: <b dir="ltr">@FreelanceAgentBot</b>{" "}
                  <span className="text-emerald-600">● متصل</span>
                </p>
                <p>
                  🔗 Webhook:{" "}
                  <span
                    dir="ltr"
                    className="bg-slate-100 px-2 py-1 rounded text-xs"
                  >
                    {originUrl}/api/telegram/webhook
                  </span>
                </p>
                <p>
                  💳 کیف پول واحد:{" "}
                  <span dir="ltr">
                    {walletForm.address} ({walletForm.network})
                  </span>
                </p>
              </div>
              <div className="flex gap-2 mt-5 flex-wrap">
                <button
                  onClick={simulateWebhook}
                  className="bg-[#229ED9] text-white px-5 py-2 rounded-full font-bold"
                >
                  شبیه‌سازی پیام جدید
                </button>
                <button
                  onClick={async () => {
                    await fetch("/api/telegram/webhook", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        callback_query: {
                          data: "approve:1",
                          from: { username: "admin" },
                        },
                      }),
                    });
                    notify("Callback تلگرام تست شد ✅");
                    load();
                  }}
                  className="border px-5 py-2 rounded-full font-bold"
                >
                  تست Inline Button
                </button>
              </div>
            </div>

            <div className="bg-white border rounded-3xl p-6">
              <h3 className="font-black">تنظیمات اتوماسیون</h3>
              {[
                ["واریز خودکار سود همه ایجنت‌ها به کیف پول واحد", true],
                ["نیاز به تأیید انسانی برای ارسال فاکتور", true],
                ["همگام‌سازی زنده پیام‌های تلگرام با Webhook", true],
                ["هشدار تراکنش USDT در تلگرام", true],
              ].map(([l, v]: any) => (
                <div
                  key={l}
                  className="flex justify-between py-3 border-b last:border-0"
                >
                  <span className="text-sm font-bold">{l}</span>
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-bold ${
                      v
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {v ? "فعال" : "غیرفعال"}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ==================== ۹. آمادگی استقرار GitHub + Supabase + Vercel ==================== */}
        {view === "deploy" && (
          <section className="mt-4 space-y-4">
            <div className="bg-white border rounded-3xl p-6">
              <h3 className="font-black text-xl">
                ☁️ وضعیت اتصال دیتابیس و آمادگی استقرار ابری
              </h3>
              <div className="grid md:grid-cols-4 gap-3 mt-4">
                {[
                  [
                    "دیتابیس PostgreSQL / Supabase",
                    walletInfo?.deployment?.databaseConnected
                      ? "✅ متصل و فعال"
                      : "⏳ در حال بررسی",
                  ],
                  [
                    "محیط اجرا (Vercel / Local)",
                    walletInfo?.deployment?.isVercel
                      ? "🚀 Vercel Production"
                      : "💻 Local Ready",
                  ],
                  [
                    "نوع دیتابیس",
                    walletInfo?.deployment?.isSupabaseUrl
                      ? "⚡ Supabase Cloud"
                      : "🐘 PostgreSQL (سازگار با Supabase)",
                  ],
                  [
                    "ربات تلگرام واقعی",
                    walletInfo?.deployment?.telegramConfigured
                      ? "✅ توکن متصل است"
                      : "🧪 حالت شبیه‌ساز + آماده توکن",
                  ],
                ].map(([k, v]) => (
                  <div key={k} className="bg-slate-50 border rounded-2xl p-4">
                    <p className="text-xs text-slate-500">{k}</p>
                    <p className="font-black text-sm mt-1">{v}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid lg:grid-cols-3 gap-4">
              <div className="bg-white border rounded-3xl p-5">
                <h4 className="font-black">۱️⃣ آپلود در GitHub</h4>
                <p className="text-xs text-slate-500 mt-1">
                  فایل .gitignore تنظیم شده تا .env و node_modules آپلود نشوند:
                </p>
                <pre
                  className="bg-slate-900 text-emerald-300 rounded-2xl p-3 text-xs mt-3 overflow-x-auto"
                  dir="ltr"
                >{`git init
git add .
git commit -m "Freelance & Crypto Agent OS"
git branch -M main
git remote add origin https://github.com/USER/REPO.git
git push -u origin main`}</pre>
              </div>

              <div className="bg-white border rounded-3xl p-5">
                <h4 className="font-black">۲️⃣ اتصال به Supabase</h4>
                <p className="text-xs text-slate-500 mt-1">
                  فایل آماده <code>supabase/schema.sql</code> را در SQL Editor
                  سوپابیس اجرا کنید یا با Drizzle پوش کنید:
                </p>
                <pre
                  className="bg-slate-900 text-emerald-300 rounded-2xl p-3 text-xs mt-3 overflow-x-auto"
                  dir="ltr"
                >{`# در .env یا Vercel:
DATABASE_URL="postgresql://postgres.[REF]:[PASS]@aws-0-[REG].pooler.supabase.com:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://postgres.[REF]:[PASS]@aws-0-[REG].pooler.supabase.com:5432/postgres"

npx drizzle-kit push`}</pre>
              </div>

              <div className="bg-white border rounded-3xl p-5">
                <h4 className="font-black">۳️⃣ دیپلوی در Vercel</h4>
                <p className="text-xs text-slate-500 mt-1">
                  متغیرهای محیطی زیر را مطابق <code>.env.example</code> در
                  تنظیمات پروژه Vercel وارد کنید:
                </p>
                <pre
                  className="bg-slate-900 text-emerald-300 rounded-2xl p-3 text-xs mt-3 overflow-x-auto"
                  dir="ltr"
                >{`DATABASE_URL=...
DIRECT_URL=...
ADMIN_EMAIL=admin@freelance.ir
ADMIN_PASSWORD=your-strong-password
AUTH_SECRET=random-32-char-secret
MASTER_WALLET_ADDRESS=${walletForm.address}
TELEGRAM_BOT_TOKEN=optional`}</pre>
              </div>
            </div>
          </section>
        )}

        {/* ==================== ۱۰. لاگ ایجنت‌ها ==================== */}
        {view === "logs" && (
          <section className="mt-4 space-y-2">
            {logs.map((l) => (
              <div
                key={l.id}
                className="bg-white border rounded-2xl p-4 flex justify-between gap-3"
              >
                <div>
                  <b>{l.agent}</b> — {l.action}
                  <p className="text-sm text-slate-500">{l.detail}</p>
                </div>
                <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-1 rounded-full h-fit">
                  {l.status} • {fa(l.durationMs)}ms
                </span>
              </div>
            ))}
            {logs.length === 0 && (
              <p className="bg-white border rounded-3xl p-10 text-center text-slate-400">
                لاگی نیست
              </p>
            )}
          </section>
        )}
      </main>

      {/* مودال ساخت/ویرایش پروژه */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-3">
          <form
            onSubmit={saveProject}
            className="bg-white w-full max-w-2xl rounded-3xl p-6 max-h-[92vh] overflow-y-auto"
          >
            <h3 className="font-black text-xl">
              {edit ? "ویرایش پروژه" : "پروژه کریپتویی جدید"}
            </h3>
            <div className="grid md:grid-cols-2 gap-3 mt-4">
              <input
                required
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="عنوان پروژه *"
                className="border rounded-xl p-3 md:col-span-2"
              />
              <input
                required
                value={form.clientName}
                onChange={(e) =>
                  setForm({ ...form, clientName: e.target.value })
                }
                placeholder="نام مشتری *"
                className="border rounded-xl p-3"
              />
              <input
                value={form.telegramUser}
                onChange={(e) =>
                  setForm({ ...form, telegramUser: e.target.value })
                }
                placeholder="@telegram"
                className="border rounded-xl p-3"
                dir="ltr"
              />
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
                className="border rounded-xl p-3"
              >
                {Object.entries(typeMap).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                className="border rounded-xl p-3"
              >
                {Object.entries(statusMap).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v[0]}
                  </option>
                ))}
              </select>
              <input
                type="number"
                value={form.budgetUsdt}
                onChange={(e) =>
                  setForm({ ...form, budgetUsdt: e.target.value })
                }
                placeholder="بودجه USDT"
                className="border rounded-xl p-3"
              />
              <input
                type="number"
                value={form.receivedUsdt}
                onChange={(e) =>
                  setForm({ ...form, receivedUsdt: e.target.value })
                }
                placeholder="دریافتی USDT"
                className="border rounded-xl p-3"
              />
              <input
                value={form.deadline}
                onChange={(e) => setForm({ ...form, deadline: e.target.value })}
                placeholder="ددلاین (۱۴۰۵/۰۵/۲۰)"
                className="border rounded-xl p-3"
              />
              <select
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value })}
                className="border rounded-xl p-3"
              >
                <option value="high">🔴 اولویت بالا</option>
                <option value="medium">🟡 متوسط</option>
                <option value="low">🟢 کم</option>
              </select>
              <textarea
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
                placeholder="توضیحات پروژه..."
                className="border rounded-xl p-3 md:col-span-2"
                rows={3}
              />
            </div>
            <div className="flex gap-2 mt-5">
              <button className="flex-1 bg-emerald-500 text-white py-3 rounded-xl font-bold">
                {edit ? "ذخیره تغییرات" : "ساخت پروژه"}
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="px-6 border rounded-xl font-bold"
              >
                انصراف
              </button>
            </div>
          </form>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 bg-slate-900 text-white px-5 py-3 rounded-full shadow-2xl z-[60] font-bold text-sm">
          {toast}
        </div>
      )}
    </div>
  );
}
