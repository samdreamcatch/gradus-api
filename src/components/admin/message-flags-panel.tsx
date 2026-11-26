import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import {
  adminListMessageFlags,
  adminMessageRules,
  adminSetMessagingPaused,
  adminUpdateMessageFlag,
  type FlagStatus,
} from "@/lib/message-flags.functions";
import { FLAG_OUTCOME_LABELS, flagDelivered } from "@/lib/message-flags";
import { MESSAGE_CATEGORIES, MESSAGE_CATEGORY_INFO } from "@/lib/message-rules";
import { REPORT_STATUS_LABELS } from "@/lib/safety-types";
import { Chip } from "@/components/ui/chip";
import { cn } from "@/lib/utils";

const STATUSES: FlagStatus[] = ["open", "reviewed", "actioned", "dismissed"];

const MIGRATION_NOTE =
  "The message-flags migration (20261110190000) hasn't been applied yet, so nothing is recorded.";

/** Admin › Reports › Flagged messages (PRD decision #64). */
export function MessageFlagsPanel({ openOnly }: { openOnly: boolean }) {
  const listFn = useServerFn(adminListMessageFlags);
  const updateFn = useServerFn(adminUpdateMessageFlag);
  const pauseFn = useServerFn(adminSetMessagingPaused);
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-message-flags"] });

  const { data, isLoading } = useQuery({
    queryKey: ["admin-message-flags", openOnly],
    queryFn: () => listFn({ data: { openOnly } }),
  });
  const onError = (e: unknown) =>
    toast.error("Couldn't save", {
      description: e instanceof Error ? e.message : "Please try again.",
    });
  const setStatus = useMutation({ mutationFn: updateFn, onSuccess: refresh, onError });
  const setPaused = useMutation({ mutationFn: pauseFn, onSuccess: refresh, onError });

  if (isLoading) return <p className="text-text-secondary">Loading…</p>;
  if (data?.migrationPending) return <p className="text-text-secondary">{MIGRATION_NOTE}</p>;
  if (!data?.items.length) return <p className="text-text-secondary">No flagged messages.</p>;

  return (
    <ul className="space-y-3">
      {data.items.map((f) => {
        const urgent = flagDelivered(f) || f.category === "self_harm";
        return (
          <li
            key={f.id}
            className={cn(
              "rounded-lg border bg-card p-4 shadow-card",
              urgent ? "border-destructive/60" : "border-divider",
              f.status !== "open" && "opacity-75",
            )}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                {urgent ? <ShieldAlert className="size-4 text-destructive" /> : null}
                <span className="text-xs font-semibold text-text-primary">
                  {MESSAGE_CATEGORY_INFO[f.category].label} · {FLAG_OUTCOME_LABELS[f.outcome]}
                </span>
              </div>
              <span className="text-[11px] text-text-tertiary">
                {new Date(f.createdAt).toLocaleString()}
              </span>
            </div>

            <p className="mt-2 text-sm text-text-primary">
              <strong>{f.sender.name}</strong>{" "}
              <span className="text-text-tertiary">
                ({f.sender.role}
                {f.sender.minor ? ", under 18" : ""})
              </span>
              {f.roomHasMinor ? " in a room with an athlete under 18" : ""}
            </p>

            {f.body ? (
              <p className="mt-2 whitespace-pre-wrap rounded-md border border-divider bg-elevated/60 p-2 text-sm text-text-secondary">
                {f.body}
              </p>
            ) : (
              <p className="mt-2 text-sm italic text-text-tertiary">
                Text deleted when this flag was dismissed as a false alarm.
              </p>
            )}
            <p className="mt-1 text-[11px] text-text-tertiary">
              Rule {f.ruleId}
              {f.matched ? ` matched “${f.matched}”` : ""}
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {STATUSES.map((s) => (
                <Chip
                  key={s}
                  size="caption"
                  tone="muted"
                  selected={f.status === s}
                  onClick={() => {
                    if (
                      s === "dismissed" &&
                      f.body &&
                      !window.confirm(
                        "Dismiss as a false alarm? The flagged text is deleted and can't be recovered.",
                      )
                    )
                      return;
                    setStatus.mutate({ data: { id: f.id, status: s } });
                  }}
                >
                  {s === "dismissed" ? "False alarm" : REPORT_STATUS_LABELS[s]}
                </Chip>
              ))}
              <button
                type="button"
                disabled={setPaused.isPending}
                onClick={() => {
                  if (
                    !f.sender.paused &&
                    !window.confirm(
                      `Pause messaging for ${f.sender.name}? They won't be able to send messages or reactions until you resume it.`,
                    )
                  )
                    return;
                  setPaused.mutate({ data: { userId: f.sender.userId, paused: !f.sender.paused } });
                }}
                className={cn(
                  "ml-auto rounded-full px-3 py-1.5 text-xs font-bold ring-1 disabled:opacity-50",
                  f.sender.paused
                    ? "bg-elevated text-text-primary ring-divider"
                    : "bg-destructive/10 text-destructive ring-destructive/40",
                )}
              >
                {f.sender.paused
                  ? `Resume messaging for ${f.sender.name}`
                  : `Pause messaging for ${f.sender.name}`}
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Admin › Reports › Message rules: the list, its criteria, and how each rule has performed. */
export function MessageRulesPanel() {
  const rulesFn = useServerFn(adminMessageRules);
  const { data, isLoading } = useQuery({
    queryKey: ["admin-message-rules"],
    queryFn: () => rulesFn(),
  });
  if (isLoading || !data) return <p className="text-text-secondary">Loading…</p>;

  return (
    <div className="space-y-8">
      <p className="text-sm text-text-secondary">
        Version {data.version}. Read-only: the list changes through a reviewed code change
        (src/lib/message-rules.ts) so the apps and the server always match. Patterns are shown as
        the engine reads them, after a message is lower-cased and stripped of punctuation.
        {data.migrationPending ? ` ${MIGRATION_NOTE}` : ""}
      </p>

      {MESSAGE_CATEGORIES.map((category) => (
        <section key={category} className="space-y-2">
          <h2 className="font-display text-h3 text-text-primary">
            {data.categories[category].label}
          </h2>
          <p className="text-sm text-text-secondary">{data.categories[category].criteria}</p>
          <div className="overflow-x-auto rounded-lg border border-divider">
            <table className="w-full text-left text-sm">
              <thead className="bg-elevated text-[11px] uppercase tracking-widest text-text-tertiary">
                <tr>
                  <th className="px-3 py-2">Rule</th>
                  <th className="px-3 py-2">What it catches</th>
                  <th className="px-3 py-2 text-right">Fired</th>
                  <th className="px-3 py-2 text-right">False alarms</th>
                </tr>
              </thead>
              <tbody>
                {data.rules
                  .filter((r) => r.category === category)
                  .map((r) => (
                    <tr key={r.id} className="border-t border-divider align-top">
                      <td className="px-3 py-2 font-semibold text-text-primary">{r.id}</td>
                      <td className="px-3 py-2">
                        <p className="text-text-primary">{r.label}</p>
                        <details className="mt-1">
                          <summary className="cursor-pointer text-[11px] text-text-tertiary">
                            Show words and patterns
                          </summary>
                          <code className="mt-1 block break-words text-[11px] text-text-secondary">
                            {r.pattern}
                          </code>
                        </details>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.fired}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.falseAlarms}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <section className="space-y-2">
        <h2 className="font-display text-h3 text-text-primary">Never flagged</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-text-secondary">
          {data.never.map((n) => (
            <li key={n.id}>{n.label}</li>
          ))}
          {data.notCounted.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
