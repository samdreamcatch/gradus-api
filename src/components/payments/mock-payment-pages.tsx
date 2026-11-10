import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ExternalLink, Infinity as InfinityIcon } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";

type Payment = {
  title: string;
  athlete: string;
  date: string;
  method: string;
  amount: string;
  status: "Paid" | "Free";
  coach?: string;
  receiptNumber: string;
  price: string;
  discount?: string;
  total: string;
};

const paymentGroups: { month: string; payments: Payment[] }[] = [
  {
    month: "November",
    payments: [
      { title: "Edge Control Foundations", athlete: "Greta", date: "Nov 2", method: "Visa ending 4242", amount: "$24.99", status: "Paid", coach: "Maya Chen", receiptNumber: "GR-2026-11-0024", price: "$24.99", total: "$24.99" },
    ],
  },
  {
    month: "October",
    payments: [
      { title: "Spin Strength Block", athlete: "Leo", date: "Oct 19", method: "Free code COACHGIFT", amount: "$0.00", status: "Free", coach: "Maya Chen", receiptNumber: "GR-2026-10-0019", price: "$20.00", discount: "−$20.00", total: "$0.00" },
      { title: "Juvenile Jump Foundations", athlete: "Greta", date: "Oct 6", method: "Visa ending 4242", amount: "$38.99", status: "Paid", coach: "Jordan Ellis", receiptNumber: "GR-2026-10-0006", price: "$38.99", total: "$38.99" },
      { title: "Build a Consistent Axel", athlete: "Greta", date: "Oct 24", method: "Visa ending 4242", amount: "$20.00", status: "Paid", coach: "Maya Chen", receiptNumber: "GR-2026-10-4471", price: "$39.99", discount: "−$19.99", total: "$20.00" },
    ],
  },
];

const pendingPayment = {
  title: "Build a Consistent Axel",
  athlete: "Greta",
  coach: "Maya Chen",
  amount: "$39.99",
};

function BackButton() {
  return (
    <button type="button" onClick={() => window.history.back()} aria-label="Go back" className="mb-5 flex size-12 items-center justify-center rounded-full border border-slate-400/20 bg-white/70 shadow-sm">
      <ChevronLeft className="size-6" />
    </button>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <h2 className="mb-3 mt-7 font-mono text-xs font-bold uppercase tracking-[.2em] text-slate-600">{children}</h2>;
}

function StatusBadge({ children, held = false }: { children: string; held?: boolean }) {
  return <span className={`rounded-full px-3 py-1 text-xs font-bold ${held ? "bg-amber-100 text-amber-900" : "bg-[#e7f3a3] text-[#344300]"}`}>{children}</span>;
}

function ReceiptSheet({ payment, onClose }: { payment: Payment | null; onClose: () => void }) {
  return (
    <Sheet open={!!payment} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="bottom" className="paper-surface max-h-[88dvh] overflow-y-auto rounded-t-[36px] border-divider p-0 text-[#10274d] [&>button]:sr-only sm:inset-x-auto sm:left-1/2 sm:w-[40vw] sm:max-w-[640px] sm:-translate-x-1/2">
        <div className="mx-auto mt-4 h-1.5 w-16 rounded-full bg-slate-400/50" />
        <div className="border-b border-divider px-5 pb-4 pt-3 text-center">
          <SheetTitle className="text-xl font-bold text-[#10274d]">Receipt</SheetTitle>
        </div>
        {payment && <div className="mx-auto max-w-2xl px-5 pb-8 pt-4">
          <div className="overflow-hidden rounded-[30px] bg-white/75">
            <div className="border-b border-divider px-5 py-4">
              <h3 className="font-display text-3xl font-bold leading-tight">{payment.title}</h3>
              <p className="mt-1 text-base text-slate-600">Program · {payment.coach ?? "Maya Chen"}</p>
            </div>
            <dl className="divide-y divide-slate-300/70 px-5">
              <ReceiptRow label="Date" value={`${payment.date}, 2026`} />
              <ReceiptRow label="Price" value={payment.price} mono />
              {payment.discount && <ReceiptRow label="Code SPRING50" value={payment.discount} mono />}
              <ReceiptRow label="Total paid" value={payment.total} mono />
              <ReceiptRow label="Paid with" value={payment.method.replace("Visa ending", "Visa ending")} />
              <ReceiptRow label="Receipt number" value={payment.receiptNumber} mono />
            </dl>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <button type="button" onClick={() => toast("Receipt email sent")} className="rounded-full border border-slate-500/60 px-3 py-3 font-bold">Email receipt</button>
            <button type="button" onClick={() => toast("Opening your plans")} className="rounded-full bg-[#c3e51b] px-3 py-3 font-bold">Open in Plans</button>
          </div>
        </div>}
      </SheetContent>
    </Sheet>
  );
}

function ReceiptRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="flex min-h-[58px] items-center justify-between gap-4 py-3 text-sm sm:text-base">
    <dt className="text-slate-600">{label}</dt>
    <dd className={`text-right font-bold text-[#10274d] ${mono ? "font-mono" : ""}`}>{value}</dd>
  </div>;
}

export function PaymentsPage() {
  const [receipt, setReceipt] = useState<Payment | null>(null);
  return (
    <main className="min-h-dvh pb-12 text-[#10274d]">
      <div className="mx-auto max-w-2xl px-5 pb-8 pt-6 sm:px-8">
        <BackButton />
        <h1 className="font-display text-5xl font-bold tracking-tight">Payments</h1>
        <SectionLabel>Needs your OK</SectionLabel>
        <article className="rounded-[30px] bg-white/75 p-5 shadow-[0_14px_40px_rgba(44,81,99,.08)]">
          <div className="flex items-center gap-3">
            <div className="flex size-[76px] shrink-0 items-center justify-center rounded-2xl bg-sky-100"><InfinityIcon className="size-11 text-slate-500" /></div>
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-2xl font-bold leading-tight">{pendingPayment.title}</h2>
              <p className="text-sm leading-snug text-slate-600">Greta asked Nov 8 · Program · Maya Chen</p>
            </div>
            <strong className="shrink-0 font-mono text-base">{pendingPayment.amount}</strong>
          </div>
          <div className="mt-4 grid grid-cols-[.8fr_1.2fr] gap-3">
            <button type="button" onClick={() => toast("Payment request declined")} className="rounded-full border border-slate-500/60 px-3 py-3 font-bold">Decline</button>
            <button type="button" onClick={() => toast("Payment checkout preview")} className="rounded-full bg-[#c3e51b] px-3 py-3 font-bold">Review and pay</button>
          </div>
        </article>

        {paymentGroups.map((group) => <section key={group.month}>
          <SectionLabel>{group.month}</SectionLabel>
          <div className="overflow-hidden rounded-[30px] bg-white/75 shadow-[0_14px_40px_rgba(44,81,99,.08)]">
            {group.payments.map((payment, index) => <button key={payment.receiptNumber} type="button" onClick={() => setReceipt(payment)} className={`flex w-full items-center gap-3 px-5 py-4 text-left ${index ? "border-t border-divider" : ""}`}>
              <span className="min-w-0 flex-1"><strong className="block text-lg leading-tight">{payment.title}</strong><span className="mt-1 block text-sm leading-snug text-slate-600">For {payment.athlete} · {payment.date} · {payment.method}</span></span>
              <span className="shrink-0 text-right"><strong className="block font-mono text-base">{payment.amount}</strong><StatusBadge>{payment.status}</StatusBadge></span>
              <ChevronRight className="size-5 shrink-0" />
            </button>)}
          </div>
        </section>)}

        <p className="mt-7 text-sm leading-relaxed text-slate-600">Tap a payment for its receipt. All sales are final. <a className="font-bold text-[#10274d] underline" href="#terms">Terms of sale</a></p>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">Something wrong with a payment? <a className="font-bold text-[#10274d] underline" href="mailto:support@gradus.app">Contact Gradus support</a></p>
      </div>
      <ReceiptSheet payment={receipt} onClose={() => setReceipt(null)} />
    </main>
  );
}

type Sale = { title: string; date: string; price: string; fee: string; net: string };
type HistoryGroup = { name: string; amount: string; subtitle: string; status: "Held" | "Paid"; sales: Sale[] };

const pendingHistory: HistoryGroup[] = [
  { name: "Juvenile Jump Foundations", amount: "$151.32", subtitle: "4 sales since Oct 20", status: "Held", sales: [
    { title: "Sale", date: "Oct 29", price: "$38.99", fee: "3% fee", net: "$37.83" },
    { title: "Sale", date: "Oct 26", price: "$38.99", fee: "3% fee", net: "$37.83" },
    { title: "Sale", date: "Oct 22", price: "$38.99", fee: "3% fee", net: "$37.83" },
    { title: "Sale", date: "Oct 20", price: "$38.99", fee: "3% fee", net: "$37.83" },
  ] },
  { name: "Spin Strength Block", amount: "$46.56", subtitle: "2 sales since Oct 24", status: "Held", sales: [
    { title: "Sale", date: "Oct 26", price: "$24.00", fee: "3% fee", net: "$23.28" },
    { title: "Sale", date: "Oct 24", price: "$24.00", fee: "3% fee", net: "$23.28" },
  ] },
];

const paidHistory: HistoryGroup[] = [
  { name: "Nov 4", amount: "$264.10", subtitle: "Bank ending 4417 · 11 sales", status: "Paid", sales: [
    { title: "Edge Control Foundations", date: "Oct 31", price: "$24.99", fee: "3% fee", net: "$24.24" },
    { title: "Build a Consistent Axel", date: "Oct 30", price: "$39.99", fee: "3% fee", net: "$38.79" },
    { title: "Edge Control Foundations", date: "Oct 29", price: "$12.50 · code SPRING50", fee: "3% fee", net: "$12.12" },
    { title: "Juvenile Jump Foundations", date: "Oct 28", price: "$38.99", fee: "3% fee", net: "$37.83" },
  ] },
  { name: "Oct 28", amount: "$356.20", subtitle: "Bank ending 4417 · 14 sales", status: "Paid", sales: [
    { title: "Build a Consistent Axel", date: "Oct 26", price: "$39.99", fee: "3% fee", net: "$38.79" },
    { title: "Spin Strength Block", date: "Oct 25", price: "$24.00", fee: "3% fee", net: "$23.28" },
  ] },
  { name: "Oct 21", amount: "$501.80", subtitle: "Bank ending 4417 · 19 sales", status: "Paid", sales: [
    { title: "Edge Control Foundations", date: "Oct 20", price: "$24.99", fee: "3% fee", net: "$24.24" },
  ] },
  { name: "Oct 14", amount: "$398.00", subtitle: "Bank ending 4417 · 15 sales", status: "Paid", sales: [
    { title: "Juvenile Jump Foundations", date: "Oct 12", price: "$38.99", fee: "3% fee", net: "$37.83" },
  ] },
];

function EarningsSummary({ held }: { held: boolean }) {
  const graph = <svg viewBox="0 0 360 16" preserveAspectRatio="none" className="mt-1 h-3 w-full" aria-hidden="true"><path d="M3 9 C43 4 75 13 112 8 S183 6 218 9 S291 12 357 7" fill="none" stroke="#465514" strokeWidth="3" strokeLinecap="round" /></svg>;
  return held ? <div className="rounded-[24px] border-4 border-slate-300/70 bg-white/55 p-4">
    <p className="font-mono text-xs font-bold uppercase tracking-widest text-slate-600">Held</p>
    <p className="mt-1 font-display text-3xl font-bold">$197.88</p>
    {graph}
  </div> : <div className="grid grid-cols-2 gap-2 rounded-[24px] bg-slate-300/40 p-1.5">
    <div className="rounded-[20px] bg-white/70 p-4"><p className="font-mono text-xs font-bold uppercase tracking-widest text-slate-600">Paid out</p><p className="mt-1 font-display text-3xl font-bold">$1,520</p>{graph}</div>
    <div className="p-4"><p className="font-mono text-xs font-bold uppercase tracking-widest text-slate-600">On the way</p><p className="mt-1 font-display text-3xl font-bold">$148</p></div>
  </div>;
}

function SalesRows({ group, expanded }: { group: HistoryGroup; expanded: boolean }) {
  const [showAll, setShowAll] = useState(false);
  const sales = showAll ? group.sales : group.sales.slice(0, 3);
  return <>
    {expanded && <div className="px-4">
      {sales.map((sale) => <div key={`${sale.date}-${sale.title}`} className="flex items-center justify-between gap-3 border-t border-divider py-3">
        <div className="min-w-0"><strong className="block text-sm leading-tight">{sale.title}</strong><span className="text-xs text-slate-600">{sale.date} · {sale.price} – {sale.fee}</span></div>
        <strong className="shrink-0 font-mono text-sm">{sale.net}</strong>
      </div>)}
      {group.sales.length > 3 && <button type="button" onClick={() => setShowAll((value) => !value)} className="w-full border-t border-divider py-3 text-left text-sm font-bold">{showAll ? "Show fewer sales" : `Show all ${group.sales.length} sales`}</button>}
    </div>}
  </>;
}

function PayoutGroup({ group, expanded, onToggle }: { group: HistoryGroup; expanded: boolean; onToggle: () => void }) {
  return <article className="overflow-hidden rounded-[30px] bg-white/75 shadow-[0_14px_40px_rgba(44,81,99,.08)]">
    <button type="button" onClick={onToggle} aria-expanded={expanded} className="flex w-full items-center gap-3 px-4 py-4 text-left">
      <span className="min-w-0 flex-1"><strong className="mr-2 text-lg">{group.name}</strong><StatusBadge held={group.status === "Held"}>{group.status}</StatusBadge><span className="mt-1 block text-sm text-slate-600">{group.subtitle}</span></span>
      <strong className="shrink-0 font-mono text-base">{group.amount}</strong>
      {expanded ? <ChevronUp className="size-5 shrink-0" /> : <ChevronDown className="size-5 shrink-0" />}
    </button>
    <SalesRows group={group} expanded={expanded} />
  </article>;
}

export function PaymentHistoryPage({ payoutsSetup = false }: { payoutsSetup?: boolean }) {
  const [expanded, setExpanded] = useState<number | null>(0);
  const groups = payoutsSetup ? paidHistory : pendingHistory;
  return <main className="min-h-dvh pb-12 text-[#10274d]">
    <div className="mx-auto max-w-2xl px-5 pb-8 pt-6 sm:px-8">
      <BackButton />
      <h1 className="mb-5 font-display text-5xl font-bold tracking-tight">Payment history</h1>
      {!payoutsSetup && <section className="rounded-[30px] bg-white/75 p-5 shadow-[0_14px_40px_rgba(44,81,99,.08)]">
        <h2 className="text-lg font-bold leading-snug">Your earnings are safe, waiting for payout setup</h2>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">Buyers paid in full and already have their plans. Gradus holds your share until you connect a bank. Everything held is paid out in your first payout.</p>
        <button type="button" onClick={() => toast("Payout setup coming soon")} className="mt-4 w-full rounded-full bg-[#c3e51b] px-4 py-3 font-bold">Set up payouts</button>
      </section>}
      <div className="mt-4"><EarningsSummary held={!payoutsSetup} /></div>
      {!payoutsSetup ? <>
        <SectionLabel>Waiting for payout setup</SectionLabel>
        <div className="space-y-3">{groups.map((group, index) => <PayoutGroup key={group.name} group={group} expanded={expanded === index} onToggle={() => setExpanded(expanded === index ? null : index)} />)}</div>
      </> : <>
        <SectionLabel>November</SectionLabel>
        <div className="space-y-3">{groups.slice(0, 1).map((group, index) => <PayoutGroup key={group.name} group={group} expanded={expanded === index} onToggle={() => setExpanded(expanded === index ? null : index)} />)}</div>
        <SectionLabel>October</SectionLabel>
        <div className="space-y-3">{groups.slice(1).map((group, index) => <PayoutGroup key={group.name} group={group} expanded={expanded === index + 1} onToggle={() => setExpanded(expanded === index + 1 ? null : index + 1)} />)}</div>
      </>}
      <p className="mt-5 text-sm leading-relaxed text-slate-600">Buyers are never named here. Each sale shows the price, the 3% Gradus fee and what you get.</p>
      {payoutsSetup && <button type="button" onClick={() => toast("Stripe dashboard opening soon")} className="mt-5 flex w-full items-center justify-center gap-2 rounded-full border border-slate-500/60 px-4 py-3 text-sm font-bold">Statements and tax forms in Stripe <ExternalLink className="size-4" /></button>}
    </div>
  </main>;
}
