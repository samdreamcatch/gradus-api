import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, MessageSquarePlus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { SegmentedToggle } from "@/components/plans/segmented-toggle";
import { useVisualViewport } from "@/hooks/use-visual-viewport";
import { toast } from "sonner";
import {
  listMyMessageTargets,
  ensureRoomForTarget,
  ensureDirectRoom,
  type MessageTargetDTO,
} from "@/lib/messages.functions";

type Props = {
  basePath: "/coach/messages" | "/parent/messages" | "/athlete/messages";
  roomsQueryKey: readonly unknown[];
  targetsQueryKey: readonly unknown[];
  emptyMessage: ReactNode;
};

type Segment = "all" | "Athletes" | "Parents" | "Coaches";

const GROUP_ORDER = ["Athletes", "Parents", "Coaches"] as const;
const COLLAPSE_AFTER = 6;

function targetKey(t: MessageTargetDTO, idx: number): string {
  if (t.kind === "athlete") return `a-${t.coachId}-${t.athleteId}-${idx}`;
  if (t.kind === "coach_coach") return `cc-${t.otherCoachId}-${idx}`;
  return `cp-${t.parentId}-${idx}`;
}

function matches(t: MessageTargetDTO, needle: string): boolean {
  if (!needle) return true;
  const hay = `${t.primaryLabel} ${t.secondaryLabel ?? ""}`.toLowerCase();
  return hay.includes(needle);
}

export function NewConversationButton({
  basePath,
  roomsQueryKey,
  targetsQueryKey,
  emptyMessage,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [segment, setSegment] = useState<Segment>("all");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const searchRef = useRef<HTMLInputElement>(null);
  const vv = useVisualViewport();

  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fetchTargets = useServerFn(listMyMessageTargets);
  const openRoom = useServerFn(ensureRoomForTarget);
  const openDirect = useServerFn(ensureDirectRoom);

  const { data, isLoading } = useQuery({
    queryKey: targetsQueryKey,
    queryFn: () => fetchTargets(),
    enabled: open,
  });

  useEffect(() => {
    if (!open) {
      setQuery("");
      setSegment("all");
      setExpanded({});
      return;
    }
    const t = setTimeout(() => searchRef.current?.focus(), 120);
    return () => clearTimeout(t);
  }, [open]);

  const startMut = useMutation({
    mutationFn: async (t: MessageTargetDTO) => {
      if (t.kind === "athlete") {
        return openRoom({ data: { coachId: t.coachId, athleteId: t.athleteId } });
      }
      if (t.kind === "coach_coach") {
        return openDirect({ data: { kind: "coach_coach", otherCoachId: t.otherCoachId } });
      }
      return openDirect({ data: { kind: "coach_parent", parentId: t.parentId } });
    },
    onSuccess: ({ id }) => {
      queryClient.invalidateQueries({ queryKey: roomsQueryKey });
      setOpen(false);
      navigate({ to: `${basePath}/$roomId`, params: { roomId: id } });
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Couldn't open conversation"),
  });

  const targets: MessageTargetDTO[] = data?.targets ?? [];

  const { totals, filteredByGroup, totalMatches } = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const totals: Record<string, number> = { Athletes: 0, Parents: 0, Coaches: 0 };
    const filteredByGroup = new Map<string, MessageTargetDTO[]>();
    let totalMatches = 0;
    for (const t of targets) {
      totals[t.group] = (totals[t.group] ?? 0) + 1;
      if (!matches(t, needle)) continue;
      if (segment !== "all" && t.group !== segment) continue;
      const arr = filteredByGroup.get(t.group) ?? [];
      arr.push(t);
      filteredByGroup.set(t.group, arr);
      totalMatches += 1;
    }
    return { totals, filteredByGroup, totalMatches };
  }, [targets, query, segment]);

  const segmentOptions = [
    { key: "all" as const, label: `All · ${targets.length}` },
    { key: "Athletes" as const, label: `Athletes · ${totals.Athletes}` },
    { key: "Parents" as const, label: `Parents · ${totals.Parents}` },
    { key: "Coaches" as const, label: `Coaches · ${totals.Coaches}` },
  ].filter((o) => o.key === "all" || (totals[o.key] ?? 0) > 0);

  const showHeaders = segment === "all";

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Button size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden />
        New
      </Button>
      <SheetContent
        side="bottom"
        className="paper-surface flex flex-col gap-0 overflow-hidden border-t border-divider p-0 shadow-page"
        style={{
          bottom: vv.keyboardInset,
          maxHeight: Math.round(vv.height * 0.9),
        }}
      >
        <SheetHeader className="px-6 pb-3 pt-6 text-left">
          <SheetTitle className="font-display text-2xl">Start a conversation</SheetTitle>
        </SheetHeader>

        {targets.length > 0 ? (
          <div className="space-y-3 px-6 pb-3">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-tertiary"
                aria-hidden
              />
              <Input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name…"
                className="pl-9"
                aria-label="Search recipients"
              />
            </div>
            {segmentOptions.length > 2 ? (
              <SegmentedToggle
                value={segment}
                onChange={setSegment}
                options={segmentOptions}
              />
            ) : null}
          </div>
        ) : null}

        <div className="flex-1 overflow-y-auto px-6 pb-6">
          {isLoading ? (
            <p className="py-6 text-center text-sm text-text-secondary">Loading…</p>
          ) : targets.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-divider bg-card p-6 text-center">
              <MessageSquarePlus className="mx-auto mb-2 size-6 text-text-tertiary" aria-hidden />
              <p className="font-hand text-xl text-text-secondary">{emptyMessage}</p>
            </div>
          ) : totalMatches === 0 ? (
            <div className="rounded-2xl border border-dashed border-divider bg-card p-6 text-center">
              <p className="font-hand text-xl text-text-secondary">
                No one matches “{query}”.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {GROUP_ORDER.map((group) => {
                const items = filteredByGroup.get(group);
                if (!items || items.length === 0) return null;
                const isSearching = query.trim().length > 0;
                const collapsed =
                  showHeaders && !isSearching && !expanded[group] && items.length > COLLAPSE_AFTER;
                const visible = collapsed ? items.slice(0, COLLAPSE_AFTER) : items;
                return (
                  <div key={group}>
                    {showHeaders ? (
                      <p className="mb-1.5 text-caption font-bold uppercase tracking-widest text-text-tertiary">
                        {group}
                      </p>
                    ) : null}
                    <ul className="divide-y divide-divider overflow-hidden rounded-2xl border border-divider bg-card">
                      {visible.map((t, idx) => (
                        <li key={targetKey(t, idx)}>
                          <button
                            type="button"
                            disabled={startMut.isPending}
                            onClick={() => startMut.mutate(t)}
                            className="press-soft flex w-full items-center justify-between gap-3 px-4 py-3 text-left disabled:opacity-60"
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-bold text-text-primary">
                                {t.primaryLabel}
                              </span>
                              {t.secondaryLabel ? (
                                <span className="block truncate text-[12px] text-text-tertiary">
                                  {t.secondaryLabel}
                                </span>
                              ) : null}
                            </span>
                            <span className="text-[11px] font-bold uppercase tracking-widest text-text-tertiary">
                              Message
                            </span>
                          </button>
                        </li>
                      ))}
                      {collapsed ? (
                        <li>
                          <button
                            type="button"
                            onClick={() => setExpanded((s) => ({ ...s, [group]: true }))}
                            className="press-soft flex w-full items-center justify-center gap-2 px-4 py-2.5 text-[11px] font-bold uppercase tracking-widest text-text-secondary"
                          >
                            Show all {items.length}
                          </button>
                        </li>
                      ) : null}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
