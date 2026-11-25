import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { toast } from "sonner";
import { Mail, ShieldAlert } from "lucide-react";
import { listPlanReportsFn, updatePlanReportFn } from "@/lib/plan-reports.functions";
import { adminCoachContact } from "@/lib/admin-marketplace.functions";
import {
  PLAN_REPORT_REASON_LABELS,
  PLAN_REPORT_STATUSES,
  type PlanReportDTO,
  type PlanReportStatus,
} from "@/lib/plan-reports-types";
import { Chip, chipClasses } from "@/components/ui/chip";
import { Textarea } from "@/components/ui/textarea";
import { AdminPageHeader, prettify } from "@/components/admin/marketplace-ui";
import { cn } from "@/lib/utils";

const STATUS_LABELS: Record<PlanReportStatus, string> = {
  open: "Open",
  reviewed: "Reviewed",
  actioned: "Actioned",
  dismissed: "Dismissed",
};

const searchSchema = z.object({
  open: fallback(z.boolean(), true).default(true),
});

export const Route = createFileRoute("/_authenticated/admin/marketplace/flags")({
  validateSearch: zodValidator(searchSchema),
  component: MarketplaceFlags,
});

function MarketplaceFlags() {
  const { open } = Route.useSearch();
  const listFn = useServerFn(listPlanReportsFn);
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-plan-reports", open],
    queryFn: () => listFn({ data: { openOnly: open } }),
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-10">
      <AdminPageHeader
        eyebrow="Marketplace · Trust & safety"
        title="Flags"
        subtitle="Plans buyers reported. Review the listing, contact the coach, then close the report."
        back={{ to: "/admin/marketplace", label: "Marketplace" }}
      >
        <div className="flex flex-wrap gap-2">
          <Link
            from={Route.fullPath}
            search={(prev: any) => ({ ...prev, open: true })}
            className={chipClasses({ tone: "muted", weight: "medium", selected: open })}
          >
            Open
          </Link>
          <Link
            from={Route.fullPath}
            search={(prev: any) => ({ ...prev, open: false })}
            className={chipClasses({ tone: "muted", weight: "medium", selected: !open })}
          >
            All statuses
          </Link>
        </div>
      </AdminPageHeader>

      {isLoading ? (
        <p className="text-text-secondary">Loading…</p>
      ) : error ? (
        <p className="text-sm text-destructive">
          Couldn't load reports. {error instanceof Error ? error.message : ""}
        </p>
      ) : !data?.length ? (
        <p className="text-text-secondary">{open ? "No open flags." : "No reports."}</p>
      ) : (
        <ul className="space-y-3">
          {data.map((r) => (
            <FlagCard key={r.id} report={r} />
          ))}
        </ul>
      )}
    </div>
  );
}

function FlagCard({ report: r }: { report: PlanReportDTO }) {
  const qc = useQueryClient();
  const updateFn = useServerFn(updatePlanReportFn);
  const contactFn = useServerFn(adminCoachContact);
  const [notes, setNotes] = useState(r.adminNotes ?? "");

  const update = useMutation({
    mutationFn: (patch: { status: PlanReportStatus; adminNotes?: string }) =>
      updateFn({ data: { id: r.id, ...patch } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-plan-reports"] });
      qc.invalidateQueries({ queryKey: ["admin-marketplace-overview"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't update the report"),
  });

  const contact = useMutation({
    mutationFn: () => contactFn({ data: { coachId: r.coachId! } }),
    onSuccess: (c) => {
      if (!c.email) {
        toast.error("This coach has no email on file.");
        return;
      }
      const subject = `About your Gradus listing "${r.planTitle}"`;
      const body = `Hi ${c.name.split(" ")[0] || "there"},\n\nA buyer reported your plan "${r.planTitle}" as ${PLAN_REPORT_REASON_LABELS[r.reason].toLowerCase()}.\n\n`;
      window.location.href = `mailto:${c.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't find the coach"),
  });

  const notesChanged = notes.trim() !== (r.adminNotes ?? "").trim();

  return (
    <li
      className={cn(
        "rounded-lg border bg-card p-4 shadow-card",
        r.status === "open" ? "border-destructive/50" : "border-divider opacity-80",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          {r.status === "open" ? <ShieldAlert className="size-4 text-destructive" /> : null}
          <span className="text-xs font-semibold text-text-primary">
            {PLAN_REPORT_REASON_LABELS[r.reason] ?? prettify(r.reason)}
          </span>
        </div>
        <span className="text-[11px] text-text-tertiary">
          {new Date(r.createdAt).toLocaleString()}
        </span>
      </div>

      <p className="mt-2 text-sm text-text-primary">
        {r.planId ? (
          <Link
            to="/admin/marketplace/listings/$planId"
            params={{ planId: r.planId }}
            className="font-semibold hover:underline"
          >
            {r.planTitle}
          </Link>
        ) : (
          <strong>{r.planTitle}</strong>
        )}{" "}
        {r.coachName ? (
          <>
            by{" "}
            {r.coachId ? (
              <Link
                to="/admin/marketplace/sellers/$coachId"
                params={{ coachId: r.coachId }}
                className="font-semibold hover:underline"
              >
                {r.coachName}
              </Link>
            ) : (
              <strong>{r.coachName}</strong>
            )}
          </>
        ) : null}{" "}
        · reported by <strong>{r.reporter.name}</strong>{" "}
        <span className="text-text-tertiary">({r.reporter.role})</span>
      </p>

      {r.note ? (
        <p className="mt-2 whitespace-pre-wrap rounded-md border border-divider bg-elevated/60 p-2 text-[15px] leading-relaxed text-text-primary">
          {r.note}
        </p>
      ) : null}
      {!r.planId ? (
        <p className="mt-2 text-xs text-text-tertiary">The plan has since been deleted.</p>
      ) : null}

      <Textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Admin notes (only admins see these)"
        rows={2}
        maxLength={2000}
        className="mt-3"
        aria-label="Admin notes"
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {PLAN_REPORT_STATUSES.map((s) => (
          <Chip
            as="button"
            type="button"
            key={s}
            size="caption"
            tone="muted"
            selected={r.status === s}
            disabled={update.isPending}
            onClick={() => update.mutate({ status: s, adminNotes: notes.trim() })}
          >
            {STATUS_LABELS[s]}
          </Chip>
        ))}
        {notesChanged ? (
          <Chip
            as="button"
            type="button"
            size="caption"
            tone="accent"
            disabled={update.isPending}
            onClick={() =>
              update.mutate(
                { status: r.status, adminNotes: notes.trim() },
                { onSuccess: () => toast.success("Notes saved") },
              )
            }
          >
            Save notes
          </Chip>
        ) : null}
        <span className="flex-1" />
        {r.coachId ? (
          <Chip
            as="button"
            type="button"
            size="caption"
            tone="muted"
            disabled={contact.isPending}
            onClick={() => contact.mutate()}
          >
            <Mail className="mr-1 size-3.5" />
            Contact coach
          </Chip>
        ) : null}
        {r.planId ? (
          <Link
            to="/admin/marketplace/listings/$planId"
            params={{ planId: r.planId }}
            className={chipClasses({ size: "caption", tone: "muted" })}
          >
            Review listing
          </Link>
        ) : null}
      </div>
    </li>
  );
}
