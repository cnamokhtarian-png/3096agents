import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent Company OS | دفتر ایجنت‌های درآمدزا",
  description:
    "ساختمان اداری ایجنت‌های دیجیتال: دفتر مستقل هر کارمند، درآمد USDT واقعی، تأیید انسانی در تلگرام و صرافی واقعی",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fa" dir="rtl">
      <body className="antialiased">{children}</body>
    </html>
  );
}
