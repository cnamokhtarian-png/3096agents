import type { Metadata } from "next"; import type { ReactNode } from "react"; import "./globals.css";
export const metadata: Metadata={title:"مرکز کنترل فریلنسری | Freelance Agent OS",description:"داشبورد فارسی مدیریت پروژه‌های کریپتویی، ایجنت تلگرام و درآمد USDT"};
export default function RootLayout({children}:{children:ReactNode}){return(<html lang="fa" dir="rtl"><body className="antialiased">{children}</body></html>)}
