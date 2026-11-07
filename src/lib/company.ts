// موتور شرکت 3096 — هر ایجنت یک کارمند با شیفت کاری واقعی است.
// هر شیفت: کار واقعی → گزارش در لاگ → در صورت نیاز، کارت تأیید به تلگرام مدیر.
import { db } from "@/db";
import { agents, tasks, messages, agentLogs, settings, projects } from "@/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { geminiGenerate } from "./gemini";

export type ShiftReport = {
  agentId: number;
  name: string;
  avatar: string;
  ran: boolean;
  summary: string;
  problem?: string;
  fix?: string;
  taskId?: number;
};

const ok = (a: any, summary: string, taskId?: number): ShiftReport => ({
  agentId: a.id,
  name: a.name,
  avatar: a.avatar,
  ran: true,
  summary,
  taskId,
});

async function getSetting(key: string): Promise<string> {
  const rows: any = await db.select().from(settings).where(eq(settings.key, key));
  return rows[0]?.value || "";
}

async function setSetting(key: string, value: string) {
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
}

async function logReport(agentName: string, action: string, detail: string, status = "success") {
  await db.insert(agentLogs).values({ agent: agentName, action, status, detail, durationMs: 300 });
}

async function sendAdminCard(text: string, taskId?: number) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!token || !chat) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chat,
        text,
        parse_mode: "HTML",
        reply_markup: taskId
          ? {
              inline_keyboard: [
                [
                  { text: "✅ تأیید و اجرا", callback_data: `approve:${taskId}` },
                  { text: "❌ رد", callback_data: `reject:${taskId}` },
                ],
              ],
            }
          : undefined,
      }),
    });
  } catch {}
}

async function bumpDone(agentId: number) {
  const rows: any = await db.select().from(agents).where(eq(agents.id, agentId));
  const a = rows[0];
  if (a)
    await db
      .update(agents)
      .set({ tasksCompleted: (a.tasksCompleted || 0) + 1 })
      .where(eq(agents.id, agentId));
}

// چرا کار نکرد + چطور حل می‌شود (به زبان ساده)
function faErr(e: any): { problem: string; fix: string } {
  const m = String(e?.message || e);
  if (m.includes("NO_KEY"))
    return {
      problem: "کلید هوش مصنوعی (Gemini) ثبت نشده.",
      fix: "از داشبورد ← ⚙️ اتصال‌ها ← کلید Gemini را وارد کنید.",
    };
  if (m.includes("BAD_MODEL") || m.includes("MODEL"))
    return {
      problem: "مدل هوش مصنوعی معتبر نیست.",
      fix: "در ⚙️ اتصال‌ها مدل را gemini-3.5-flash بگذارید.",
    };
  if (m.includes("AUTH") || m.includes("1100") || m.includes("1103") || m.includes("Access denied") || m.includes("Signature"))
    return {
      problem: "اتصال صرافی کامل نیست (Secret ناقص است).",
      fix: "متن کامل Secret صرافی تبدیل را بفرستید.",
    };
  if (m.includes("PRICE_EMPTY"))
    return { problem: "قیمت لحظه‌ای از صرافی گرفته نشد.", fix: "خودکار در شیفت بعدی دوباره تلاش می‌شود." };
  if (m.includes("abort") || m.includes("timeout") || m.includes("fetch"))
    return { problem: "خطای موقت شبکه.", fix: "خودکار در شیفت بعدی دوباره تلاش می‌شود." };
  return { problem: m.slice(0, 200), fix: "اگر تکرار شد، متن خطا را بفرستید تا بررسی کنم." };
}

// ─── A1 · آریا — رصد بازار و سیگنال ───
async function shiftCrypto(a: any): Promise<ShiftReport> {
  const ex = await import("./exchange");
  const raw = await ex.getDepth("BTC_IRT");
  const d = ex.parseDepth(raw);
  if (!d) throw new Error("PRICE_EMPTY");
  const mid = Math.round(d.mid);
  const last = Number(await getSetting("a1_last_btc") || 0);
  await setSetting("a1_last_btc", String(mid));
  const dropPct = Number(await getSetting("trade_signal_drop_pct") || 3);
  if (!last) {
    const s = `قیمت پایه بیت‌کوین ثبت شد: ${mid.toLocaleString("en")} IRT`;
    await logReport(a.name, "📊 شروع رصد بازار", s);
    return ok(a, s);
  }
  const chg = ((mid - last) / last) * 100;
  const s = `بیت‌کوین ${mid.toLocaleString("en")} IRT (${chg >= 0 ? "+" : ""}${chg.toFixed(2)}٪ نسبت به شیفت قبل)`;
  await logReport(a.name, "📊 گزارش بازار", s);
  if (chg <= -dropPct) {
    const rows: any = await db
      .insert(tasks)
      .values({
        title: `🚨 سیگنال خرید: افت ${Math.abs(chg).toFixed(1)}٪ بیت‌کوین`,
        agent: a.name,
        actionType: "signal",
        description: s,
        projectTitle: "سیگنال A1",
        status: "pending",
        risk: "high",
        payload: `قیمت فعلی: ${mid} IRT — پیشنهاد: بررسی خرید پله‌ای از داشبورد`,
      })
      .returning();
    await bumpDone(a.id);
    await sendAdminCard(`🚨 <b>سیگنال خرید A1 (آریا)</b>\n\n${s}\n\nتأیید = ثبت در کارنامه. برای اجرای سفارش، از داشبورد «پیشنهاد» ثبت کنید.`, rows[0].id);
    return ok(a, s + " — سیگنال صادر شد 🚨", rows[0].id);
  }
  return ok(a, s);
}

// ─── A2 · سازنده وب — پیش‌نویس سایت برای پروژه‌های جدید ───
async function shiftBuilder(a: any): Promise<ShiftReport> {
  const pend: any = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.status, "pending"), eq(tasks.agent, a.name)));
  if (pend.length > 0) {
    const s = "یک پیش‌نویس منتظر تأیید شماست — تا تأیید نشود کار جدید شروع نمی‌کنم.";
    await logReport(a.name, "🏗️ انتظار تأیید", s);
    return ok(a, s);
  }
  const rows: any = await db
    .select()
    .from(projects)
    .where(eq(projects.status, "new"))
    .orderBy(desc(projects.id))
    .limit(5);
  const needy = rows.find((p: any) => !p.description);
  if (!needy) {
    const s = rows.length === 0 ? "پروژه جدیدی برای ساخت نیست — آماده‌باش." : "پروژه‌های جدید همه پیش‌نویس دارند.";
    await logReport(a.name, "🏗️ بررسی صف ساخت", s);
    return ok(a, s);
  }
  const g = await geminiGenerate(
    `تو سازنده وب هستی. برای پروژه «${needy.title}» (کارفرما: ${needy.clientName}) یک پیش‌نویس لندینگ فارسی بنویس: تیتر اصلی، زیرتیتر، ۳ ویژگی کلیدی، دعوت به اقدام. کوتاه و کاربردی. در انتها یک خط جدا بنویس با فرمت: 💡 ارزش: <دلیل سودآوری در یک جمله + زمان/ارزش تخمینی>.`,
    { maxTokens: 1200 }
  );
  const t: any = await db
    .insert(tasks)
    .values({
      title: `🏗️ پیش‌نویس سایت: ${needy.title}`,
      agent: a.name,
      actionType: "web_draft",
      description: `کارفرما: ${needy.clientName}`,
      projectTitle: needy.title,
      status: "pending",
      risk: "low",
      payload: g.text.slice(0, 3000),
    })
    .returning();
  await bumpDone(a.id);
  await sendAdminCard(`🏗️ <b>پیش‌نویس سایت A2</b> برای «${needy.title}» آماده شد:\n\n${g.text.slice(0, 500)}…`, t[0].id);
  return ok(a, `پیش‌نویس «${needy.title}» آماده و منتظر تأیید است.`, t[0].id);
}

// پیام‌های واقعاً مشتری (نه دستورهای خود مدیر)
function isCustomerMsg(m: any, adminChat: string) {
  if (!m.text || m.text.startsWith("/")) return false;
  return String(m.chatId) !== String(adminChat);
}

// ─── A3 · فروشنده تلگرام — پاسخ به پیام‌های خوانده‌نشده ───
async function shiftCloser(a: any): Promise<ShiftReport> {
  const adminChat = process.env.TELEGRAM_ADMIN_CHAT_ID || "";
  const rows: any = await db
    .select()
    .from(messages)
    .where(and(eq(messages.status, "unread"), eq(messages.direction, "in")))
    .orderBy(desc(messages.id))
    .limit(5);
  const m = rows.find((x: any) => isCustomerMsg(x, adminChat));
  if (!m) {
    const s = "پیام جدیدی از مشتری نیست — آماده‌باش.";
    await logReport(a.name, "💬 بررسی صندوق پیام", s);
    return ok(a, s);
  }
  const g = await geminiGenerate(
    `تو فروشنده تلگرام یک فریلنسر هستی. پیام مشتری (${m.clientName}): «${m.text}» — یک پاسخ فارسی کوتاه، مودبانه و حرفه‌ای با پیشنهاد قدم بعدی بنویس. سپس یک خط جدا با فرمت: 💡 ارزش: <چرا این پاسخ به بستن قرارداد کمک می‌کند، یک جمله>. فقط همین دو بخش.`,
    { maxTokens: 600 }
  );
  const t: any = await db
    .insert(tasks)
    .values({
      title: `💬 پاسخ پیشنهادی به ${m.clientName}`,
      agent: a.name,
      actionType: "send_message",
      description: (m.text || "").slice(0, 300),
      projectTitle: "پیام " + (m.username || ""),
      status: "pending",
      risk: "medium",
      payload: `TO:${m.chatId}\n${g.text.slice(0, 1500)}`,
    })
    .returning();
  await db.update(messages).set({ status: "read" }).where(eq(messages.id, m.id));
  await bumpDone(a.id);
  await sendAdminCard(`💬 <b>پاسخ پیشنهادی A3</b> به ${m.clientName}:\n\n${g.text.slice(0, 600)}\n\nتأیید = ارسال واقعی به مشتری ✅`, t[0].id);
  return ok(a, `پاسخ به ${m.clientName} آماده و منتظر تأیید است.`, t[0].id);
}

// ─── A4 · طراح ارائه — ساختار ارائه برای تازه‌ترین پروژه ───
async function shiftDesigner(a: any): Promise<ShiftReport> {
  const pend: any = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.status, "pending"), eq(tasks.agent, a.name)));
  if (pend.length > 0) {
    const s = "یک پیش‌نویس منتظر تأیید شماست — تا تأیید نشود کار جدید شروع نمی‌کنم.";
    await logReport(a.name, "🎨 انتظار تأیید", s);
    return ok(a, s);
  }
  const projs: any = await db.select().from(projects).orderBy(desc(projects.id)).limit(1);
  if (projs.length === 0) {
    const s = "پروژه‌ای برای ارائه‌سازی نیست — آماده‌باش.";
    await logReport(a.name, "🎨 بررسی صف طراحی", s);
    return ok(a, s);
  }
  const p = projs[0];
  const g = await geminiGenerate(
    `تو طراح ارائه هستی. برای پروژه «${p.title}» (کارفرما: ${p.clientName}) ساختار یک ارائه ۷ اسلایدی فارسی بنویس: تیتر هر اسلاید + ۳ نکته کلیدی. در انتها یک خط جدا: 💡 ارزش: <چرا این ارائه به گرفتن پروژه کمک می‌کند، یک جمله>.`,
    { maxTokens: 1500 }
  );
  const t: any = await db
    .insert(tasks)
    .values({
      title: `🎨 پیش‌نویس ارائه: ${p.title}`,
      agent: a.name,
      actionType: "design_draft",
      description: `کارفرما: ${p.clientName}`,
      projectTitle: p.title,
      status: "pending",
      risk: "low",
      payload: g.text.slice(0, 3000),
    })
    .returning();
  await bumpDone(a.id);
  await sendAdminCard(`🎨 <b>پیش‌نویس ارائه A4</b> برای «${p.title}» آماده شد:\n\n${g.text.slice(0, 500)}…`, t[0].id);
  return ok(a, `ارائه «${p.title}» آماده و منتظر تأیید است.`, t[0].id);
}

// ─── A5 · مترجم — ترجمه پیام‌های انگلیسی ───
async function shiftTranslator(a: any): Promise<ShiftReport> {
  const adminChat = process.env.TELEGRAM_ADMIN_CHAT_ID || "";
  const rows: any = await db
    .select()
    .from(messages)
    .where(and(eq(messages.status, "unread"), eq(messages.direction, "in")))
    .orderBy(desc(messages.id))
    .limit(5);
  const m = rows.find(
    (x: any) => isCustomerMsg(x, adminChat) && (/[a-zA-Z]{4,}/.test(x.text || "") || (x.text || "").includes("ترجم"))
  );
  if (!m) {
    const s = "متن انگلیسی برای ترجمه نیست — آماده‌باش.";
    await logReport(a.name, "🌍 بررسی صف ترجمه", s);
    return ok(a, s);
  }
  const g = await geminiGenerate(`این متن را به فارسی روان و دقیق ترجمه کن. در انتها یک خط جدا: 💡 ارزش: <کاربرد این ترجمه در یک جمله>.\n\n${(m.text || "").slice(0, 2000)}`, {
    maxTokens: 1200,
  });
  const t: any = await db
    .insert(tasks)
    .values({
      title: `🌍 ترجمه پیام ${m.clientName}`,
      agent: a.name,
      actionType: "translate",
      description: (m.text || "").slice(0, 300),
      projectTitle: "ترجمه",
      status: "pending",
      risk: "low",
      payload: g.text.slice(0, 3000),
    })
    .returning();
  await db.update(messages).set({ status: "read" }).where(eq(messages.id, m.id));
  await bumpDone(a.id);
  await sendAdminCard(`🌍 <b>ترجمه A5</b> آماده شد:\n\n${g.text.slice(0, 600)}`, t[0].id);
  return ok(a, "ترجمه آماده و منتظر تأیید است.", t[0].id);
}

// ─── A6 · نگهبان — سلامت سیستم (بدون اسپم: هشدار حداکثر هر ۶ ساعت) ───
async function shiftAuditor(a: any): Promise<ShiftReport> {
  const logs: any = await db.select().from(agentLogs).orderBy(desc(agentLogs.id)).limit(30);
  const errs = logs.filter((l: any) => l.status === "error");
  const pend: any = await db.select().from(tasks).where(eq(tasks.status, "pending"));
  const missing: string[] = [];
  if (!(await getSetting("ai_api_key"))) missing.push("کلید Gemini");
  if (!(await getSetting("exchange_api_secret"))) missing.push("Secret صرافی");
  if (!(await getSetting("master_wallet_address"))) missing.push("آدرس متامسک");
  const s = `سلامت: ${errs.length} خطا در ۳۰ رویداد اخیر، ${pend.length} تسک منتظر، ${missing.length} قلم کمبود${missing.length ? ` (${missing.join("، ")})` : ""}.`;
  await logReport(a.name, "🛡️ گزارش نگهبانی", s);
  if (errs.length > 0 || missing.length > 0) {
    const lastAlert = Number(await getSetting("a6_last_alert") || 0);
    if (Date.now() - lastAlert > 6 * 3600 * 1000) {
      await setSetting("a6_last_alert", String(Date.now()));
      await sendAdminCard(`🛡️ <b>هشدار نگهبان (A6)</b>\n\n${s}`);
    }
  }
  return ok(a, s);
}

// ─── B7 · شکارچی پاداش — شکار ایردراپ از فیدها + حقیقت‌سنجی ضداسکم ───
function parseFeed(xml: string): { title: string; link: string; desc: string }[] {
  const items: { title: string; link: string; desc: string }[] = [];
  const blocks = xml.split(/<item[\s>]/i).slice(1, 12);
  for (const b of blocks) {
    const pick = (tag: string) => {
      const m = b.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
      let s = m ? m[1] : "";
      s = s
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      return s;
    };
    const title = pick("title").slice(0, 200);
    const link = pick("link").slice(0, 300);
    const desc = pick("description").slice(0, 800);
    if (title && link) items.push({ title, link, desc });
  }
  return items;
}

async function shiftBounty(a: any): Promise<ShiftReport> {
  const minScore = Number(await getSetting("bounty_min_score") || 70);
  const rawSources = await getSetting("bounty_sources");
  const sources = rawSources
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 3);
  if (sources.length === 0) {
    const s = "منبع شکاری ثبت نشده — آماده‌باش.";
    await logReport(a.name, "🎯 بررسی منابع", s);
    return {
      ...ok(a, s),
      problem: "هیچ فید/سایتی برای شکار ثبت نشده.",
      fix: "در داشبورد ← ⚙️ اتصال‌ها ← «منابع شکار پاداش» را وارد کنید.",
    };
  }
  let seen: string[] = [];
  try {
    seen = JSON.parse((await getSetting("bounty_seen")) || "[]");
  } catch {}
  const fresh: { title: string; link: string; desc: string }[] = [];
  for (const src of sources) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 12000);
      const res = await fetch(src, {
        signal: ctrl.signal,
        headers: { "User-Agent": "Mozilla/5.0" },
      });
      clearTimeout(t);
      if (!res.ok) continue;
      const xml = (await res.text()).slice(0, 250000);
      for (const it of parseFeed(xml)) {
        if (!seen.includes(it.link) && fresh.length < 5) {
          fresh.push(it);
          seen.push(it.link);
        }
      }
    } catch {}
  }
  await setSetting("bounty_seen", JSON.stringify(seen.slice(-200)));
  if (fresh.length === 0) {
    const s = "چیز جدیدی در فیدها نیست — آماده‌باش.";
    await logReport(a.name, "🎯 گشت شکار", s);
    return ok(a, s);
  }
  // یک فراخوان دسته‌ای: استخراج پاداش + زمان + نمره ضداسکم
  const g = await geminiGenerate(
    `تو کارشناس ضداسکم ایردراپ هستی. برای هر مورد زیر یک عضو آرایه JSON بساز (فقط آرایه JSON، بدون متن اضافه):\n` +
      fresh.map((f, i) => `${i + 1}. ${f.title} — ${f.desc.slice(0, 400)}`).join("\n") +
      `\n\nقالب هر عضو: {"reward":"مبلغ/توضیح پاداش به فارسی","reward_usdt":عدد (اگر به دلار/تتر گفته نشده 0),"time_min":زمان تخمینی دقیقه (عدد),"score":نمره اعتماد 0 تا 100,"verdict":"ok یا suspicious یا scam","reason":"دلیل کوتاه فارسی"}\nقوانین: درخواست کلید خصوصی/عبارت بازیابی/واریز مقدماتی = scam؛ وعده سود قطعی غیرواقعی = suspicious؛ پروژه شناخته‌شده بدون پیش‌شرط پولی = ok.`,
    { maxTokens: 2000 }
  );
  let arr: any[] = [];
  try {
    const m = g.text.match(/\[[\s\S]*\]/);
    arr = m ? JSON.parse(m[0]) : [];
  } catch {
    arr = [];
  }
  let made = 0;
  for (let i = 0; i < fresh.length && made < 3; i++) {
    const v = arr[i];
    if (!v || v.verdict !== "ok" || Number(v.score) < minScore) continue;
    const f = fresh[i];
    const t: any = await db
      .insert(tasks)
      .values({
        title: `🎁 پاداش: ${f.title.slice(0, 80)}`,
        agent: a.name,
        actionType: "bounty",
        description: `⏱ ~${v.time_min} دقیقه | 🛡️ نمره ${v.score}/100 | ${v.reason || ""}`.slice(0, 300),
        projectTitle: "شکار پاداش",
        status: "pending",
        risk: "medium",
        payload: JSON.stringify({
          link: f.link,
          reward: v.reward,
          reward_usdt: Number(v.reward_usdt) || 0,
          time_min: Number(v.time_min) || 0,
          score: v.score,
        }),
      })
      .returning();
    await bumpDone(a.id);
    await sendAdminCard(
      `🎁 <b>پاداش پیدا شد (B7)</b>\n\n<b>${f.title}</b>\n💰 ${v.reward}\n⏱ زمان تخمینی: ~${v.time_min} دقیقه\n🛡️ اعتماد: ${v.score}/100 (${v.reason || ""})\n🔗 ${f.link}\n\nتأیید = ثبت در درآمدها ✅`,
      t[0].id
    );
    made++;
  }
  const s =
    made > 0
      ? `${made} پاداش معتبر پیدا و برای تأیید فرستاده شد.`
      : `${fresh.length} مورد جدید بررسی شد ولی هیچ‌کدام حد نصاب اعتماد (${minScore}) را نگرفت.`;
  await logReport(a.name, "🎯 گشت شکار", s);
  return ok(a, s);
}

const SHIFTS: Record<string, (a: any) => Promise<ShiftReport>> = {
  "bounty-hunter": shiftBounty,
  "crypto-employee": shiftCrypto,
  "nextjs-builder": shiftBuilder,
  "telegram-closer": shiftCloser,
  "pptx-designer": shiftDesigner,
  "web3-translator": shiftTranslator,
  "custom-webhook-worker": shiftAuditor,
};

export async function runShift(agentId?: number): Promise<ShiftReport[]> {
  let list: any = await db.select().from(agents).orderBy(agents.id);
  if (agentId) list = list.filter((a: any) => a.id === agentId);
  const results = await Promise.allSettled(
    list.map(async (a: any): Promise<ShiftReport> => {
      if (a.status === "paused")
        return {
          agentId: a.id,
          name: a.name,
          avatar: a.avatar,
          ran: false,
          summary: "خاموش است.",
          problem: "کارمند توسط شما خاموش شده.",
          fix: "از تلگرام (🤖 ایجنت‌ها) یا داشبورد روشنش کنید.",
        };
      const fn = SHIFTS[a.slug];
      if (!fn)
        return { agentId: a.id, name: a.name, avatar: a.avatar, ran: false, summary: "وظیفه‌ای تعریف نشده." };
      try {
        const r = await fn(a);
        await logReport(a.name, "✅ گزارش شیفت", r.summary);
        return r;
      } catch (e: any) {
        const f = faErr(e);
        await logReport(a.name, "⚠️ خطای شیفت", f.problem, "error");
        return {
          agentId: a.id,
          name: a.name,
          avatar: a.avatar,
          ran: true,
          summary: "کار نکرد ⚠️",
          problem: f.problem,
          fix: f.fix,
        };
      }
    })
  );
  return results.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : {
          agentId: list[i].id,
          name: list[i].name,
          avatar: list[i].avatar,
          ran: true,
          summary: "خطای غیرمنتظره ⚠️",
          problem: String((r as any).reason).slice(0, 200),
          fix: "اگر تکرار شد، متن خطا را بفرستید.",
        }
  );
}
