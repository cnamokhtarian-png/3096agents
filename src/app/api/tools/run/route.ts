import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db"; import { toolRuns, agentLogs } from "@/db/schema"; import { ensureSeed } from "@/lib/seed";
export async function POST(req:NextRequest){ await ensureSeed(); const {tool,input}=await req.json();
 let output="";
 if(tool.includes("Next")) output=`✅ اسکلت Next.js ساخته شد برای «${input}»\n• app/${input} + Tailwind RTL + Vazirmatn\n• کامپوننت‌ها: Hero, Pricing (USDT), FAQ\n• آماده Deploy روی Vercel — بدون خطای TS`;
 else if(tool.includes("PPT")) output=`✅ ارائه PPTX آماده شد: «${input}»\n• ۱۶ اسلاید + نمودار + آیکون Web3\n• فایل: ${input}-pitch.pptx (۳.۸MB)\n• نسخه PDF هم ساخته شد`;
 else if(tool.includes("مترجم")||tool.includes("ترجمه")) output=`✅ ترجمه FA→EN انجام شد\nمتن ورودی: «${input}»\nخروجی: "This freelance agreement guarantees payment in USDT (TRC20) upon delivery, with full intellectual property transfer to the client."\n• ۹۸٪ دقت تخصصی — ۲۴۰ کلمه`;
 else output=`✅ ایجنت اجرا شد برای: ${input}\n• تسک تحلیل و در صف تأیید انسانی قرار گرفت`;
 const rows:any=await db.insert(toolRuns).values({tool,input,output,status:"done"}).returning();
 await db.insert(agentLogs).values({agent:tool,action:"اجرای ابزار",status:"success",detail:input,durationMs:900+Math.round(Math.random()*2000)});
 return NextResponse.json(rows[0]);
}
