import { NextRequest, NextResponse } from "next/server";
import { ensureSeed, requireAdmin } from "@/lib/seed";
import { getAccount, getFundingWallet, parseBalances, exErrorFa } from "@/lib/exchange";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  await ensureSeed();
  if (!requireAdmin(req)) {
    return NextResponse.json({ error: "نیاز به ورود مدیر" }, { status: 401 });
  }
  try {
    const [account, funding] = await Promise.allSettled([
      getAccount(),
      getFundingWallet(),
    ]);
    const acc = account.status === "fulfilled" ? account.value : null;
    const fund = funding.status === "fulfilled" ? funding.value : null;
    return NextResponse.json({
      ok: true,
      spot: parseBalances(acc),
      funding: parseBalances(fund),
      accountError: account.status === "rejected" ? String(account.reason?.message || account.reason) : null,
      fundingError: funding.status === "rejected" ? String(funding.reason?.message || funding.reason) : null,
    });
  } catch (e: any) {
    return NextResponse.json({ error: exErrorFa(e?.message || "UNKNOWN") }, { status: 502 });
  }
}
