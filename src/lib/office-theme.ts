/**
 * تم بصری هر دپارتمان/دفتر.
 * هر کارمند بر اساس تخصصش اتاق، رنگ دیوار، وسیله روی دیوار و صندلی مخصوص
 * خودش را دارد تا «دفتر مستقل» واقعاً حس شود.
 */

export type OfficeTheme = {
  key: string;
  label: string;
  roleShort: string;
  wall: string;         // گرادیان دیوار
  floor: string;        // گرادیان کف
  accent: string;       // رنگ تاکید (Tailwind text/bg)
  accentHex: string;
  glow: string;
  prop: string;         // المان دیواری
  propLabel: string;
  screen: string;       // رنگ صفحه مانیتور
  desk: string;
  plant: string;
};

const THEMES: Record<string, OfficeTheme> = {
  crypto: {
    key: "crypto",
    label: "دپارتمان بازار سرمایه",
    roleShort: "تریدر و تحلیل‌گر آن‌چین",
    wall: "from-[#0d1526] via-[#111c33] to-[#0a1220]",
    floor: "from-[#0b1220] via-[#101a2c] to-[#070d18]",
    accent: "text-amber-300",
    accentHex: "#fbbf24",
    glow: "shadow-[0_0_60px_-15px_rgba(251,191,36,0.6)]",
    prop: "📈",
    propLabel: "تابلوی کندل‌استیک زنده",
    screen: "#0f2a1f",
    desk: "from-[#1d2a44] to-[#121c2f]",
    plant: "🪴",
  },
  freelance: {
    key: "freelance",
    label: "دپارتمان مهندسی",
    roleShort: "توسعه‌دهنده فول‌استک",
    wall: "from-[#0b1626] via-[#10233a] to-[#091320]",
    floor: "from-[#0a1220] via-[#0e1a2a] to-[#060c16]",
    accent: "text-cyan-300",
    accentHex: "#22d3ee",
    glow: "shadow-[0_0_60px_-15px_rgba(34,211,238,0.55)]",
    prop: "⌨️",
    propLabel: "دیوار کد و مانیتور دوگانه",
    screen: "#0b2233",
    desk: "from-[#1b3047] to-[#0f1f30]",
    plant: "🌿",
  },
  bot: {
    key: "bot",
    label: "دپارتمان فروش",
    roleShort: "مسئول فروش و مذاکره",
    wall: "from-[#101a2e] via-[#132a44] to-[#0a1424]",
    floor: "from-[#0a1220] via-[#101d30] to-[#060c16]",
    accent: "text-sky-300",
    accentHex: "#38bdf8",
    glow: "shadow-[0_0_60px_-15px_rgba(56,189,248,0.5)]",
    prop: "💬",
    propLabel: "تابلوی گفتگوهای تلگرام",
    screen: "#0d2233",
    desk: "from-[#1a2c44] to-[#101d2e]",
    plant: "🪴",
  },
  content: {
    key: "content",
    label: "دپارتمان محتوا",
    roleShort: "تولید محتوا و ترجمه",
    wall: "from-[#171227] via-[#20183a] to-[#100c1c]",
    floor: "from-[#0d1020] via-[#141830] to-[#080a14]",
    accent: "text-violet-300",
    accentHex: "#c4b5fd",
    glow: "shadow-[0_0_60px_-15px_rgba(196,181,253,0.5)]",
    prop: "📚",
    propLabel: "کتابخانه وایت‌پیپر",
    screen: "#221531",
    desk: "from-[#2a2240] to-[#191430]",
    plant: "🪴",
  },
  custom_api: {
    key: "custom_api",
    label: "دپارتمان یکپارچه‌سازی",
    roleShort: "مهندس یکپارچه‌سازی API",
    wall: "from-[#0b1a1a] via-[#0f2828] to-[#071313]",
    floor: "from-[#081312] via-[#0d1e1d] to-[#050b0b]",
    accent: "text-emerald-300",
    accentHex: "#34d399",
    glow: "shadow-[0_0_60px_-15px_rgba(52,211,153,0.5)]",
    prop: "🗄️",
    propLabel: "رک سرور و وبهوک",
    screen: "#0a2620",
    desk: "from-[#153028] to-[#0c1c18]",
    plant: "🌱",
  },
};

export function themeFor(specialty?: string | null): OfficeTheme {
  return THEMES[String(specialty || "crypto")] || THEMES.crypto;
}

export const statusTheme: Record<
  string,
  { label: string; dot: string; text: string; bg: string; ring: string }
> = {
  active: {
    label: "سر کار",
    dot: "bg-emerald-400",
    text: "text-emerald-300",
    bg: "bg-emerald-500/15 border-emerald-400/30",
    ring: "ring-emerald-400/40",
  },
  working: {
    label: "در حال کار",
    dot: "bg-cyan-400",
    text: "text-cyan-300",
    bg: "bg-cyan-500/15 border-cyan-400/30",
    ring: "ring-cyan-400/40",
  },
  paused: {
    label: "مرخصی / متوقف",
    dot: "bg-slate-400",
    text: "text-slate-300",
    bg: "bg-slate-500/15 border-slate-400/30",
    ring: "ring-slate-400/30",
  },
  error: {
    label: "خطا",
    dot: "bg-red-400",
    text: "text-red-300",
    bg: "bg-red-500/15 border-red-400/30",
    ring: "ring-red-400/40",
  },
};

export function statusInfo(status?: string | null) {
  return statusTheme[String(status || "active")] || statusTheme.active;
}

export function relativeTime(date?: string | Date | null) {
  if (!date) return "بدون فعالیت";
  const t = new Date(date).getTime();
  if (!Number.isFinite(t)) return "بدون فعالیت";
  const diff = Math.max(0, Date.now() - t);
  const m = Math.floor(diff / 60000);
  if (m < 1) return "همین حالا";
  if (m < 60) return `${m} دقیقه پیش`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ساعت پیش`;
  const d = Math.floor(h / 24);
  return `${d} روز پیش`;
}
