import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { listCoachVisibility, setCoachVisibility } from "@/lib/coach-visibility.functions";

export type VisibilityPair = {
  otherCoachId: string;
  otherName: string;
  myStatus: "pending" | "accepted" | "declined";
  theirStatus: "pending" | "accepted" | "declined";
};

type CoachRow = {
  coachId: string;
  name: string;
  enabled: boolean;
  status: string;
  pairs?: VisibilityPair[];
};

type CoachVisibilityData = {
  planActive: boolean;
  athletes: Array<{
    id: string;
    firstName: string;
    lastName: string;
    coaches: CoachRow[];
  }>;
};

const coachVisibilityQueryKey = ["coach-visibility"] as const;

/** First name only — these lines get long with two full names in them. */
function shortName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/** One line describing where a single coach-to-coach pairing stands. */
export function pairLabel(coachName: string, p: VisibilityPair): string {
  const me = shortName(coachName);
  const them = shortName(p.otherName);
  if (p.myStatus === "declined") return `${me} declined connecting with ${them}`;
  if (p.theirStatus === "declined") return `${them} declined connecting with ${me}`;
  if (p.myStatus === "accepted" && p.theirStatus === "accepted") return `Connected with ${them}`;
  if (p.myStatus === "accepted") return `${me} accepted — waiting on ${them}`;
  if (p.theirStatus === "accepted") return `Waiting on ${me} to accept`;
  return `Waiting on ${me} and ${them} to accept`;
}

/** Per-pair detail lines, shown inside the status popover. */
export function pairLabels(coach: Pick<CoachRow, "name" | "pairs">): string[] {
  return (coach.pairs ?? []).map((p) => pairLabel(coach.name, p));
}

/**
 * Summary line under a coach's name. One line, counts only — the per-pairing
 * wording lives behind a tap (see CoachVisibilityStatus).
 */
export function statusLabel(coach: Pick<CoachRow, "name" | "enabled" | "status" | "pairs">): string {
  if (!coach.enabled) return "Off";
  const pairs = coach.pairs ?? [];
  if (pairs.length === 0) return "On — add another coach to connect";
  let accepted = 0;
  let declined = 0;
  let pending = 0;
  for (const p of pairs) {
    if (p.myStatus === "declined" || p.theirStatus === "declined") declined += 1;
    else if (p.myStatus === "accepted" && p.theirStatus === "accepted") accepted += 1;
    else pending += 1;
  }
  const parts: string[] = [];
  if (accepted) parts.push(`${accepted} accepted`);
  if (pending) parts.push(`${pending} pending`);
  if (declined) parts.push(`${declined} declined`);
  return parts.join(" · ");
}

/**
 * The one-line status. Tappable when there are pairings to explain; plain text
 * otherwise. The popover is top-aligned so a phone keyboard/thumb doesn't sit
 * over it.
 */
export function CoachVisibilityStatus({
  coach,
  className,
}: {
  coach: Pick<CoachRow, "name" | "enabled" | "status" | "pairs">;
  className?: string;
}) {
  const label = statusLabel(coach);
  const lines = coach.enabled ? Array.from(new Set(pairLabels(coach))) : [];
  const textClass = className ?? "text-[11px] text-text-tertiary";

  if (lines.length === 0) return <p className={textClass}>{label}</p>;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`press-soft truncate text-left underline decoration-dotted underline-offset-2 ${textClass}`}
          aria-label={`${label} — see details`}
        >
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="bottom" className="w-64 p-3">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
          Connection details
        </p>
        <ul className="mt-1.5 space-y-1">
          {lines.map((line) => (
            <li key={line} className="text-xs text-text-secondary">
              {line}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}



/** Shared data + toggle logic for the parent-facing coach visibility controls. */
export function useCoachVisibility(enabled: boolean) {
  const qc = useQueryClient();
  const fetchVisibility = useServerFn(listCoachVisibility);
  const setVisibility = useServerFn(setCoachVisibility);
  const [busy, setBusy] = useState<string | null>(null);

  const q = useQuery({
    queryKey: coachVisibilityQueryKey,
    queryFn: () => fetchVisibility(),
    enabled,
  });

  const toggle = async (athleteId: string, coachId: string, next: boolean) => {
    await qc.cancelQueries({ queryKey: coachVisibilityQueryKey });
    const previous = qc
      .getQueryData<CoachVisibilityData>(coachVisibilityQueryKey)
      ?.athletes.find((athlete) => athlete.id === athleteId)
      ?.coaches.find((coach) => coach.coachId === coachId);

    qc.setQueryData<CoachVisibilityData>(coachVisibilityQueryKey, (current) =>
      current
        ? {
            ...current,
            athletes: current.athletes.map((athlete) =>
              athlete.id !== athleteId
                ? athlete
                : {
                    ...athlete,
                    coaches: athlete.coaches.map((coach) =>
                      coach.coachId === coachId
                        ? {
                            ...coach,
                            enabled: next,
                            status: next ? "waiting" : "off",
                            // Sharing off clears the pairings; turning it on
                            // rebuilds them server-side on refetch.
                            pairs: [],
                          }
                        : coach,
                    ),
                  },
            ),
          }
        : current,
    );
    setBusy(`${athleteId}:${coachId}`);
    try {
      await setVisibility({ data: { athleteId, coachId, enabled: next } });
      toast.success(next ? "Request sent to your coaches." : "Sharing turned off.");
    } catch (e) {
      if (previous) {
        qc.setQueryData<CoachVisibilityData>(coachVisibilityQueryKey, (current) =>
          current
            ? {
                ...current,
                athletes: current.athletes.map((athlete) =>
                  athlete.id !== athleteId
                    ? athlete
                    : {
                        ...athlete,
                        coaches: athlete.coaches.map((coach) =>
                          coach.coachId === coachId ? previous : coach,
                        ),
                      },
                ),
              }
            : current,
        );
      }
      toast.error(e instanceof Error ? e.message : "Couldn't update sharing.");
    } finally {
      setBusy(null);
      void qc.invalidateQueries({ queryKey: coachVisibilityQueryKey });
    }
  };

  const athletes = (q.data?.athletes ?? []).filter((a) => a.coaches.length > 0);

  return { q, athletes, busy, toggle };
}

/**
 * Per-coach sharing toggles for the Team plan page. Turning a coach on asks
 * that coach — and every other coach already on for this athlete — to accept
 * a two-way window.
 */
export function CoachVisibilitySection({ planActive }: { planActive: boolean }) {
  const { q, athletes, busy, toggle } = useCoachVisibility(planActive);

  if (!planActive) {
    return null;
  }

  return (
    <div className="mt-7 w-full">
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-divider" />
        <span className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
          Coach visibility
        </span>
        <div className="h-px flex-1 bg-divider" />
      </div>

      <p className="mt-3 text-center text-[11px] text-text-tertiary sm:text-xs">
        Turn a coach on to let them see — and be seen by — this athlete's other connected coaches.
        Both coaches have to accept.
      </p>

      {q.isPending ? (
        <div className="mt-4 flex justify-center">
          <Loader2 className="h-4 w-4 animate-spin text-text-tertiary" />
        </div>
      ) : athletes.length === 0 ? (
        <p className="mt-4 text-center text-xs text-text-tertiary">
          No coaches connected to your athletes yet.
        </p>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          {athletes.map((a) => (
            <div key={a.id} className="rounded-xl border border-divider bg-card p-3 shadow-card">
              <p className="text-sm font-semibold text-text-primary">
                {a.firstName} {a.lastName}
              </p>
              <div className="mt-2 flex flex-col divide-y divide-divider">
                {(a.coaches as CoachRow[]).map((c) => (
                  <div key={c.coachId} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-text-primary">{c.name}</p>
                      <CoachVisibilityStatus coach={c} />
                    </div>
                    <Switch
                      checked={c.enabled}
                      disabled={busy === `${a.id}:${c.coachId}`}
                      onCheckedChange={(next) => void toggle(a.id, c.coachId, next)}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

