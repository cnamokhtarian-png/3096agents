"use client";
import { useEffect, useMemo, useState } from "react";

const fa = (n: any) => Number(n || 0).toLocaleString("fa-IR");

const statusMap: Record<string, [string, string]> = {
  new: ["جدید", "bg-blue-100 text-blue-700"],
  negotiating: ["در مذاکره", "bg-amber-100 text-amber-700"],
  approved: ["تأیید شده", "bg-violet-100 text-violet-700"],
  in_progress: ["در حال انجام", "bg-cyan-100 text-cyan-700"],
  delivered: ["تحویل شده", "bg-indigo-100 text-indigo-700"],
  paid: ["تسویه شده", "bg-emerald-100 text-emerald-700"],
  cancelled: ["لغو", "bg-red-100 text-red-600"],
  pending: ["در انتظار تأیید", "bg-amber-100 text-amber-700"],
  completed: ["تکمیل شد ✅", "bg-emerald-100 text-emerald-700"],
  rejected: ["رد شد", "bg-red-100 text-red-600"],
  confirmed: ["تأیید شد", "bg-emerald-100 text-emerald-700"],
};

const typeMap: Record<string, string> = {
  nextjs: "⚛️ وب‌سایت",
  pptx: "📊 ارائه",
  translation: "🌐 ترجمه",
  bot: "🤖 ربات",
  ai_agent: "🧠 ایجنت AI",
  other: "📦 سایر",
};

const specialtyMap: Record<string, [string, string]> = {
  crypto: ["🪙 رمزارز", "bg-amber-100 text-amber-800"],
  freelance: ["⚛️ فنی", "bg-cyan-100 text-cyan-800"],
  bot: ["💬 فروش", "bg-sky-100 text-sky-800"],
  content: ["📊 محتوا", "bg-violet-100 text-violet-800"],
  custom_api: ["🔌 خارجی", "bg-emerald-100 text-emerald-800"],
};

const NETWORKS = [
  "USDT-BEP20",
  "USDT-ERC20",
  "USDT-Polygon",
  "USDT-Arbitrum",
  "USDT-TRC20",
];

const CHAIN_NAMES: Record<string, [string, string]> = {
  "0x1": ["اتریوم", "USDT-ERC20"],
  "0x38": ["بایننس (BSC)", "USDT-BEP20"],
  "0x89": ["پالیگان", "USDT-Polygon"],
  "0xa4b1": ["آربیتروم", "USDT-Arbitrum"],
};

export default function Control() {
  const [view, setView] = useState("home");
  const [user, setUser] = useState<any>(null);
  const [projects, setProjects] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [msgs, setMsgs] = useState<any[]>([]);
  const [txs, setTxs] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [agentsList, setAgentsList] = useState<any[]>([]);
  const [walletInfo, setWalletInfo] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [setup, setSetup] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");

  // محصول
  const [q, setQ] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [edit, setEdit] = useState<any>(null);
  const [form, setForm] = useState<any>(blankProduct());

  // گفتگو
  const [chatUser, setChatUser] = useState("");
  const [chatText, setChatText] = useState("");

  // ثبت درآمد واقعی هر ایجنت
  const [incForm, setIncForm] = useState<Record<number, any>>({});

  // ایجنت جدید
  const [newAgent, setNewAgent] = useState({ name: "", role: "", specialty: "crypto" });
  const [showAgentForm, setShowAgentForm] = useState(false);

  // کیف پول برداشت
  const [walletForm, setWalletForm] = useState({ address: "", network: "USDT-BEP20" });
  const [mmStatus, setMmStatus] = useState("");

  // برداشت
  const [payoutForm, setPayoutForm] = useState({ amount: "", note: "" });
  const [hashForm, setHashForm] = useState<Record<number, string>>({});

  // تنظیمات
  const [fieldVals, setFieldVals] = useState<Record<string, string>>({});

  function blankProduct() {
    return {
      title: "", clientName: "", telegramUser: "", source: "کاتالوگ خدمات",
      type: "nextjs", status: "new", priority: "medium",
      budgetUsdt: "", receivedUsdt: "", deadline: "", description: "", wallet: "",
    };
  }

  const notify = (t: string) => {
    setToast(t);
    setTimeout(() => setToast(""), 4000);
  };

  const copyText = (txt: string, label = "کپی شد ✅") => {
    if (typeof navigator !== "undefined" && (navigator as any).clipboard) {
      (navigator as any).clipboard.writeText(txt).catch(() => {});
    }
    notify(label);
  };

  async function load() {
    const [p, t, m, tx, l, ag, wl, s, st] = await Promise.all([
      fetch("/api/projects").then((r) => r.json()),
      fetch("/api/rest?type=tasks").then((r) => r.json()),
      fetch("/api/rest?type=messages").then((r) => r.json()),
      fetch("/api/rest?type=transactions").then((r) => r.json()),
      fetch("/api/rest?type=logs").then((r) => r.json()),
      fetch("/api/agents").then((r) => r.json()),
      fetch("/api/wallet").then((r) => r.json()),
      fetch("/api/stats").then((r) => r.json()),
      fetch("/api/settings").then((r) => r.json()).catch(() => null),
    ]);
    setProjects(Array.isArray(p) ? p : []);
    setTasks(Array.isArray(t) ? t : []);
    setMsgs(Array.isArray(m) ? m : []);
    setTxs(Array.isArray(tx) ? tx : []);
    setLogs(Array.isArray(l) ? l : []);
    setAgentsList(Array.isArray(ag?.agents) ? ag.agents : []);
    setWalletInfo(wl);
    if (wl?.masterWallet) {
      setWalletForm({
        address: wl.masterWallet.address || "",
        network: wl.masterWallet.network || "USDT-BEP20",
      });
    }
    setStats(s);
    if (st && !st.error) {
      setSetup(st);
      const vals: Record<string, string> = {};
      (st.fields || []).forEach((f: any) => {
        if (!f.secret) vals[f.key] = f.value || "";
      });
      setFieldVals(vals);
    }
    setLoading(false);
  }

  useEffect(() => {
    fetch("/api/auth/login")
      .then((r) => r.json())
      .then((d) => {
        if (!d.user) location.href = "/login";
        else setUser(d.user);
      });
    load();
    const iv = setInterval(() => {
      fetch("/api/stats").then((r) => r.json()).then(setStats).catch(() => {});
    }, 15000);
    return () => clearInterval(iv);
  }, []);

  const chatList = useMemo(() => {
    const map = new Map();
    msgs.forEach((m) => {
      if (!map.has(m.clientName)) map.set(m.clientName, m);
    });
    return [...map.values()];
  }, [msgs]);

  const chatMsgs = msgs.filter((m) => m.clientName === chatUser).slice().reverse();
  const currentChat = chatList.find((c) => c.clientName === chatUser);
  const isRealChat = currentChat && /^\d{5,}$/.test(String(currentChat.chatId || ""));

  const filtered = projects.filter((p: any) =>
    (p.title + p.clientName + (p.telegramUser || "")).includes(q)
  );

  const payouts = txs.filter((t) => t.kind === "payout");
  const incomes = txs.filter((t) => t.kind !== "payout");
  const pendingTasks = tasks.filter((t) => t.status === "pending");

  // ---------- اکشن‌ها ----------

  async function actTask(t: any, st: string) {
    setTasks((prev) => prev.map((x) => (x.id === t.id ? { ...x, status: st } : x)));
    await fetch("/api/rest", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ _type: "tasks", ...t, status: st }),
    });
    // همگام‌سازی برداشت (اگر تسک برداشت باشد) از مسیر وب‌هوک
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
    notify(st === "approved" ? "تأیید شد ✅" : "رد شد ❌");
    load();
  }

  async function registerIncome(agent: any) {
    const f = incForm[agent.id] || {};
    if (!(Number(f.amount) > 0)) {
      notify("مبلغ واقعی را وارد کنید ⚠️");
      return;
    }
    const res = await fetch("/api/agents/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: agent.id,
        amountUsdt: Number(f.amount),
        title: f.title || `درآمد واقعی از ${agent.name}`,
        txHash: f.txHash || "",
      }),
    });
    const d = await res.json();
    if (d.ok) {
      notify(`+${fa(d.amountUsdt)} USDT ثبت شد ✅`);
      setIncForm((prev) => ({ ...prev, [agent.id]: {} }));
      load();
    } else {
      notify(d.error || "خطا در ثبت");
    }
  }

  async function saveProject(e: any) {
    e.preventDefault();
    const method = edit ? "PUT" : "POST";
    const body = edit ? { ...form, id: edit.id } : form;
    await fetch("/api/projects", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setShowForm(false);
    setEdit(null);
    notify(edit ? "ذخیره شد ✅" : "محصول ساخته شد ✅");
    load();
  }

  async function advanceStatus(p: any) {
    const order = ["new", "in_progress", "delivered", "paid"];
    const next = order[Math.min(order.indexOf(p.status) + 1, order.length - 1)];
    if (next === p.status) return;
    await fetch("/api/projects", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...p, status: next }),
    });
    load();
  }

  async function delProject(id: number) {
    if (!confirm("این محصول حذف شود؟")) return;
    setProjects((prev) => prev.filter((p) => p.id !== id));
    await fetch(`/api/projects?id=${id}`, { method: "DELETE" });
    notify("حذف شد 🗑️");
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
    notify(nextStatus === "active" ? "فعال شد 🟢" : "متوقف شد ⏸️");
  }

  async function deleteAgent(id: number) {
    if (!confirm("این ایجنت حذف شود؟")) return;
    setAgentsList((prev) => prev.filter((a) => a.id !== id));
    await fetch(`/api/agents?id=${id}`, { method: "DELETE" });
    notify("ایجنت حذف شد 🗑️");
  }

  async function createAgent(e: any) {
    e.preventDefault();
    if (!newAgent.name.trim()) return;
    const res = await fetch("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newAgent),
    });
    const created = await res.json();
    setAgentsList((prev) => [created, ...prev]);
    setNewAgent({ name: "", role: "", specialty: "crypto" });
    setShowAgentForm(false);
    notify(`ایجنت «${created.name}» ساخته شد ✅`);
    load();
  }

  async function connectMetaMask() {
    const eth = (window as any).ethereum;
    if (!eth) {
      setMmStatus("متامسک پیدا نشد — آدرس را دستی بچسبانید (Paste).");
      return;
    }
    try {
      const accounts = await eth.request({ method: "eth_requestAccounts" });
      const addr = accounts?.[0] || "";
      const chainId = await eth.request({ method: "eth_chainId" }).catch(() => "");
      const chain = CHAIN_NAMES[chainId];
      setWalletForm((prev) => ({
        address: addr || prev.address,
        network: chain ? chain[1] : prev.network,
      }));
      setMmStatus(
        addr
          ? `متصل شد ✅ ${chain ? "شبکه: " + chain[0] : ""} — حالا «ذخیره» را بزنید.`
          : "آدرسی گرفته نشد."
      );
    } catch {
      setMmStatus("اتصال لغو شد.");
    }
  }

  async function saveWallet(e: any) {
    e.preventDefault();
    const res = await fetch("/api/wallet", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(walletForm),
    });
    const d = await res.json();
    if (d.ok) {
      notify("آدرس برداشت ذخیره شد 💳✅");
      load();
    } else {
      notify(d.error || "آدرس معتبر نیست");
    }
  }

  async function requestPayout(e: any) {
    e.preventDefault();
    const res = await fetch("/api/wallet/payout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amountUsdt: Number(payoutForm.amount), note: payoutForm.note }),
    });
    const d = await res.json();
    if (d.ok) {
      notify("درخواست برداشت ثبت شد — در تلگرام تأیید کنید 📩");
      setPayoutForm({ amount: "", note: "" });
      load();
    } else {
      notify(d.error || "خطا");
    }
  }

  async function submitHash(id: number) {
    const h = (hashForm[id] || "").trim();
    if (h.length < 16) {
      notify("هش معتبر وارد کنید ⚠️");
      return;
    }
    const res = await fetch("/api/wallet/payout", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, txHash: h }),
    });
    const d = await res.json();
    if (d.ok) {
      notify("برداشت تکمیل شد ✅");
      load();
    } else {
      notify(d.error || "خطا");
    }
  }

  async function sendChat() {
    if (!chatText.trim() || !currentChat) return;
    if (isRealChat) {
      const res = await fetch("/api/chats/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId: currentChat.chatId,
          text: chatText,
          clientName: chatUser,
          username: currentChat.username,
        }),
      });
      const d = await res.json();
      if (d.ok) {
        notify("در تلگرام ارسال شد 📩");
        setChatText("");
        load();
      } else {
        notify(d.error || "ارسال ناموفق");
      }
    } else {
      const res = await fetch("/api/rest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          _type: "messages",
          chatId: currentChat.chatId || "",
          clientName: chatUser,
          username: currentChat.username || "",
          direction: "out",
          text: chatText,
          status: "read",
          source: "panel",
        }),
      });
      const d = await res.json();
      setMsgs((prev) => [d, ...prev]);
      setChatText("");
      notify("داخلی ذخیره شد 💾");
    }
  }

  async function saveField(key: string) {
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value: fieldVals[key] ?? "" }),
    });
    const d = await res.json();
    if (d.ok) {
      notify("ذخیره شد ✅");
      load();
    } else {
      notify(d.error || "خطا");
    }
  }

  async function testTelegram() {
    const chatId = setup?.telegramAdminChat;
    if (!chatId) {
      notify("چت ادمین تنظیم نشده ⚠️");
      return;
    }
    const res = await fetch("/api/chats/reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId, text: "✅ تست از داشبورد — ربات وصل است." }),
    });
    const d = await res.json();
    notify(d.ok ? "پیام تست ارسال شد 📩" : d.error || "ناموفق");
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-5xl animate-bounce">🤖</div>
          <p className="mt-3 font-bold">در حال بارگذاری...</p>
        </div>
      </div>
    );
  }

  const nav: [string, string][] = [
    ["home", "🏠 خانه"],
    ["agents", "🤖 ایجنت‌ها"],
    ["products", "💼 محصولات"],
    ["payout", "💸 برداشت"],
    ["approvals", "✅ تأییدها"],
    ["chats", "💬 گفتگوها"],
    ["setup", "⚙️ اتصال‌ها"],
  ];

  const originUrl =
    typeof window !== "undefined" ? window.location.origin : "";

  const maxChart = Math.max(...(stats?.chart?.map((c: any) => c.v) || [1]), 1);

  return (
    <div className="min-h-screen bg-[#F6F7F9]">
      <header className="bg-[#0B1220] text-white sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🤖</span>
            <b>سیستم ایجنت‌ها</b>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="hidden md:inline bg-white/10 rounded-full px-3 py-1.5">
              💰 {fa(stats?.income)} USDT
            </span>
            <span className="hidden md:inline bg-white/10 rounded-full px-3 py-1.5">
              {stats?.pricesLive ? `BTC $${fa(stats?.btc)}` : "قیمت: —"}
            </span>
            <button
              onClick={async () => {
                await fetch("/api/auth/login", { method: "DELETE" }).catch(() => {});
                location.href = "/login";
              }}
              className="text-red-300 text-xs"
            >
              خروج ←
            </button>
          </div>
        </div>
        <nav className="max-w-6xl mx-auto px-4 pb-3 flex gap-2 overflow-x-auto">
          {nav.map(([k, l]) => (
            <button
              key={k}
              onClick={() => setView(k)}
              className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-bold ${
                view === k ? "bg-emerald-500 text-black" : "bg-white/10"
              }`}
            >
              {l}
              {k === "approvals" && pendingTasks.length > 0 && (
                <span className="bg-red-500 text-white text-xs px-2 py-0.5 rounded-full mr-1">
                  {fa(pendingTasks.length)}
                </span>
              )}
            </button>
          ))}
        </nav>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-5">
        {/* ==================== خانه ==================== */}
        {view === "home" && (
          <section className="space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                ["💰 درآمد واقعی ثبت‌شده", fa(stats?.income) + " USDT", "text-emerald-600"],
                ["💸 قابل برداشت", fa(stats?.available) + " USDT", "text-sky-600"],
                ["⏳ منتظر تأیید شما", fa(pendingTasks.length), "text-amber-600"],
                ["🤖 ایجنت‌های فعال", fa(stats?.activeAgents), ""],
              ].map(([l, v, c]: any) => (
                <div key={l} className="bg-white rounded-3xl p-4 border">
                  <p className="text-slate-500 text-xs">{l}</p>
                  <p className={`text-xl font-black mt-1 ${c}`}>{v}</p>
                </div>
              ))}
            </div>

            {(setup?.missing?.length > 0 || !walletForm.address) && (
              <div className="bg-amber-50 border border-amber-200 rounded-3xl p-4">
                <b>📋 برای واقعی شدن سیستم، این‌ها را از شما لازم دارم:</b>
                <ul className="mt-2 space-y-1 text-sm">
                  {!walletForm.address && <li>⬜ آدرس برداشت متامسک (بخش 💸 برداشت)</li>}
                  {(setup?.missing || [])
                    .filter((m: any) => m.id !== "payout_wallet")
                    .map((m: any) => (
                      <li key={m.id}>⬜ {m.label} (بخش ⚙️ اتصال‌ها)</li>
                    ))}
                </ul>
                <button
                  onClick={() => setView(!walletForm.address ? "payout" : "setup")}
                  className="mt-3 bg-amber-500 text-black px-5 py-2 rounded-full font-bold text-sm"
                >
                  ببر به تکمیل ←
                </button>
              </div>
            )}

            <div className="grid lg:grid-cols-5 gap-4">
              <div className="lg:col-span-3 bg-white rounded-3xl border p-5">
                <h3 className="font-black">📈 درآمد واقعی (۶ ماه اخیر)</h3>
                <div className="flex items-end gap-3 h-44 mt-5">
                  {stats?.chart?.map((c: any) => (
                    <div key={c.m} className="flex-1 text-center">
                      <div
                        className="bg-emerald-500 rounded-t-xl mx-auto w-full max-w-[52px]"
                        style={{ height: `${Math.max(4, (c.v / maxChart) * 140)}px` }}
                      ></div>
                      <p className="text-xs mt-2 font-bold">{fa(c.v)}</p>
                      <p className="text-[11px] text-slate-400">{c.m}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="lg:col-span-2 bg-white rounded-3xl border p-5">
                <h3 className="font-black mb-2">⏳ منتظر تأیید شما</h3>
                {pendingTasks.slice(0, 4).map((t) => (
                  <div key={t.id} className="border rounded-2xl p-3 mt-2">
                    <b className="text-sm">{t.title}</b>
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
                {pendingTasks.length === 0 && (
                  <p className="text-slate-400 mt-4 text-sm">🎉 چیزی منتظر نیست</p>
                )}
              </div>
            </div>

            <div className="bg-white rounded-3xl border p-5">
              <h3 className="font-black">🧾 آخرین رویدادها</h3>
              {logs.slice(0, 5).map((l) => (
                <div key={l.id} className="py-2 border-b last:border-0 text-sm">
                  <b>{l.agent}</b> — {l.action}
                  <p className="text-slate-500 text-xs">{l.detail}</p>
                </div>
              ))}
              {logs.length === 0 && (
                <p className="text-slate-400 text-sm mt-2">هنوز رویدادی ثبت نشده.</p>
              )}
            </div>
          </section>
        )}

        {/* ==================== ایجنت‌ها ==================== */}
        {view === "agents" && (
          <section className="space-y-4">
            <div className="bg-white rounded-3xl p-4 border text-sm text-slate-600">
              💡 هر ایجنت یک اسم و کد مخصوص خودش دارد. برای ثبت درآمد واقعی هر
              ایجنت، روی «➕ ثبت درآمد واقعی» بزنید و <b>مبلغ + مدرک (هش)</b> را
              وارد کنید.
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              {agentsList.map((ag) => {
                const f = incForm[ag.id] || {};
                return (
                  <article key={ag.id} className="bg-white border rounded-3xl p-5">
                    <div className="flex justify-between items-center gap-2">
                      <span
                        className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                          specialtyMap[ag.specialty]?.[1] || "bg-slate-100"
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
                    <h4 className="font-black text-lg mt-2">
                      {ag.avatar} {ag.name}
                    </h4>
                    <p className="text-xs text-slate-500">{ag.role}</p>
                    <div className="bg-slate-50 rounded-2xl p-3 mt-3 flex justify-between">
                      <div>
                        <p className="text-[11px] text-slate-400">💰 درآمد واقعی</p>
                        <p className="text-lg font-black text-emerald-600">
                          {fa(ag.earnedUsdt)} USDT
                        </p>
                      </div>
                      <div className="text-left">
                        <p className="text-[11px] text-slate-400">مأموریت‌ها</p>
                        <p className="font-black">{fa(ag.tasksCompleted)}</p>
                      </div>
                    </div>
                    <button
                      onClick={() =>
                        setIncForm((prev) => ({
                          ...prev,
                          [ag.id]: { ...f, open: !f.open },
                        }))
                      }
                      className="w-full mt-3 bg-emerald-500 text-white font-bold py-2 rounded-xl text-sm"
                    >
                      {f.open ? "بستن ✖️" : "➕ ثبت درآمد واقعی"}
                    </button>
                    {f.open && (
                      <div className="mt-2 space-y-2 border rounded-2xl p-3 bg-emerald-50/50">
                        <input
                          value={f.title || ""}
                          onChange={(e) =>
                            setIncForm((prev) => ({
                              ...prev,
                              [ag.id]: { ...f, title: e.target.value },
                            }))
                          }
                          placeholder="عنوان (مثلاً: سود آربیتراژ)"
                          className="w-full border rounded-xl p-2 text-sm bg-white"
                        />
                        <input
                          type="number"
                          value={f.amount || ""}
                          onChange={(e) =>
                            setIncForm((prev) => ({
                              ...prev,
                              [ag.id]: { ...f, amount: e.target.value },
                            }))
                          }
                          placeholder="مبلغ USDT *"
                          className="w-full border rounded-xl p-2 text-sm bg-white"
                        />
                        <input
                          value={f.txHash || ""}
                          onChange={(e) =>
                            setIncForm((prev) => ({
                              ...prev,
                              [ag.id]: { ...f, txHash: e.target.value },
                            }))
                          }
                          placeholder="هش تراکنش (مدرک)"
                          className="w-full border rounded-xl p-2 text-sm bg-white font-mono"
                          dir="ltr"
                        />
                        <button
                          onClick={() => registerIncome(ag)}
                          className="w-full bg-slate-900 text-white font-bold py-2 rounded-xl text-sm"
                        >
                          ثبت ✅
                        </button>
                      </div>
                    )}
                    <div className="flex gap-2 mt-2">
                      <button
                        onClick={() => copyText(ag.apiKey, "کلید API کپی شد 🔑")}
                        className="flex-1 bg-slate-100 rounded-xl py-1.5 text-xs font-mono truncate px-2"
                        dir="ltr"
                      >
                        {ag.apiKey}
                      </button>
                      <button
                        onClick={() => deleteAgent(ag.id)}
                        className="px-3 bg-red-50 text-red-600 rounded-xl text-sm"
                      >
                        🗑️
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
            <div className="bg-white rounded-3xl p-4 text-center border">
              <p className="font-black">➕ ایجنت جدید بسازید؟</p>
              {!showAgentForm ? (
                <button
                  onClick={() => setShowAgentForm(true)}
                  className="mt-2 bg-slate-900 text-white px-6 py-2 rounded-full font-bold text-sm"
                >
                  ＋ ساخت ایجنت
                </button>
              ) : (
                <form onSubmit={createAgent} className="grid md:grid-cols-3 gap-2 mt-3">
                  <input
                    required
                    value={newAgent.name}
                    onChange={(e) => setNewAgent({ ...newAgent, name: e.target.value })}
                    placeholder="اسم ایجنت *"
                    className="border rounded-xl p-2 text-sm"
                  />
                  <input
                    value={newAgent.role}
                    onChange={(e) => setNewAgent({ ...newAgent, role: e.target.value })}
                    placeholder="نقش"
                    className="border rounded-xl p-2 text-sm"
                  />
                  <select
                    value={newAgent.specialty}
                    onChange={(e) => setNewAgent({ ...newAgent, specialty: e.target.value })}
                    className="border rounded-xl p-2 text-sm"
                  >
                    <option value="crypto">🪙 رمزارز</option>
                    <option value="freelance">⚛️ فنی</option>
                    <option value="bot">💬 فروش</option>
                    <option value="content">📊 محتوا</option>
                    <option value="custom_api">🔌 خارجی</option>
                  </select>
                  <button className="bg-emerald-500 text-white font-bold py-2 rounded-xl text-sm">
                    ساخت ✅
                  </button>
                </form>
              )}
            </div>
          </section>
        )}

        {/* ==================== محصولات ==================== */}
        {view === "products" && (
          <section className="space-y-4">
            <div className="flex gap-2 flex-wrap">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="🔍 جستجو..."
                className="bg-white border rounded-full px-4 py-2 flex-1 min-w-[200px]"
              />
              <button
                onClick={() => {
                  setEdit(null);
                  setForm({ ...blankProduct(), wallet: walletForm.address });
                  setShowForm(true);
                }}
                className="bg-emerald-500 text-white px-5 py-2 rounded-full font-bold"
              >
                + محصول جدید
              </button>
            </div>
            {filtered.length === 0 ? (
              <div className="bg-white rounded-3xl border p-12 text-center">
                <div className="text-5xl">📭</div>
                <p className="font-bold mt-3">محصولی نیست</p>
              </div>
            ) : (
              <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
                {filtered.map((p) => {
                  const pct = p.budgetUsdt ? Math.round((p.receivedUsdt / p.budgetUsdt) * 100) : 0;
                  return (
                    <article key={p.id} className="bg-white rounded-3xl border p-5">
                      <div className="flex justify-between gap-2">
                        <span className={`px-2 py-1 rounded-full text-xs font-bold ${statusMap[p.status]?.[1] || "bg-slate-100"}`}>
                          {statusMap[p.status]?.[0] || p.status}
                        </span>
                        <span className="text-xs bg-slate-100 px-2 py-1 rounded-full">
                          {typeMap[p.type] || p.type}
                        </span>
                      </div>
                      <h3 className="font-black mt-3">{p.title}</h3>
                      {p.clientName ? (
                        <p className="text-sm text-slate-500">👤 {p.clientName} <span dir="ltr">{p.telegramUser}</span></p>
                      ) : (
                        <p className="text-xs text-slate-400">📋 خدمت آماده فروش (بدون مشتری)</p>
                      )}
                      {p.description ? <p className="text-sm text-slate-600 mt-2 line-clamp-2">{p.description}</p> : null}
                      <div className="mt-3">
                        <div className="flex justify-between text-sm">
                          <span>💰 {fa(p.receivedUsdt)} / {fa(p.budgetUsdt)}</span>
                          <b>{fa(pct)}٪</b>
                        </div>
                        <div className="h-2 bg-slate-100 rounded-full mt-1">
                          <div className="h-full bg-emerald-500 rounded-full" style={{ width: pct + "%" }}></div>
                        </div>
                      </div>
                      <div className="flex gap-2 mt-4">
                        <button
                          onClick={() => { setEdit(p); setForm(p); setShowForm(true); }}
                          className="flex-1 bg-slate-900 text-white py-2 rounded-xl text-sm font-bold"
                        >
                          ویرایش
                        </button>
                        <button
                          onClick={() => advanceStatus(p)}
                          className="flex-1 bg-amber-100 text-amber-800 py-2 rounded-xl text-sm font-bold"
                        >
                          قدم بعدی ←
                        </button>
                        <button onClick={() => delProject(p.id)} className="px-3 bg-red-50 text-red-600 rounded-xl">
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
        {/* ==================== برداشت ==================== */}
        {view === "payout" && (
          <section className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              {[
                ["💰 درآمد کل", fa(stats?.income)],
                ["💸 قابل برداشت", fa(stats?.available)],
                ["✅ برداشت‌شده", fa(stats?.paidOut)],
              ].map(([l, v]) => (
                <div key={l} className="bg-white border rounded-3xl p-4 text-center">
                  <p className="text-slate-500 text-xs">{l}</p>
                  <p className="text-xl font-black text-emerald-600 mt-1">{v}</p>
                </div>
              ))}
            </div>

            <form onSubmit={saveWallet} className="bg-white border rounded-3xl p-5">
              <h3 className="font-black text-lg">🦊 کیف پول متامسک من (مقصد برداشت)</h3>
              <p className="text-xs text-slate-500 mt-1">
                قدم ۱: با دکمه زیر به متامسک وصل شوید (یا آدرس را دستی بچسبانید)، قدم ۲: «ذخیره» را بزنید.
              </p>
              <div className="flex gap-2 mt-3 flex-wrap">
                <button type="button" onClick={connectMetaMask} className="bg-orange-500 text-white px-5 py-2.5 rounded-xl font-bold text-sm">
                  🦊 اتصال متامسک
                </button>
                <select value={walletForm.network} onChange={(e) => setWalletForm({ ...walletForm, network: e.target.value })} className="border rounded-xl p-2.5 text-sm">
                  {NETWORKS.map((n) => (<option key={n} value={n}>{n}</option>))}
                </select>
              </div>
              {mmStatus && <p className="text-xs text-slate-600 mt-2">{mmStatus}</p>}
              <input required value={walletForm.address} onChange={(e) => setWalletForm({ ...walletForm, address: e.target.value })} placeholder="0x..." className="w-full border rounded-xl p-3 mt-2 font-mono text-sm" dir="ltr" />
              {walletForm.network === "USDT-TRC20" && (
                <p className="text-xs text-amber-600 mt-1">⚠️ متامسک شبکه ترون (TRC20) ندارد! برای متامسک BEP20 یا Polygon را انتخاب کنید.</p>
              )}
              <button className="mt-3 bg-slate-900 text-white px-6 py-2.5 rounded-xl font-bold text-sm">
                ذخیره آدرس برداشت ✅
              </button>
            </form>

            <form onSubmit={requestPayout} className="bg-white border rounded-3xl p-5">
              <h3 className="font-black text-lg">💸 درخواست برداشت جدید</h3>
              <p className="text-xs text-slate-500 mt-1">
                بعد از ثبت، پیام تأیید با دکمه ✅/❌ به تلگرام شما می‌آید. بدون تأیید شما هیچ برداشتی انجام نمی‌شود.
              </p>
              <div className="grid md:grid-cols-3 gap-2 mt-3">
                <input required type="number" value={payoutForm.amount} onChange={(e) => setPayoutForm({ ...payoutForm, amount: e.target.value })} placeholder="مبلغ USDT *" className="border rounded-xl p-2.5 text-sm" />
                <input value={payoutForm.note} onChange={(e) => setPayoutForm({ ...payoutForm, note: e.target.value })} placeholder="توضیح (اختیاری)" className="border rounded-xl p-2.5 text-sm" />
                <button className="bg-emerald-500 text-white rounded-xl font-bold text-sm">ثبت درخواست 📩</button>
              </div>
            </form>

            <div className="bg-white border rounded-3xl overflow-hidden">
              <h3 className="font-black p-4 pb-0">🧾 تاریخچه برداشت‌ها</h3>
              {payouts.length === 0 && (<p className="p-4 text-slate-400 text-sm">هنوز برداشتی ثبت نشده.</p>)}
              {payouts.map((t) => (
                <div key={t.id} className="p-4 border-b last:border-0">
                  <div className="flex flex-wrap justify-between items-center gap-2">
                    <b>{t.title}</b>
                    <span className={`px-2 py-1 rounded-full text-xs font-bold ${statusMap[t.status]?.[1] || "bg-slate-100"}`}>
                      {statusMap[t.status]?.[0] || t.status}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    💸 {fa(t.amountUsdt)} USDT • مقصد: <span dir="ltr" className="font-mono">{String(t.destinationWallet).slice(0, 14)}...</span> • {t.network}
                    {t.txHash && (<> • هش: <span dir="ltr" className="font-mono">{String(t.txHash).slice(0, 16)}...</span></>)}
                  </p>
                  {t.status === "approved" && (
                    <div className="flex gap-2 mt-2">
                      <input value={hashForm[t.id] || ""} onChange={(e) => setHashForm((prev) => ({ ...prev, [t.id]: e.target.value }))} placeholder="هش تراکنش متامسک را بعد از انتقال بچسبانید" className="flex-1 border rounded-xl p-2 text-sm font-mono" dir="ltr" />
                      <button onClick={() => submitHash(t.id)} className="bg-slate-900 text-white px-4 rounded-xl font-bold text-sm">
                        تکمیل ✅
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="bg-sky-50 border border-sky-200 rounded-3xl p-4 text-sm">
              <b>ℹ️ این قدم چطور کار می‌کند؟</b>
              <ol className="list-decimal mr-5 mt-2 space-y-1 text-slate-700">
                <li>درآمد واقعی هر ایجنت در بخش 🤖 ایجنت‌ها ثبت می‌شود.</li>
                <li>شما «درخواست برداشت» می‌زنید و در تلگرام تأیید می‌کنید.</li>
                <li>انتقال را خودتان در متامسک انجام می‌دهید و هش را اینجا ثبت می‌کنید.</li>
                <li>قدم بعدی (با هم): اتصال مستقیم صرافی و برداشت خودکار امن.</li>
              </ol>
            </div>
          </section>
        )}
        {/* ==================== تأییدها ==================== */}
        {view === "approvals" && (
          <section className="space-y-3">
            {pendingTasks.length === 0 && (
              <div className="bg-white border rounded-3xl p-10 text-center text-slate-400">
                🎉 چیزی منتظر تأیید نیست
              </div>
            )}
            {tasks.map((t) => (
              <div key={t.id} className="bg-white rounded-3xl border p-5">
                <div className="flex flex-wrap justify-between gap-2">
                  <b>{t.actionType === "payout" ? "💸 " : ""}{t.title}</b>
                  <span className={`px-2 py-1 rounded-full text-xs font-bold ${statusMap[t.status]?.[1] || "bg-slate-100"}`}>
                    {statusMap[t.status]?.[0] || t.status}
                  </span>
                </div>
                <p className="text-sm text-slate-500 mt-1">{t.agent} {t.projectTitle ? `• ${t.projectTitle}` : ""}</p>
                <p className="text-sm mt-2">{t.description}</p>
                {t.status === "pending" && (
                  <div className="flex gap-2 mt-4">
                    <button onClick={() => actTask(t, "approved")} className="bg-emerald-500 text-white px-5 py-2 rounded-full font-bold">
                      ✅ تأیید و اجرا
                    </button>
                    <button onClick={() => actTask(t, "rejected")} className="bg-red-500 text-white px-5 py-2 rounded-full font-bold">
                      ❌ رد
                    </button>
                  </div>
                )}
              </div>
            ))}
          </section>
        )}

        {/* ==================== گفتگوها ==================== */}
        {view === "chats" && (
          <section className="grid lg:grid-cols-3 gap-4">
            <div className="bg-white rounded-3xl border p-4">
              <h3 className="font-black mb-3">گفتگوها</h3>
              {chatList.length === 0 && (
                <p className="text-slate-400 text-sm">هنوز گفتگویی نیست. وقتی کسی به ربات پیام بدهد، اینجا می‌آید.</p>
              )}
              {chatList.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setChatUser(c.clientName)}
                  className={`w-full text-right p-3 rounded-2xl mb-1 ${chatUser === c.clientName ? "bg-emerald-50 border border-emerald-200" : "hover:bg-slate-50"}`}
                >
                  <b>{c.clientName}</b>
                  {c.status === "unread" && (<span className="bg-red-500 text-white text-[10px] px-2 rounded-full float-left">جدید</span>)}
                  <p className="text-xs text-slate-400">{c.username}</p>
                </button>
              ))}
            </div>
            <div className="lg:col-span-2 bg-white rounded-3xl border p-4 flex flex-col min-h-[480px]">
              <h3 className="font-black">
                {chatUser || "یک گفتگو انتخاب کنید"}{" "}
                {isRealChat && <span className="text-emerald-500 text-xs">● ارسال واقعی در تلگرام</span>}
              </h3>
              <div className="flex-1 space-y-3 mt-4 overflow-y-auto">
                {chatMsgs.map((m) => (
                  <div key={m.id} className={`max-w-[80%] p-3 rounded-2xl text-sm ${m.direction === "out" ? "bg-emerald-500 text-white mr-auto" : "bg-slate-100 ml-auto"}`}>
                    {m.text}
                  </div>
                ))}
              </div>
              {chatUser && (
                <div className="flex gap-2 mt-4">
                  <input value={chatText} onChange={(e) => setChatText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendChat()} placeholder={isRealChat ? "پاسخ واقعی در تلگرام..." : "ذخیره داخلی..."} className="flex-1 border rounded-full px-4 py-3" />
                  <button onClick={sendChat} className="bg-emerald-500 text-white px-6 rounded-full font-bold">
                    ارسال 📩
                  </button>
                </div>
              )}
            </div>
          </section>
        )}
        {/* ==================== اتصال‌ها ==================== */}
        {view === "setup" && (
          <section className="space-y-4">
            <div className="bg-white border rounded-3xl p-5">
              <h3 className="font-black text-lg">📋 از شما چه لازم دارم؟</h3>
              <div className="mt-3 space-y-2 text-sm">
                <div className="flex justify-between border rounded-2xl p-3">
                  <span>🦊 آدرس برداشت متامسک</span>
                  <b className={walletForm.address ? "text-emerald-600" : "text-amber-600"}>
                    {walletForm.address ? "✅ ثبت شده" : "⬜ بخش برداشت"}
                  </b>
                </div>
                {(setup?.missing || []).map((m: any) => (
                  <div key={m.id} className="flex justify-between border rounded-2xl p-3">
                    <span>⬜ {m.label}</span>
                    <span className="text-amber-600 font-bold">لازم است</span>
                  </div>
                ))}
                {(setup?.missing || []).filter((m: any) => m.id !== "payout_wallet").length === 0 && (
                  <p className="text-emerald-600 font-bold">🎉 همه اتصال‌ها کامل است!</p>
                )}
              </div>
            </div>

            <div className="bg-white border rounded-3xl p-5">
              <h3 className="font-black text-lg">🏦 اتصال صرافی (قدم بعدی ترید)</h3>
              <p className="text-xs text-slate-500 mt-1">کلید فقط «خواندن + معامله» بسازید — گزینه برداشت (Withdraw) همیشه خاموش.</p>
              <div className="grid md:grid-cols-3 gap-2 mt-3">
                <select value={fieldVals["exchange_name"] || ""} onChange={(e) => setFieldVals((p) => ({ ...p, exchange_name: e.target.value }))} className="border rounded-xl p-2.5 text-sm">
                  <option value="">انتخاب صرافی...</option>
                  <option value="nobitex">نوبیتکس</option>
                  <option value="wallex">والکس</option>
                  <option value="binance">بایننس</option>
                  <option value="kucoin">کوکوین</option>
                  <option value="other">دیگر</option>
                </select>
                <input value={fieldVals["exchange_api_key"] || ""} onChange={(e) => setFieldVals((p) => ({ ...p, exchange_api_key: e.target.value }))} placeholder={(setup?.fields || []).find((f: any) => f.key === "exchange_api_key")?.masked || "کلید API"} className="border rounded-xl p-2.5 text-sm font-mono" dir="ltr" />
                <input type="password" value={fieldVals["exchange_api_secret"] || ""} onChange={(e) => setFieldVals((p) => ({ ...p, exchange_api_secret: e.target.value }))} placeholder={(setup?.fields || []).find((f: any) => f.key === "exchange_api_secret")?.masked || "رمز API"} className="border rounded-xl p-2.5 text-sm font-mono" dir="ltr" />
              </div>
              <div className="flex gap-2 mt-2 flex-wrap">
                <button onClick={() => saveField("exchange_name")} className="bg-slate-900 text-white px-4 py-2 rounded-xl font-bold text-sm">ذخیره صرافی</button>
                <button onClick={() => saveField("exchange_api_key")} className="border px-4 py-2 rounded-xl font-bold text-sm">ذخیره کلید</button>
                <button onClick={() => saveField("exchange_api_secret")} className="border px-4 py-2 rounded-xl font-bold text-sm">ذخیره رمز</button>
              </div>
            </div>

            <div className="bg-white border rounded-3xl p-5">
              <h3 className="font-black text-lg">🧠 کلید AI (برای ابزارهای تولیدی)</h3>
              <div className="grid md:grid-cols-3 gap-2 mt-3">
                <select value={fieldVals["ai_provider"] || ""} onChange={(e) => setFieldVals((p) => ({ ...p, ai_provider: e.target.value }))} className="border rounded-xl p-2.5 text-sm">
                  <option value="">انتخاب...</option>
                  <option value="openai">OpenAI</option>
                  <option value="gemini">Gemini</option>
                  <option value="other">دیگر</option>
                </select>
                <input type="password" value={fieldVals["ai_api_key"] || ""} onChange={(e) => setFieldVals((p) => ({ ...p, ai_api_key: e.target.value }))} placeholder={(setup?.fields || []).find((f: any) => f.key === "ai_api_key")?.masked || "کلید AI"} className="border rounded-xl p-2.5 text-sm font-mono md:col-span-2" dir="ltr" />
              </div>
              <div className="flex gap-2 mt-2">
                <input value={fieldVals["ai_model"] || ""} onChange={(e) => setFieldVals((p) => ({ ...p, ai_model: e.target.value }))} placeholder="مدل (gemini-3.5-flash)" className="border rounded-xl p-2 text-sm font-mono flex-1" dir="ltr" />
                <button onClick={() => saveField("ai_model")} className="border px-4 py-2 rounded-xl font-bold text-sm">ذخیره مدل</button>
              </div>
              <div className="flex gap-2 mt-2">
                <button onClick={() => saveField("ai_provider")} className="bg-slate-900 text-white px-4 py-2 rounded-xl font-bold text-sm">ذخیره ارائه‌دهنده</button>
                <button onClick={() => saveField("ai_api_key")} className="border px-4 py-2 rounded-xl font-bold text-sm">ذخیره کلید</button>
              </div>
            </div>
            <div className="bg-white border rounded-3xl p-5">
              <h3 className="font-black text-lg">🛡️ سقف‌های ریسک معامله</h3>
              <div className="grid md:grid-cols-4 gap-2 mt-3">
                <div>
                  <label className="text-xs text-slate-500">سقف هر معامله (٪ سرمایه)</label>
                  <input type="number" value={fieldVals["risk_max_trade_pct"] || ""} onChange={(e) => setFieldVals((p) => ({ ...p, risk_max_trade_pct: e.target.value }))} className="w-full border rounded-xl p-2.5 text-sm mt-1" />
                </div>
                <div>
                  <label className="text-xs text-slate-500">سقف اهرم</label>
                  <input type="number" value={fieldVals["risk_max_leverage"] || ""} onChange={(e) => setFieldVals((p) => ({ ...p, risk_max_leverage: e.target.value }))} className="w-full border rounded-xl p-2.5 text-sm mt-1" />
                </div>
                <div>
                  <label className="text-xs text-slate-500">حد ضرر اجباری</label>
                  <select value={fieldVals["risk_require_sl"] || "true"} onChange={(e) => setFieldVals((p) => ({ ...p, risk_require_sl: e.target.value }))} className="w-full border rounded-xl p-2.5 text-sm mt-1">
                    <option value="true">بله ✅</option>
                    <option value="false">خیر</option>
                  </select>
                </div>
                <div className="flex items-end">
                  <button onClick={async () => { await saveField("risk_max_trade_pct"); await saveField("risk_max_leverage"); await saveField("risk_require_sl"); }} className="w-full bg-slate-900 text-white px-4 py-2.5 rounded-xl font-bold text-sm">
                    ذخیره ریسک
                  </button>
                </div>
              </div>
            </div>

            <div className="bg-white border rounded-3xl p-5">
              <h3 className="font-black text-lg">📩 ربات تلگرام</h3>
              <div className="text-sm mt-2 space-y-1">
                <p>🤖 ربات: <b dir="ltr">{setup?.botUsername}</b> <span className="text-emerald-600">● متصل</span></p>
                <p>👤 چت ادمین: <b dir="ltr">{setup?.telegramAdminChat || "—"}</b></p>
                <p>🔗 وب‌هوک: <span dir="ltr" className="bg-slate-100 px-2 py-0.5 rounded text-xs">{originUrl}/api/telegram/webhook</span></p>
              </div>
              <button onClick={testTelegram} className="mt-3 bg-[#229ED9] text-white px-5 py-2 rounded-full font-bold text-sm">
                ارسال پیام تست 📩
              </button>
            </div>

            <div className="bg-white border rounded-3xl p-5">
              <h3 className="font-black text-lg">☁️ وضعیت سیستم</h3>
              <div className="grid md:grid-cols-4 gap-2 mt-3 text-sm">
                {[
                  ["دیتابیس", walletInfo?.deployment?.databaseConnected ? "✅ متصل" : "⏳"],
                  ["اجرا", walletInfo?.deployment?.isVercel ? "🚀 ورسل" : "💻 محلی"],
                  ["قیمت زنده", stats?.pricesLive ? "✅ بایننس" : "⏳ قطع"],
                  ["تلگرام", walletInfo?.deployment?.telegramConfigured ? "✅ وصل" : "❌"],
                ].map(([k, v]) => (
                  <div key={k} className="bg-slate-50 border rounded-2xl p-3">
                    <p className="text-xs text-slate-500">{k}</p>
                    <p className="font-black mt-1">{v}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}
      </main>

      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-3">
          <form onSubmit={saveProject} className="bg-white w-full max-w-2xl rounded-3xl p-6 max-h-[92vh] overflow-y-auto">
            <h3 className="font-black text-xl">{edit ? "ویرایش" : "محصول / پروژه جدید"}</h3>
            <div className="grid md:grid-cols-2 gap-3 mt-4">
              <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="اسم محصول *" className="border rounded-xl p-3 md:col-span-2" />
              <input value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} placeholder="نام مشتری (اگر دارد)" className="border rounded-xl p-3" />
              <input value={form.telegramUser} onChange={(e) => setForm({ ...form, telegramUser: e.target.value })} placeholder="@telegram" className="border rounded-xl p-3" dir="ltr" />
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="border rounded-xl p-3">
                {Object.entries(typeMap).map(([k, v]) => (<option key={k} value={k}>{v}</option>))}
              </select>
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="border rounded-xl p-3">
                {Object.entries(statusMap).slice(0, 7).map(([k, v]) => (<option key={k} value={k}>{v[0]}</option>))}
              </select>
              <input type="number" value={form.budgetUsdt} onChange={(e) => setForm({ ...form, budgetUsdt: e.target.value })} placeholder="بودجه USDT" className="border rounded-xl p-3" />
              <input type="number" value={form.receivedUsdt} onChange={(e) => setForm({ ...form, receivedUsdt: e.target.value })} placeholder="دریافتی USDT" className="border rounded-xl p-3" />
              <input value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} placeholder="ددلاین" className="border rounded-xl p-3" />
              <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="border rounded-xl p-3">
                <option value="high">🔴 بالا</option>
                <option value="medium">🟡 متوسط</option>
                <option value="low">🟢 کم</option>
              </select>
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="توضیحات..." className="border rounded-xl p-3 md:col-span-2" rows={3} />
            </div>
            <div className="flex gap-2 mt-5">
              <button className="flex-1 bg-emerald-500 text-white py-3 rounded-xl font-bold">{edit ? "ذخیره" : "ساخت"}</button>
              <button type="button" onClick={() => setShowForm(false)} className="px-6 border rounded-xl font-bold">انصراف</button>
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
