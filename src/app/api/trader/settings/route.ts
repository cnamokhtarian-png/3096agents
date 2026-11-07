import { NextRequest, NextResponse } from "next/server";
import { ensureSeed } from "@/lib/seed";
import { getTraderConfig, saveTraderConfig } from "@/lib/trader";

export const dynamic = "force-dynamic";

/** GET /api/trader/settings → تنظیمات اختصاصی آریا */
export async function GET() {
  await ensureSeed();
  return NextResponse.json(await getTraderConfig());
}

/** PUT /api/trader/settings → کلید فعال/غیرفعال، سقف سرمایه، حداکثر اهرم و ... */
export async function PUT(req: NextRequest) {
  try {
    await ensureSeed();
    const b = await req.json().catch(() => ({}));
    const config = await saveTraderConfig(b);
    return NextResponse.json({ ok: true, config });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "خطای ذخیرهٔ تنظیمات" },
      { status: 400 }
    );
  }
}
