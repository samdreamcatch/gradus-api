import { createFileRoute, Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { Plus, ListChecks, Clock, ChevronRight, Search, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { CoachBottomNav } from "@/components/coach/bottom-nav";
import { VoiceFab } from "@/components/coach/voice-fab";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import {
  listPlans,
  listCoachAthletes,
  listCoachSports,
  createPlan,
  deletePlan,
  type PlanSummaryDTO,
  type PlanStatus,
} from "@/lib/plans.functions";
import { listMoves, type MoveDTO } from "@/lib/moves.functions";
import { MoveSheet } from "@/components/coach/move-sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getSport } from "@/lib/coach-sports";

export const Route = createFileRoute("/_authenticated/coach/plans")({
  codeSplitGroupings: [["component"]],
  component: PlansPage,
});


type Tab = "plans" | "library";
type PlanFilter = "active" | "drafts" | "benched" | "templates";
function PlansPage() {
  const [tab, setTab] = useState<Tab>("plans");
  const [planFilter, setPlanFilter] = useState<PlanFilter>("active");
  const [athleteId, setAthleteId] = useState<string>("");
  const [sport, setSport] = useState<string>("");
  const [moveSelection, setMoveSelection] = useState<string | null>(null);
  const navigate = useNavigate();

  const createFn = useServerFn(createPlan);
  const createDraft = useMutation({
    mutationFn: createFn,
    onSuccess: ({ id }) => {
      navigate({
        to: "/coach/plans/$planId",
        params: { planId: id },
        search: { from: "plus" },
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <div className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 pt-6 pb-32">
        <header className="sticky top-0 z-20 -mx-4 bg-background/90 px-4 pb-3 pt-2 backdrop-blur supports-[backdrop-filter]:bg-background/70">
          <SegmentedToggle tab={tab} onChange={setTab} />
          {tab === "plans" ? (
            <PlansFilterStrip
              filter={planFilter}
              onFilter={setPlanFilter}
              athleteId={athleteId}
              onAthlete={setAthleteId}
              sport={sport}
              onSport={setSport}
            />
          ) : (
            <LibrarySearchStrip />
          )}
        </header>

        <main className="flex-1 pt-2">
          {tab === "plans" ? (
            <PlansList filter={planFilter} athleteId={athleteId} sport={sport} />
          ) : (
            <LibraryView onSelectMove={(id) => setMoveSelection(id)} />
          )}
        </main>


        <button
          type="button"
          disabled={createDraft.isPending}
          onClick={() => {
            if (tab === "plans") {
              const isTemplate = planFilter === "templates";
              createDraft.mutate({
                data: {
                  kind: isTemplate ? "template" : "plan",
                  athleteId: !isTemplate && athleteId ? athleteId : undefined,
                },
              });
            } else setMoveSelection("new");
          }}
          aria-label={tab === "plans" ? "New plan" : "New move"}
          className="fixed bottom-24 right-5 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-accent-foreground shadow-page ring-1 ring-black/10 transition active:scale-95 disabled:opacity-60"
        >
          {createDraft.isPending ? (
            <Loader2 className="h-6 w-6 animate-spin" />
          ) : (
            <Plus className="h-7 w-7" strokeWidth={2.5} />
          )}
        </button>
      </div>

      {tab === "plans" ? <VoiceFab mode="create" /> : null}

      <CoachBottomNav />

      <MoveSheet selection={moveSelection} onOpenChange={setMoveSelection} />

      {/* Plan editor sheet overlay (rendered by the $planId child route) */}
      <Outlet />
    </>
  );
}

/* ---------------- Toggle ---------------- */

function SegmentedToggle({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  const tabs: { key: Tab; label: string }[] = [
    { key: "plans", label: "Plans" },
    { key: "library", label: "Move library" },
  ];

  return (
    <div className="flex rounded-lg bg-divider/40 p-1">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onChange(t.key)}
          className={cn(
            "flex-1 rounded-md py-1.5 text-sm font-bold transition",
            tab === t.key
              ? "bg-card text-text-primary shadow-sm"
              : "text-text-secondary hover:text-text-primary",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/* ---------------- Plans filter ---------------- */

function PlansFilterStrip({
  filter,
  onFilter,
  athleteId,
  onAthlete,
  sport,
  onSport,
}: {
  filter: PlanFilter;
  onFilter: (f: PlanFilter) => void;
  athleteId: string;
  onAthlete: (id: string) => void;
  sport: string;
  onSport: (s: string) => void;
}) {
  const fetchAthletes = useServerFn(listCoachAthletes);
  const fetchSports = useServerFn(listCoachSports);
  const { data: athletesData } = useQuery({
    queryKey: ["coach-athletes"],
    queryFn: () => fetchAthletes(),
  });
  const { data: sportsData } = useQuery({
    queryKey: ["coach-sports"],
    queryFn: () => fetchSports(),
  });
  const athletes = athletesData?.athletes ?? [];
  const sports = sportsData?.sports ?? [];
  const isTemplate = filter === "templates";

  const triggerClass =
    "h-8 w-full rounded-full border-divider bg-card px-3 text-xs font-bold text-text-primary shadow-none";

  return (
    <div className="mt-3 grid grid-cols-3 gap-2">
      <Select value={filter} onValueChange={(v) => onFilter(v as PlanFilter)}>
        <SelectTrigger className={triggerClass} aria-label="Plan type">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="active">Active</SelectItem>
          <SelectItem value="drafts">Drafts</SelectItem>
          <SelectItem value="benched">Benched</SelectItem>
          <SelectItem value="templates">Templates</SelectItem>
        </SelectContent>
      </Select>

      <Select
        value={athleteId || "__all"}
        onValueChange={(v) => onAthlete(v === "__all" ? "" : v)}
        disabled={isTemplate}
      >
        <SelectTrigger className={triggerClass} aria-label="Athlete">
          <SelectValue placeholder="All athletes" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all">All athletes</SelectItem>
          {athletes.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {a.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={sport || "__all"}
        onValueChange={(v) => onSport(v === "__all" ? "" : v)}
        disabled={sports.length === 0}
      >
        <SelectTrigger className={triggerClass} aria-label="Sport">
          <SelectValue placeholder="All sports" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all">All sports</SelectItem>
          {sports.map((s) => (
            <SelectItem key={s} value={s}>
              {getSport(s)?.label ?? s}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/* ---------------- Plans list ---------------- */

function PlansList({
  filter,
  athleteId,
  sport,
}: {
  filter: PlanFilter;
  athleteId: string;
  sport: string;
}) {
  const fetchPlans = useServerFn(listPlans);
  const args = useMemo(() => {
    if (filter === "templates") {
      return { kind: "template" as const, sport: sport || undefined };
    }
    const statusMap = { active: "active", drafts: "draft", benched: "benched" } as const;
    return {
      kind: "plan" as const,
      status: statusMap[filter as "active" | "drafts" | "benched"],
      athleteId: athleteId || undefined,
      sport: sport || undefined,
    };
  }, [filter, athleteId, sport]);


  const { data, isLoading } = useQuery({
    queryKey: ["plans", args],
    queryFn: () => fetchPlans({ data: args }),
  });

  if (isLoading) return <ListSkeleton />;
  const plans = data?.plans ?? [];
  if (!plans.length) return <EmptyState message="No plans here yet." />;

  const deletable = filter === "drafts" || filter === "templates";

  return (
    <ul className="space-y-2">
      {plans.map((p) => (
        <li key={p.id}>
          {deletable ? (
            <SwipeableDeleteRow plan={p}>
              <PlanRow plan={p} />
            </SwipeableDeleteRow>
          ) : (
            <PlanRow plan={p} />
          )}
        </li>
      ))}
    </ul>
  );
}



function SwipeableDeleteRow({
  plan,
  children,
}: {
  plan: PlanSummaryDTO;
  children: React.ReactNode;
}) {
  const qc = useQueryClient();
  const deleteFn = useServerFn(deletePlan);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const startX = useRef(0);
  const startY = useRef(0);
  const lockedAxis = useRef<"x" | "y" | null>(null);

  const REVEAL = 88;
  const TRIGGER = 160;

  const deleteMutation = useMutation({
    mutationFn: deleteFn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["plans"] });
      toast.success("Plan deleted");
    },
    onError: (e: Error) => {
      toast.error(e.message);
      setOffset(0);
    },
  });

  const onPointerDown = (e: React.PointerEvent) => {
    // Ignore right-click; allow mouse, touch, and pen
    if (e.button !== 0 && e.pointerType === "mouse") return;
    startX.current = e.clientX;
    startY.current = e.clientY;
    lockedAxis.current = null;
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    const dx = e.clientX - startX.current;
    const dy = e.clientY - startY.current;
    if (lockedAxis.current === null) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      lockedAxis.current = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (lockedAxis.current === "x") {
        (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      }
    }
    if (lockedAxis.current !== "x") return;
    const next = Math.min(0, dx);
    setOffset(Math.max(next, -TRIGGER - 40));
  };
  const onPointerEnd = (e: React.PointerEvent) => {
    if (!dragging) return;
    setDragging(false);
    try {
      (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
    } catch {
      /* noop */
    }
    if (lockedAxis.current !== "x") {
      setOffset(0);
      return;
    }
    if (offset <= -TRIGGER) {
      setOffset(-REVEAL);
      setConfirmOpen(true);
    } else if (offset <= -REVEAL / 2) {
      setOffset(-REVEAL);
    } else {
      setOffset(0);
    }
  };

  const swiped = offset < -8;

  return (
    <div className="group/swipe relative overflow-hidden">
      <button
        type="button"
        onClick={() => setConfirmOpen(true)}
        aria-label="Delete plan"
        className="absolute inset-y-0 right-0 flex w-[88px] items-center justify-center gap-1 bg-destructive text-destructive-foreground text-xs font-bold uppercase tracking-widest"
      >
        <Trash2 className="h-4 w-4" />
        Delete
      </button>
      <div
        style={{ transform: `translateX(${offset}px)`, touchAction: "pan-y" }}
        className={cn(
          "relative bg-background",
          !dragging && "transition-transform duration-200 ease-out",
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onClickCapture={(e) => {
          if (swiped) {
            e.preventDefault();
            e.stopPropagation();
            setOffset(0);
          }
        }}
      >
        {children}
        {/* Hover affordance for pointer devices */}
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setConfirmOpen(true);
          }}
          aria-label="Delete plan"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-card p-2 text-text-tertiary opacity-0 shadow-sm ring-1 ring-divider transition hover:text-destructive group-hover/swipe:opacity-100 focus:opacity-100"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>


      <AlertDialog
        open={confirmOpen}
        onOpenChange={(v) => {
          setConfirmOpen(v);
          if (!v) setOffset(0);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{plan.title || "this plan"}"?</AlertDialogTitle>
            <AlertDialogDescription>This can't be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                deleteMutation.mutate({ data: { id: plan.id } });
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
function PlanRow({ plan }: { plan: PlanSummaryDTO }) {
  const isActive = plan.kind === "plan" && plan.status === "active";
  return (
    <Link
      to="/coach/plans/$planId"
      params={{ planId: plan.id }}
      className={cn(
        "block rounded-lg border border-divider border-l-[3px] bg-elevated p-4 transition active:bg-card",
        isActive ? "border-l-accent" : "border-l-divider",
        plan.status === "benched" && plan.kind === "plan" && "opacity-70",
      )}
    >
      <div className="mb-1 flex items-start justify-between gap-3">
        <h3 className="font-display text-lg font-black leading-tight tracking-tight text-text-primary">
          {plan.title || "Untitled plan"}
        </h3>
        <span className="shrink-0 pt-1 text-[10px] font-bold uppercase tracking-widest text-text-tertiary">
          {formatRelative(plan.updatedAt)}
        </span>
      </div>
      <div className="mb-2 flex items-center gap-2">
        <StatusPill plan={plan} />
        {plan.kind === "plan" ? (
          <>
            <span className="h-1 w-1 rounded-full bg-text-tertiary" />
            <span className="text-xs font-medium text-text-secondary capitalize">
              {plan.status}
            </span>
          </>
        ) : null}
      </div>
      <div className="flex items-center gap-4 text-xs font-medium text-text-secondary">
        <span className="flex items-center gap-1">
          <ListChecks className="h-3 w-3 text-text-tertiary" />
          {plan.moveCount} {plan.moveCount === 1 ? "move" : "moves"}
        </span>
      </div>
    </Link>
  );
}

function StatusPill({ plan }: { plan: PlanSummaryDTO }) {
  if (plan.kind === "template") {
    return (
      <span className="rounded-sm bg-elevated px-2 py-0.5 text-[10px] font-black uppercase tracking-tight text-text-secondary">
        Template
      </span>
    );
  }
  if (!plan.athleteName) {
    return (
      <span className="rounded-sm bg-elevated px-2 py-0.5 text-[10px] font-black uppercase tracking-tight text-text-secondary">
        Unassigned
      </span>
    );
  }
  return (
    <span className="rounded-sm bg-elevated px-2 py-0.5 text-[10px] font-black uppercase tracking-tight text-text-tertiary">
      {shortName(plan.athleteName)}
    </span>
  );
}

/* ---------------- Library ---------------- */

function LibrarySearchStrip() {
  // Search lives on the LibraryView; this strip just holds a placeholder spacer
  return <div className="mt-3 h-1" aria-hidden />;
}

function LibraryView({ onSelectMove }: { onSelectMove: (id: string) => void }) {
  const fetchMoves = useServerFn(listMoves);
  const { data, isLoading } = useQuery({
    queryKey: ["moves"],
    queryFn: () => fetchMoves(),
  });
  const [query, setQuery] = useState("");
  const [sport, setSport] = useState<string>("");

  const moves = data?.moves ?? [];
  const sports = useMemo(
    () => Array.from(new Set(moves.map((m) => m.sport))).sort(),
    [moves],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return moves.filter((m) => {
      if (sport && m.sport !== sport) return false;
      if (!q) return true;
      return (
        m.name.toLowerCase().includes(q) ||
        m.category.toLowerCase().includes(q) ||
        m.cue.toLowerCase().includes(q)
      );
    });
  }, [moves, query, sport]);

  const grouped = useMemo(() => {
    const map = new Map<string, MoveDTO[]>();
    for (const m of filtered) {
      const arr = map.get(m.category) ?? [];
      arr.push(m);
      map.set(m.category, arr);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  if (isLoading) return <ListSkeleton />;

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search moves"
            className="h-9 pl-9"
          />
        </div>
      </div>
      {sports.length > 1 ? (
        <div className="mb-3 flex items-center gap-2 overflow-x-auto pb-1">
          <FilterChip active={sport === ""} onClick={() => setSport("")}>
            All
          </FilterChip>
          {sports.map((s) => (
            <FilterChip key={s} active={sport === s} onClick={() => setSport(s)}>
              {s}
            </FilterChip>
          ))}
        </div>
      ) : null}

      {grouped.length === 0 ? (
        <EmptyState
          message={
            moves.length === 0
              ? "Your move library is empty. Add a move with + or set up sports in your profile to load the starter move library."
              : query.trim() || sport
                ? "No moves match your filters."
                : "No moves match."
          }
        />
      ) : (
        <div className="space-y-5">
          {grouped.map(([cat, items]) => (
            <section key={cat}>
              <h3 className="mb-1 font-display text-base font-bold text-text-primary">
                {cat}
              </h3>
              <ul className="divide-y divide-divider border-y border-divider">
                {items.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => onSelectMove(m.id)}
                      className="flex w-full items-start gap-3 py-2.5 text-left transition active:bg-elevated"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-bold text-text-primary">
                            {m.name}
                          </p>
                          <span className="shrink-0 rounded-sm bg-elevated px-1.5 py-0.5 text-[10px] font-black uppercase tracking-tight text-text-secondary">
                            {targetLabel(m.defaultTargetKind, m.defaultTargetValue)}
                          </span>
                        </div>
                        {m.cue ? (
                          <p className="mt-0.5 line-clamp-1 text-xs text-text-secondary">
                            {m.cue}
                          </p>
                        ) : null}
                      </div>
                      <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-text-tertiary" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "whitespace-nowrap rounded-full border px-3 py-1 text-xs font-bold transition",
        active
          ? "border-accent/70 bg-accent text-accent-foreground"
          : "border-divider bg-card text-text-secondary hover:text-text-primary",
      )}
    >
      {children}
    </button>
  );
}

/* ---------------- Create plan sheet ---------------- */



/* ---------------- helpers ---------------- */

function EmptyState({ message }: { message: string }) {
  return (
    <div className="py-12 text-center">
      <p className="text-sm text-text-secondary">{message}</p>
    </div>
  );
}

function ListSkeleton() {
  return (
    <ul className="divide-y divide-divider">
      {[0, 1, 2].map((i) => (
        <li key={i} className="py-4">
          <div className="mb-2 h-5 w-2/3 rounded bg-elevated" />
          <div className="h-3 w-1/3 rounded bg-elevated" />
        </li>
      ))}
    </ul>
  );
}

function targetLabel(kind: "reps" | "mins", value: number) {
  return kind === "mins" ? `${value} mins` : `${value} reps`;
}

function shortName(full: string) {
  const parts = full.split(" ").filter(Boolean);
  if (parts.length <= 1) return full;
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

function _statusToLabel(s: PlanStatus) {
  return s === "active" ? "Active" : "Benched";
}

function formatRelative(iso: string) {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
