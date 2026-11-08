"use client";

type Balance = { asset: string; free: number; locked: number; total: number };
type Price = { symbol: string; price: number; source: string; fetchedAt: string };
type ExchangeTest = { prices?: Price[]; priceError?: string; account?: { balances: Balance[] }; accountError?: string };
type Wallet = { address?: string; network?: string };

function number(value: number) {
  return Number.isFinite(Number(value)) ? Number(value).toLocaleString("fa-IR", { maximumFractionDigits: 8 }) : "نامشخص";
}

export default function ExchangeDetails({ test, testedAt, wallet }: { test?: ExchangeTest | null; testedAt?: string | null; wallet?: Wallet | null }) {
  const balances = test?.account?.balances;
  return (
    <section aria-label="اطلاعات صرافی و کیف پول" className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 text-slate-800">
      <h4 className="text-sm font-black">اطلاعات صرافی و کیف پول</h4>
      <div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs leading-6">
        <p className="font-bold">کیف پول ثبت‌شده شرکت <span className="font-normal text-slate-500">(مجزا از حساب صرافی)</span></p>
        <p>شبکه: {wallet?.network || "ثبت نشده"}</p>
        <p>آدرس: {wallet?.address ? <span dir="ltr" className="inline-block break-all font-mono">{wallet.address}</span> : "ثبت نشده یا در دسترس نیست"}</p>
        <p className="text-slate-500">این آدرس به‌تنهایی موجودی روی شبکه را نشان نمی‌دهد.</p>
      </div>
      {!test ? <p className="mt-3 text-xs text-slate-600">برای دیدن موجودی حساب و قیمت، دکمهٔ تست اتصال صرافی را بزنید.</p> : <>
        <p className="mt-3 text-xs text-slate-500">{testedAt ? `زمان بررسی: ${new Date(testedAt).toLocaleString("fa-IR")}` : "نتیجهٔ آخرین بررسی در این صفحه"}</p>
        {test.accountError ? <p role="alert" className="mt-2 rounded-xl bg-red-50 p-3 text-xs text-red-700">خطای خواندن حساب صرافی: {test.accountError}</p> : !test.account ? <p className="mt-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-800">حساب صرافی بررسی نشده است؛ موجودی نامشخص است.</p> : <div className="mt-3">
          <p className="text-xs font-bold">موجودی حساب صرافی</p>
          <p className="mt-1 text-[11px] text-slate-500">فقط دارایی‌های درخواست‌شده در این بررسی؛ خالی بودن فهرست به معنی صفر بودن کل حساب نیست.</p>
          {balances?.length ? <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[340px] text-right text-xs"><thead><tr className="border-b text-slate-500"><th className="p-2">ارز</th><th className="p-2">آزاد</th><th className="p-2">مسدود</th><th className="p-2">مجموع</th></tr></thead><tbody>{balances.map((b, i) => <tr className="border-b border-slate-100" key={`${b.asset}-${i}`}><td className="p-2 font-bold" dir="ltr">{b.asset}</td><td className="p-2">{number(b.free)}</td><td className="p-2">{number(b.locked)}</td><td className="p-2">{number(b.total)}</td></tr>)}</tbody></table></div> : <p className="mt-2 text-xs text-slate-600">هیچ‌یک از دارایی‌های درخواست‌شده در پاسخ موجود نبود.</p>}
        </div>}
        <div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs leading-6">
          <p className="font-bold">قیمت عمومی بازار</p>
          {test.priceError ? <p role="alert" className="text-red-700">خطای دریافت قیمت: {test.priceError}</p> : test.prices?.length ? test.prices.map((price, i) => <p key={`${price.symbol}-${i}`}><span dir="ltr" className="inline-block">{price.symbol}</span>: {number(price.price)} <span className="text-slate-500">(منبع: {price.source}؛ {price.fetchedAt ? new Date(price.fetchedAt).toLocaleString("fa-IR") : "زمان نامشخص"})</span></p>) : <p>قیمت دریافت نشد.</p>}
          <p className="text-slate-500">منبع قیمت ممکن است با صرافی حساب شما متفاوت باشد.</p>
        </div>
      </>}
    </section>
  );
}
