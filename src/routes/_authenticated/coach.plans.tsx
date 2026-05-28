import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Plus, ListChecks, Clock, ChevronRight, Search } from "lucide-react";
import { toast } from "sonner";
import { CoachBottomNav } from "@/components/coach/bottom-nav";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  listPlans,
  listCoachAthletes,
  createPlan,
  type PlanSummaryDTO,
  type PlanStatus,
} from "@/lib/plans.functions";
import { listMoves, type MoveDTO } from "@/lib/moves.functions";
import { MoveSheet } from "@/components/coach/move-sheet";

export const Route = createFileRoute("/_authenticated/coach/plans")({
  component: PlansPage,
});

type Tab = "plans" | "library";
type PlanFilter = "active" | "benched" | "templates";

function PlansPage() {
  const [tab, setTab] = useState<Tab>("plans");
  const [planFilter, setPlanFilter] = useState<PlanFilter>("active");
  const [athleteId, setAthleteId] = useState<string>("");
  const [createOpen, setCreateOpen] = useState(false);
  const [moveSelection, setMoveSelection] = useState<string | null>(null);

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
            />
          ) : (
            <LibrarySearchStrip />
          )}
        </header>

        <main className="flex-1 pt-2">
          {tab === "plans" ? (
            <PlansList filter={planFilter} athleteId={athleteId} />
          ) : (
            <LibraryView onSelectMove={(id) => setMoveSelection(id)} />
          )}
        </main>

        <button
          type="button"
          onClick={() => {
            if (tab === "plans") setCreateOpen(true);
            else setMoveSelection("new");
          }}
          aria-label={tab === "plans" ? "New plan" : "New move"}
          className="fixed bottom-24 right-5 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-accent-foreground shadow-page ring-1 ring-black/10 transition active:scale-95"
        >
          <Plus className="h-7 w-7" strokeWidth={2.5} />
        </button>
      </div>

      <CoachBottomNav />

      <CreatePlanSheet open={createOpen} onOpenChange={setCreateOpen} />
      <MoveSheet selection={moveSelection} onOpenChange={setMoveSelection} />
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
}: {
  filter: PlanFilter;
  onFilter: (f: PlanFilter) => void;
  athleteId: string;
  onAthlete: (id: string) => void;
}) {
  const fetchAthletes = useServerFn(listCoachAthletes);
  const { data } = useQuery({
    queryKey: ["coach-athletes"],
    queryFn: () => fetchAthletes(),
  });
  const athletes = data?.athletes ?? [];

  const chip = (key: PlanFilter, label: string) => (
    <button
      key={key}
      type="button"
      onClick={() => onFilter(key)}
      className={cn(
        "whitespace-nowrap rounded-full border px-3 py-1 text-xs font-bold transition",
        filter === key
          ? "border-accent/70 bg-accent text-accent-foreground"
          : "border-divider bg-card text-text-secondary hover:text-text-primary",
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="mt-3 flex items-center gap-2 overflow-x-auto pb-1">
      {chip("active", "Active")}
      {chip("benched", "Benched")}
      {chip("templates", "Templates")}
      <div className="h-4 w-px shrink-0 bg-divider" />
      <select
        value={athleteId}
        onChange={(e) => onAthlete(e.target.value)}
        className="appearance-none border-none bg-transparent pr-5 text-xs font-medium text-text-secondary focus:ring-0"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;charset=US-ASCII,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E\")",
          backgroundRepeat: "no-repeat",
          backgroundPosition: "right center",
          backgroundSize: "12px",
        }}
      >
        <option value="">All athletes</option>
        {athletes.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
    </div>
  );
}

/* ---------------- Plans list ---------------- */

function PlansList({ filter, athleteId }: { filter: PlanFilter; athleteId: string }) {
  const fetchPlans = useServerFn(listPlans);
  const args = useMemo(() => {
    if (filter === "templates") return { kind: "template" as const };
    return {
      kind: "plan" as const,
      status: filter,
      athleteId: athleteId || undefined,
    };
  }, [filter, athleteId]);

  const { data, isLoading } = useQuery({
    queryKey: ["plans", args],
    queryFn: () => fetchPlans({ data: args }),
  });

  if (isLoading) return <ListSkeleton />;
  const plans = data?.plans ?? [];
  if (!plans.length) return <EmptyState message="No plans here yet." />;

  return (
    <ul className="divide-y divide-divider">
      {plans.map((p) => (
        <li key={p.id}>
          <PlanRow plan={p} />
        </li>
      ))}
    </ul>
  );
}

function PlanRow({ plan }: { plan: PlanSummaryDTO }) {
  return (
    <Link
      to="/coach/plans/$planId"
      params={{ planId: plan.id }}
      className={cn(
        "block py-3 transition active:bg-elevated",
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
      <div className="flex items-center gap-4 text-xs font-bold text-text-secondary">
        <span className="flex items-center gap-1">
          <ListChecks className="h-3 w-3 text-text-tertiary" />
          {plan.moveCount} {plan.moveCount === 1 ? "move" : "moves"}
        </span>
        {plan.totalMinutes > 0 ? (
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3 text-text-tertiary" />
            {plan.totalMinutes} min
          </span>
        ) : null}
      </div>
    </Link>
  );
}

function StatusPill({ plan }: { plan: PlanSummaryDTO }) {
  if (plan.kind === "template") {
    return (
      <span className="rounded-sm border border-divider bg-card px-2 py-0.5 text-[10px] font-black uppercase tracking-tight text-text-tertiary">
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
  const tone =
    plan.status === "active"
      ? "bg-accent text-accent-foreground"
      : "bg-elevated text-text-secondary";
  return (
    <span className={cn("rounded-sm px-2 py-0.5 text-[10px] font-black uppercase tracking-tight", tone)}>
      {shortName(plan.athleteName)}
    </span>
  );
}

/* ---------------- Library ---------------- */

function LibrarySearchStrip() {
  // Search lives on the LibraryView; this strip just holds a placeholder spacer
  return <div className="mt-3 h-1" aria-hidden />;
}

function LibraryView() {
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
                  <li key={m.id} className="flex items-start gap-3 py-2.5">
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

function CreatePlanSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const fetchPlans = useServerFn(listPlans);
  const createFn = useServerFn(createPlan);

  const { data: templates } = useQuery({
    queryKey: ["plans", { kind: "template" }],
    queryFn: () => fetchPlans({ data: { kind: "template" } }),
    enabled: open,
  });
  const { data: existing } = useQuery({
    queryKey: ["plans", { kind: "plan-all" }],
    queryFn: () => fetchPlans({ data: { kind: "plan" } }),
    enabled: open,
  });

  const mutation = useMutation({
    mutationFn: createFn,
    onSuccess: ({ id }) => {
      qc.invalidateQueries({ queryKey: ["plans"] });
      onOpenChange(false);
      navigate({ to: "/coach/plans/$planId", params: { planId: id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const startFromScratch = () =>
    mutation.mutate({ data: { kind: "plan", title: "Untitled plan" } });
  const startFromTemplate = (id: string) =>
    mutation.mutate({ data: { kind: "plan", fromTemplateId: id } });
  const duplicate = (id: string) =>
    mutation.mutate({ data: { kind: "plan", fromPlanId: id } });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-display text-2xl">New plan</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-5">
          <Button
            onClick={startFromScratch}
            disabled={mutation.isPending}
            className="h-12 w-full justify-start text-base font-bold"
          >
            <Plus className="mr-2 h-5 w-5" />
            From scratch
          </Button>

          <Section title="From a template">
            {(templates?.plans ?? []).length === 0 ? (
              <p className="text-sm text-text-tertiary">No templates yet.</p>
            ) : (
              <ul className="divide-y divide-divider">
                {templates!.plans.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => startFromTemplate(t.id)}
                      disabled={mutation.isPending}
                      className="flex w-full items-center justify-between py-2.5 text-left"
                    >
                      <span className="font-display text-base font-bold text-text-primary">
                        {t.title}
                      </span>
                      <span className="text-xs font-bold text-text-tertiary">
                        {t.moveCount} moves
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Duplicate an existing plan">
            {(existing?.plans ?? []).length === 0 ? (
              <p className="text-sm text-text-tertiary">No plans yet.</p>
            ) : (
              <ul className="divide-y divide-divider">
                {existing!.plans.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => duplicate(p.id)}
                      disabled={mutation.isPending}
                      className="flex w-full items-center justify-between py-2.5 text-left"
                    >
                      <span className="font-display text-base font-bold text-text-primary">
                        {p.title}
                      </span>
                      <span className="text-xs font-bold text-text-tertiary">
                        {p.athleteName ?? "—"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function NewMoveStub({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom">
        <SheetHeader>
          <SheetTitle className="font-display text-2xl">New move</SheetTitle>
        </SheetHeader>
        <p className="mt-4 text-sm text-text-secondary">
          Move editor coming up next — tap an existing move to edit for now.
        </p>
      </SheetContent>
    </Sheet>
  );
}

/* ---------------- helpers ---------------- */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <p className="mb-1 text-[11px] font-bold uppercase tracking-widest text-text-tertiary">
        {title}
      </p>
      {children}
    </section>
  );
}

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

function targetLabel(kind: "reps" | "minutes", value: number) {
  return kind === "minutes" ? `${value} min` : `${value} reps`;
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
