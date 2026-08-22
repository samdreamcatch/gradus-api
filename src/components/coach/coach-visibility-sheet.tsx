import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Eye, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useVisualViewport } from "@/hooks/use-visual-viewport";
import {
  disconnectCoachVisibility,
  listMyCoachVisibility,
  respondToCoachVisibility,
} from "@/lib/coach-visibility.functions";

export function useCoachVisibility() {
  const fetchMine = useServerFn(listMyCoachVisibility);
  return useQuery({ queryKey: ["my-coach-visibility"], queryFn: () => fetchMine() });
}

/**
 * Coach-side prompt for parent-initiated coach connections. Nothing is shared
 * until this coach accepts, and either coach can turn a live one back off.
 */
export function CoachVisibilitySheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const qc = useQueryClient();
  const vv = useVisualViewport();
  const q = useCoachVisibility();
  const respond = useServerFn(respondToCoachVisibility);
  const disconnect = useServerFn(disconnectCoachVisibility);
  const [busy, setBusy] = useState<string | null>(null);

  const pending = q.data?.pending ?? [];
  const connected = q.data?.connected ?? [];

  const act = async (key: string, run: () => Promise<unknown>, message: string) => {
    setBusy(key);
    try {
      await run();
      await qc.invalidateQueries({ queryKey: ["my-coach-visibility"] });
      toast.success(message);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update that.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="paper-surface overflow-y-auto"
        style={{ bottom: vv.keyboardInset, maxHeight: Math.round(vv.height * 0.9) }}
      >
        <SheetHeader>
          <SheetTitle>Coach visibility</SheetTitle>
          <SheetDescription>
            A parent asked to connect you with another coach. If you both accept, you can each see
            the other's plans, practice log, goals, and schedule for that shared athlete — view only.
          </SheetDescription>
        </SheetHeader>

        {q.isPending ? (
          <div className="mt-6 flex justify-center">
            <Loader2 className="size-4 animate-spin text-text-tertiary" />
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-4">
            {pending.length > 0 && (
              <div className="overflow-hidden rounded-xl border border-divider bg-elevated divide-y divide-divider">
                {pending.map((r) => (
                  <div key={r.id} className="flex flex-col gap-2 px-3 py-3">
                    <div>
                      <p className="text-sm font-semibold text-text-primary">{r.coachName}</p>
                      <p className="text-[11px] text-text-tertiary">for {r.athleteName}</p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={busy === r.id}
                        onClick={() =>
                          void act(
                            r.id,
                            () => respond({ data: { linkId: r.id, accept: true } }),
                            "Connected.",
                          )
                        }
                      >
                        Accept
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy === r.id}
                        onClick={() =>
                          void act(
                            r.id,
                            () => respond({ data: { linkId: r.id, accept: false } }),
                            "Declined.",
                          )
                        }
                      >
                        Decline
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {connected.length > 0 && (
              <div>
                <p className="mb-2 px-1 text-[11px] font-bold uppercase tracking-widest text-text-tertiary">
                  Connected
                </p>
                <div className="overflow-hidden rounded-xl border border-divider bg-elevated divide-y divide-divider">
                  {connected.map((r) => (
                    <div key={r.id} className="flex items-center justify-between gap-3 px-3 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm text-text-primary">{r.coachName}</p>
                        <p className="text-[11px] text-text-tertiary">for {r.athleteName}</p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy === r.id}
                        onClick={() =>
                          void act(
                            r.id,
                            () => disconnect({ data: { linkId: r.id } }),
                            "Turned off.",
                          )
                        }
                      >
                        Turn off
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {pending.length === 0 && connected.length === 0 && (
              <p className="text-sm text-text-tertiary">
                No coach connections yet. A parent on the Team plan can connect you with their
                athlete's other coaches.
              </p>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/**
 * Opens the sheet automatically the first time a coach lands on the app with
 * pending requests waiting (once per browser session).
 */
export function CoachVisibilityAutoPrompt() {
  const q = useCoachVisibility();
  const [open, setOpen] = useState(false);
  const pendingIds = (q.data?.pending ?? []).map((p) => p.id).join(",");

  useEffect(() => {
    if (!pendingIds) return;
    const key = `gradus.coachVisibilitySeen`;
    if (typeof sessionStorage !== "undefined" && sessionStorage.getItem(key) === pendingIds) return;
    if (typeof sessionStorage !== "undefined") sessionStorage.setItem(key, pendingIds);
    setOpen(true);
  }, [pendingIds]);

  if (!pendingIds && !open) return null;
  return <CoachVisibilitySheet open={open} onOpenChange={setOpen} />;
}

/** Settings row that opens the sheet, badged with any pending requests. */
export function CoachVisibilitySettingsRow() {
  const q = useCoachVisibility();
  const [open, setOpen] = useState(false);
  const pending = q.data?.pending.length ?? 0;
  const connected = q.data?.connected.length ?? 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="press-soft flex w-full items-center gap-3 px-4 py-3 text-left text-sm"
      >
        <span className="shrink-0 text-text-tertiary">
          <Eye className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-text-primary">Coach visibility</div>
          <div className="mt-0.5 text-xs text-text-tertiary">
            {pending > 0
              ? `${pending} request${pending === 1 ? "" : "s"} waiting`
              : connected > 0
                ? `${connected} connected coach${connected === 1 ? "" : "es"}`
                : "Shared athletes with other coaches"}
          </div>
        </div>
        {pending > 0 && (
          <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold text-accent-foreground">
            {pending}
          </span>
        )}
      </button>
      <CoachVisibilitySheet open={open} onOpenChange={setOpen} />
    </>
  );
}

