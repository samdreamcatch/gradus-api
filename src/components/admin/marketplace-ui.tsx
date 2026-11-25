/**
 * Shared pieces for the Admin › Marketplace pages. Same tokens and shapes as
 * the rest of the admin console (Reporting tiles, list cards, Reports chips).
 */
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Film, ImageOff } from "lucide-react";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/utils";

export function money(cents: number | null | undefined, currency = "USD"): string {
  const value = (cents ?? 0) / 100;
  return value.toLocaleString("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

export function dollars(amount: number): string {
  return money(Math.round(amount * 100));
}

export function shortDate(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleDateString() : "—";
}

export function prettify(value: string | null | undefined): string {
  if (!value) return "—";
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function AdminPageHeader({
  eyebrow = "Marketplace",
  title,
  subtitle,
  back,
  children,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: ReactNode;
  back?: { to: string; label: string; params?: Record<string, string> };
  children?: ReactNode;
}) {
  return (
    <header className="space-y-3">
      {back ? (
        <Link
          to={back.to as any}
          params={back.params as any}
          className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-widest text-text-secondary hover:text-text-primary"
        >
          <ArrowLeft className="size-3.5" /> {back.label}
        </Link>
      ) : null}
      <div>
        <Eyebrow size="small" tone="accent-ink">
          {eyebrow}
        </Eyebrow>
        <h1 className="font-display text-h1 text-text-primary">{title}</h1>
        {subtitle ? <p className="text-sm text-text-secondary">{subtitle}</p> : null}
      </div>
      {children}
    </header>
  );
}

/** A Reporting-style tile; a link when `to` is given. */
export function Kpi({
  label,
  value,
  sub,
  to,
  search,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  to?: string;
  search?: Record<string, unknown>;
  tone?: "default" | "attention";
}) {
  const body = (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <Eyebrow size="micro" tone="tertiary" weight="normal" tracking="wide" className="truncate">
          {label}
        </Eyebrow>
        <p
          className={cn(
            "font-display text-h3 leading-none",
            tone === "attention" ? "text-destructive" : "text-text-primary",
          )}
        >
          {value}
        </p>
      </div>
      {sub ? <p className="mt-1 text-[11px] text-text-secondary">{sub}</p> : null}
    </>
  );
  const cls = cn(
    "rounded-xl border bg-card px-3 py-2",
    tone === "attention" ? "border-destructive/50" : "border-divider",
  );
  return to ? (
    <Link
      to={to as any}
      search={search as any}
      className={cn(cls, "transition hover:border-accent/50 hover:bg-elevated")}
    >
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function Section({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-3", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-h3 text-text-primary">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-xl border border-divider bg-card", className)}>{children}</div>
  );
}

export function EmptyRow({ children }: { children: ReactNode }) {
  return <p className="p-4 text-sm text-text-secondary">{children}</p>;
}

export function ListingStatusTag({ live, status }: { live: boolean; status: string }) {
  if (live) return <Tag tone="accent">Live</Tag>;
  // Active, but the coach isn't on Coach Pro (or is in a club): buyers don't see it.
  if (status === "active") return <Tag>Not shown</Tag>;
  return <Tag>{prettify(status)}</Tag>;
}

const PAYOUT_LABEL: Record<string, string> = {
  active: "Payouts on",
  pending: "Payouts started",
  restricted: "Payouts restricted",
  not_connected: "No payouts",
};

export function PayoutTag({ state }: { state: string }) {
  return (
    <Tag
      tone={state === "active" ? "accent" : "default"}
      className={cn(state === "restricted" && "text-destructive")}
    >
      {PAYOUT_LABEL[state] ?? prettify(state)}
    </Tag>
  );
}

export function TierTag({ tier }: { tier: string | null }) {
  return (
    <Tag tone={tier === "coach_pro" ? "accent" : "default"}>
      {tier ? prettify(tier) : "No tier"}
    </Tag>
  );
}

export function Cover({
  url,
  hasVideo,
  className,
}: {
  url: string | null;
  hasVideo?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg border border-divider bg-elevated",
        className,
      )}
    >
      {url ? (
        <img src={url} alt="" className="size-full object-cover" loading="lazy" />
      ) : (
        <div className="flex size-full items-center justify-center text-text-tertiary">
          {hasVideo ? <Film className="size-5" /> : <ImageOff className="size-5" />}
        </div>
      )}
      {hasVideo && url ? (
        <span className="absolute bottom-1 right-1 rounded-pill bg-card/90 px-1.5 py-0.5 text-[10px] font-semibold text-text-primary">
          <Film className="mr-0.5 inline size-3" />
          Video
        </span>
      ) : null}
    </div>
  );
}

const HELD_LABEL: Record<string, string> = {
  awaiting_coach_setup: "Waiting on coach payouts",
  payment_due: "Buyer payment due",
  not_transferred: "Paid, not sent to coach",
};

export function heldLabel(kind: string | null): string | null {
  return kind ? (HELD_LABEL[kind] ?? prettify(kind)) : null;
}

const PAYMENT_LABEL: Record<string, string> = {
  paid: "Paid",
  processing: "Processing",
  payment_due: "Payment due",
  awaiting_coach_setup: "Awaiting coach",
};

export function PaymentTag({ status }: { status: string }) {
  return (
    <Tag tone={status === "paid" ? "accent" : "default"}>
      {PAYMENT_LABEL[status] ?? prettify(status)}
    </Tag>
  );
}

export function Stars({ avg, count }: { avg: number | null; count: number }) {
  if (!count || avg == null) return <span className="text-text-tertiary">No ratings</span>;
  return (
    <span>
      ★ {avg.toFixed(1)} <span className="text-text-tertiary">({count})</span>
    </span>
  );
}
