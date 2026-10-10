import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check } from "lucide-react";
import { toast } from "sonner";
import { listSportRequests, setSportRequestResolved } from "@/lib/sport-requests.functions";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Chip } from "@/components/ui/chip";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin/leads")({
  component: AdminLeads,
});

/** listSportRequests returns at most this many rows (newest first). */
const SPORT_REQUESTS_LIST_LIMIT = 500;

const SOURCE_LABELS: Record<string, string> = {
  coach_signup: "Coach sign-up",
  coach_onboarding: "Coach onboarding",
  coach_settings: "Settings",
};

/**
 * Waitlist & leads. Sport requests (beta feedback 2026-10-07) replaced
 * custom sports: coaches ask for a sport that isn't listed, the team gets an
 * email, and the requests collect here. Beta parents and organization leads
 * (parent_profiles.beta, organization_leads) are still to come.
 */
function AdminLeads() {
  const listFn = useServerFn(listSportRequests);
  const resolveFn = useServerFn(setSportRequestResolved);
  const qc = useQueryClient();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["admin-sport-requests"],
    queryFn: () => listFn(),
  });

  const toggle = useMutation({
    mutationFn: resolveFn,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-sport-requests"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const requests = data?.requests ?? [];
  const tally = new Map<string, number>();
  for (const r of requests) {
    if (r.resolvedAt) continue;
    const key = r.sport.trim().toLowerCase();
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }
  const top = Array.from(tally.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 space-y-6">
      <header className="space-y-3">
        <Link
          to="/admin"
          className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-widest text-text-secondary hover:text-text-primary"
        >
          <ArrowLeft className="size-3.5" /> Back to admin
        </Link>
        <div>
          <Eyebrow size="small" tone="accent-ink">
            Internal
          </Eyebrow>
          <h1 className="font-display text-h1 text-text-primary">Waitlist & leads</h1>
        </div>
      </header>

      <section className="space-y-3">
        <h2 className="font-display text-h3 text-text-primary">Sport requests</h2>
        <p className="text-sm text-text-secondary">
          Sports coaches asked Gradus to add. Each one also emails support@gradussports.com.
        </p>
        {top.length > 0 && (
          <p className="text-sm text-text-primary">
            Open: {top.map(([sport, n]) => `${sport} (${n})`).join(", ")}
          </p>
        )}
        {requests.length >= SPORT_REQUESTS_LIST_LIMIT && (
          <p className="text-sm text-text-secondary">
            Showing the newest {SPORT_REQUESTS_LIST_LIMIT}; the open counts cover only these.
          </p>
        )}
        {isLoading ? (
          <p className="text-text-secondary">Loading…</p>
        ) : isError ? (
          <p className="text-destructive">{(error as Error).message}</p>
        ) : requests.length === 0 ? (
          <p className="text-text-secondary">No sport requests yet.</p>
        ) : (
          <ul className="space-y-2">
            {requests.map((r) => {
              const resolved = !!r.resolvedAt;
              return (
                <li
                  key={r.id}
                  className={cn(
                    "flex flex-wrap items-center justify-between gap-3 rounded-lg border border-divider bg-card p-3 shadow-card",
                    resolved && "opacity-70",
                  )}
                >
                  <div className="space-y-0.5">
                    <p className="text-[15px] font-semibold text-text-primary">{r.sport}</p>
                    <p className="text-[11px] text-text-tertiary">
                      {r.role} · {SOURCE_LABELS[r.source] ?? r.source} ·{" "}
                      {new Date(r.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <Chip
                    size="caption"
                    tone="muted"
                    selected={resolved}
                    onClick={() => toggle.mutate({ data: { id: r.id, resolved: !resolved } })}
                  >
                    <Check className="size-3" />
                    {resolved ? "Handled" : "Mark handled"}
                  </Chip>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
