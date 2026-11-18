import { useState } from "react";
import { BadgeCheck, ChevronDown, ChevronRight, Infinity as InfinityIcon, LockKeyhole, Play, Share, Star } from "lucide-react";
import { toast } from "sonner";
import { APP_STORE_URL, openInAppOrStore } from "@/lib/open-in-app";
import type { SharedPlanDTO, SharedPlanMoveDTO } from "@/lib/plan-share.functions";

const reviews = [
  {
    stars: 5,
    date: "Oct 20",
    quote: "She finally holds her back outside edge the whole way round. The off-ice drills fit before school.",
    author: "Parent of a Basic Skills skater",
    response: "Love hearing this. Week 4 builds right on it.",
  },
  {
    stars: 4,
    date: "Oct 9",
    quote: "Clear cues. I wish the week 3 videos were a little longer.",
    author: "Adult skater",
  },
];

function Rating({ count = 5 }: { count?: number }) {
  return <span className="inline-flex items-center gap-0.5 text-[#10274d]" aria-label={`${count} out of 5 stars`}>{Array.from({ length: 5 }, (_, index) => <Star key={index} className={`size-4 ${index < count ? "fill-current" : ""}`} />)}</span>;
}

function PlanCover({ move }: { move?: SharedPlanMoveDTO }) {
  return <div className="relative overflow-hidden rounded-[24px] bg-gradient-to-br from-sky-100 via-sky-50 to-slate-100">
    <div className="relative flex aspect-[2.4/1] min-h-36 items-center justify-center sm:aspect-[2.8/1]">
      <span className="absolute left-3 top-3 rounded-full bg-white px-3 py-1 text-[11px] font-bold">Plan</span>
      <InfinityIcon className="h-24 w-3/4 stroke-[0.65] text-slate-500 sm:h-32" />
      <button type="button" onClick={() => toast("Plan video preview")} aria-label="Play plan preview" className="absolute z-10 flex size-14 items-center justify-center rounded-full border border-slate-500 bg-white text-[#10274d] shadow-md"><Play className="size-5 fill-current" /></button>
      <span className="absolute bottom-3 left-3 rounded-full bg-white px-2 py-1 font-mono text-[10px] font-bold">0:42</span>
      <button type="button" onClick={() => toast(move?.cue || "Preview transcript")} className="absolute bottom-3 right-3 z-10 rounded-full border border-slate-500 bg-white px-3 py-1.5 text-xs font-bold">Transcript</button>
      <div className="absolute bottom-0 left-0 z-0 h-2 w-full -rotate-2 border-t-[5px] border-[#c3e51b]" />
    </div>
  </div>;
}

function MovePreview({ move, remaining, onOpenApp }: { move: SharedPlanMoveDTO; remaining: number; onOpenApp: () => void }) {
  const [open, setOpen] = useState(true);
  const unit = move.targetKind === "mins" ? "min" : "reps";
  return <div className="overflow-hidden rounded-[22px] bg-white/70">
    <button type="button" onClick={() => setOpen((value) => !value)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
      <span className="shrink-0 font-display text-xl font-bold">{move.targetValue}<span className="ml-1 font-sans text-xs font-normal text-slate-500">{unit}</span></span>
      <span className="min-w-0 flex-1 font-display text-base font-bold leading-tight">{move.name}</span>
      <span className="rounded-full bg-slate-200 px-2 py-1 text-[10px] font-bold">Sample</span>
      <ChevronDown className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} />
    </button>
    {open && <div className="space-y-3 border-t border-divider px-4 py-3 text-sm">
      {move.cue && <p><span className="mb-1 block font-mono text-[10px] font-bold uppercase tracking-widest text-slate-500">Cue</span>{move.cue}</p>}
      {move.why && <p><span className="mb-1 block font-mono text-[10px] font-bold uppercase tracking-widest text-slate-500">Why</span>{move.why}</p>}
      {move.description && <p className="leading-relaxed text-slate-600">{move.description}</p>}
    </div>}
    {remaining > 0 && <button type="button" onClick={onOpenApp} className="flex w-full items-center gap-2 border-t border-divider px-4 py-3 text-left text-sm font-bold text-slate-600"><LockKeyhole className="size-4" />{remaining} more {remaining === 1 ? "move" : "moves"}</button>}
  </div>;
}

function ReviewCard({ review }: { review: (typeof reviews)[number] }) {
  return <article className="border-b border-divider px-4 py-3 last:border-0">
    <div className="flex items-center justify-between"><Rating count={review.stars} /><span className="text-xs text-slate-500">{review.date}</span></div>
    <p className="mt-2 text-sm leading-relaxed">{review.quote}</p>
    <p className="mt-2 text-xs text-slate-500">{review.author}</p>
    {review.response && <div className="ml-3 mt-2 rounded-xl bg-slate-200/80 px-3 py-2 text-xs"><strong className="block">Maya Chen</strong>{review.response}</div>}
  </article>;
}

function AppLink({ appPath, className = "" }: { appPath: string; className?: string }) {
  return <a href={APP_STORE_URL} onClick={(event) => { event.preventDefault(); openInAppOrStore(appPath); }} className={`rounded-full border border-slate-500/60 px-4 py-3 text-center text-sm font-bold ${className}`}>Open in the Gradus app</a>;
}

/** `appPath` is the page the app opens to, e.g. `p/<token>`; the marketplace until there is one. */
export function PublicPlanShare({ plan, appPath = "marketplace" }: { plan: SharedPlanDTO; appPath?: string }) {
  const openApp = () => openInAppOrStore(appPath);
  const [coachOpen, setCoachOpen] = useState(false);
  const [allReviews, setAllReviews] = useState(false);
  const firstMove = plan.moves[0];
  const sportText = `${plan.title} ${plan.notes} ${plan.moves.map((move) => move.name).join(" ")}`.toLowerCase();
  const sport = sportText.includes("tennis") || sportText.includes("serve") ? "Tennis" : "Figure Skating";
  const remaining = Math.max(0, plan.moves.length - 1);

  return <main className="min-h-dvh text-[#10274d]">
    <div className="mx-auto max-w-3xl px-4 pb-8 pt-5 sm:px-8 sm:pt-10">
      <header className="mb-5 flex items-center justify-between">
        <p className="font-display text-xl font-bold">Gradus</p>
        <button type="button" aria-label="Share plan" onClick={() => {
          if (navigator.share) void navigator.share({ title: plan.title, url: window.location.href });
          else void navigator.clipboard.writeText(window.location.href).then(() => toast.success("Link copied"));
        }} className="flex size-11 items-center justify-center rounded-full bg-white/65"><Share className="size-5" /></button>
      </header>

      <h1 className="mb-5 max-w-2xl font-display text-4xl font-bold leading-[1.04] tracking-tight sm:text-6xl"><span className="bg-[linear-gradient(transparent_78%,#c3e51b_78%)]">{plan.title}</span></h1>

      <section className="overflow-hidden rounded-[26px] bg-white/65 shadow-[0_14px_35px_rgba(28,67,90,.08)]">
        <PlanCover move={firstMove} />
        <button type="button" onClick={() => setCoachOpen((value) => !value)} aria-expanded={coachOpen} className="flex w-full items-center gap-2 px-4 py-3 text-left">
          <strong className="text-sm">{plan.authorKind === "athlete" ? plan.authorFirstName : [plan.coachFirstName, plan.coachLastName].filter(Boolean).join(" ") || "Gradus Coach"}</strong>
          <span className="inline-flex items-center gap-1 rounded-full border border-[#637d28] px-2 py-0.5 text-[10px] font-bold text-[#465514]"><BadgeCheck className="size-3.5 fill-[#465514] text-[#c3e51b]" />Verified</span>
          <ChevronDown className={`ml-auto size-4 transition-transform ${coachOpen ? "rotate-180" : ""}`} />
        </button>
        {coachOpen && <p className="px-4 pb-3 text-sm text-slate-600">Coach profile and plan details</p>}
        <div className="flex flex-wrap gap-1.5 px-4 pb-3"><span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-bold">{sport}</span><span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-bold">Basic Skills</span></div>
        <div className="flex items-center justify-between border-t border-divider px-4 py-3"><strong className="font-display text-3xl font-bold">$24.99</strong><span className="flex items-center gap-1"><Rating /><span className="text-xs text-slate-500">(24)</span></span></div>
      </section>

      <button type="button" onClick={openApp} className="mt-3 w-full rounded-full bg-[#c3e51b] px-5 py-3 text-sm font-bold shadow-sm">Buy $24.99</button>
      <p className="mt-2 text-center text-xs text-slate-600">Already have it? <AppLink appPath={appPath} className="border-0 p-0 text-xs underline" /></p>

      <section className="mt-6">
        <SectionTitle>What&apos;s inside</SectionTitle>
        <p className="mt-2 text-sm leading-relaxed text-slate-700">{plan.notes || "Steady practice builds confidence and control. Short daily drills help you feel progress with every session."}</p>
        <div className="mt-3 grid grid-cols-3 divide-x divide-divider rounded-[20px] bg-white/65 px-2 py-3">
          <Stat label="Weeks" value="6" /><Stat label="Per week" value="3×" /><Stat label="Moves" value={String(plan.moves.length)} />
        </div>
        {firstMove ? <div className="mt-3"><MovePreview move={firstMove} remaining={remaining} onOpenApp={openApp} /></div> : <div className="mt-3 rounded-[22px] bg-white/65 p-4 text-sm text-slate-600">No moves are listed yet.</div>}
      </section>

      <section className="mt-6">
        <SectionTitle>Reviews</SectionTitle>
        <div className="mt-2 overflow-hidden rounded-[22px] bg-white/65">
          {(allReviews ? [...reviews, ...reviews] : reviews).map((review, index) => <ReviewCard key={`${review.date}-${index}`} review={review} />)}
          <button type="button" onClick={() => setAllReviews((value) => !value)} className="flex w-full items-center justify-between px-4 py-3 text-sm font-bold">{allReviews ? "Show fewer reviews" : "All 24 reviews"}<ChevronRight className="size-4" /></button>
        </div>
      </section>

      <section className="mt-6">
        <SectionTitle>About the coach</SectionTitle>
        <div className="mt-2 rounded-[22px] bg-white/65 p-4">
          <div className="flex items-center gap-3"><div className="size-12 rounded-full bg-[repeating-linear-gradient(45deg,#d8e1e1_0,#d8e1e1_7px,#edf1ef_7px,#edf1ef_14px)]" /><div><h2 className="font-display text-lg font-bold">{plan.authorKind === "athlete" ? plan.authorFirstName : [plan.coachFirstName, plan.coachLastName].filter(Boolean).join(" ") || "Gradus Coach"}</h2><p className="text-xs text-slate-600">{sport} · Denver, CO</p></div></div>
          <p className="mt-3 text-sm leading-relaxed text-slate-700">{plan.notes || "I coach the fundamentals first, so every athlete can build confidence one step at a time."}</p>
          <div className="mt-3 grid grid-cols-3 divide-x divide-divider border-t border-divider pt-3"><Stat label="Rating" value="4.9" /><Stat label="Plans" value="5" /><Stat label="On Gradus" value="3 yrs" /></div>
        </div>
      </section>
    </div>

    <footer className="mt-5 border-t border-divider bg-white/35">
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-8">
        <h2 className="font-display text-xl font-bold">Train with it in the Gradus app</h2>
        <div className="mt-3 grid grid-cols-2 gap-2"><a href={APP_STORE_URL} onClick={(event) => { event.preventDefault(); openApp(); }} className="rounded-full border border-slate-500/60 px-4 py-3 text-center text-sm font-bold">App Store</a><a href="#google-play" className="rounded-full border border-slate-500/60 px-4 py-3 text-center text-sm font-bold">Google Play</a></div>
        <nav className="mt-5 flex gap-5 text-xs text-slate-700 underline"><a href="/terms">Terms of sale</a><a href="/privacy">Privacy</a><a href="mailto:support@gradus.app">Help</a></nav>
      </div>
    </footer>
  </main>;
}

function SectionTitle({ children }: { children: string }) {
  return <h2 className="font-mono text-[10px] font-bold uppercase tracking-[.18em] text-slate-600">{children}</h2>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="px-2 first:pl-1"><p className="font-mono text-[9px] font-bold uppercase tracking-widest text-slate-500">{label}</p><p className="mt-1 font-display text-xl font-bold">{value}</p></div>;
}
