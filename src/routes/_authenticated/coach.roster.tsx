import { useMemo, useRef, useState } from "react";
import {
  UserPlus,
  Sparkles,
  Plus,
  Share2,
  KeyRound,
  ChevronRight,
  ChevronLeft,
} from "lucide-react";
import { queryOptions, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { CoachBottomNav } from "@/components/coach/bottom-nav";
import { PageTitle } from "@/components/page-title";

import { RosterCard } from "@/components/coach/roster-card";
import { FilterPill } from "@/components/ui/filter-pill";
import { getSport, type SportKey } from "@/lib/coach-sports";
import { WeekScheduleView, type WeekScheduleHandle } from "@/components/coach/week-schedule-view";
import { AthleteDetailSheet } from "@/components/coach/athlete-detail-sheet";
import { BillingTab } from "@/components/coach/billing-tab";

import { InviteCard } from "@/components/onboarding/invite-card";
import { EnterInviteCodeCard } from "@/components/coach/enter-invite-code-card";
import { AddYouthAthleteCard } from "@/components/coach/add-youth-athlete-card";

import { Button } from "@/components/ui/button";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

import { cn } from "@/lib/utils";
import { getCoachRoster } from "@/lib/coach-roster.functions";
import { listPlans } from "@/lib/plans.functions";
import {
  getRosterPracticeSummaries,
  type AthletePracticeSummary,
} from "@/lib/coach-schedule.functions";
import { coachProfileQueryOptions } from "@/hooks/use-coach-profile";
import { isCoachProAvailable } from "@/lib/paywall-flag";
import {
  buildSamplePracticeSummary,
  buildSampleRosterAthlete,
  SAMPLE_SPORT,
} from "@/data/sample-athlete";
import { useSampleAthleteDismissed } from "@/hooks/use-sample-athlete";
import { useVisualViewport } from "@/hooks/use-visual-viewport";

type RosterTab = "athletes" | "schedule" | "billing";

type InviteStep = "hub" | "share" | "code";

/** The two ways a coach can connect with an athlete, shown as a hub menu. */
const INVITE_STEPS: {
  key: Exclude<InviteStep, "hub">;
  title: string;
  description: string;
  icon: typeof Share2;
}[] = [
  {
    key: "share",
    title: "Share my invite",
    description: "Send parents or athletes a link or code",
    icon: Share2,
  },
  {
    key: "code",
    title: "Enter their code",
    description: "They already gave you an 8-character code",
    icon: KeyRound,
  },
];

function SegmentedToggle({ tab, onChange }: { tab: RosterTab; onChange: (t: RosterTab) => void }) {
  const tabs: { key: RosterTab; label: string }[] = [
    { key: "schedule", label: "Schedule" },
    { key: "athletes", label: "Athletes" },
    { key: "billing", label: "Billing" },
  ];

  return (
    <div className="flex rounded-lg border border-foreground/15 bg-popover p-1 shadow-sm">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onChange(t.key)}
          className={cn(
            "press-soft flex-1 rounded-md py-1.5 text-sm font-bold",
            tab === t.key ? "bg-accent text-accent-foreground shadow-sm" : "text-text-secondary",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

const rosterQueryOptions = queryOptions({
  queryKey: ["coach", "roster"],
  queryFn: () => getCoachRoster(),
});

export const Route = createFileRoute("/_authenticated/coach/roster")({
  loader: ({ context }) => context.queryClient.ensureQueryData(rosterQueryOptions),
  component: RosterPage,
  errorComponent: ({ error }) => (
    <div className="mx-auto max-w-3xl px-4 pt-8 pb-24" role="alert">
      <PageTitle>Roster</PageTitle>
      <p className="mt-4 text-text-secondary">Couldn't load your roster: {error.message}</p>
      <CoachBottomNav />
    </div>
  ),
  notFoundComponent: () => (
    <div className="mx-auto max-w-3xl px-4 pt-8 pb-24">
      <p>Roster not found.</p>
      <CoachBottomNav />
    </div>
  ),
});

function RosterPage() {
  const { data: roster } = useSuspenseQuery(rosterQueryOptions);
  const { data: coachProfile } = useQuery(coachProfileQueryOptions);
  const { coachSports } = roster;
  const { dismissed: sampleDismissed } = useSampleAthleteDismissed();

  // Figure skating coaches with an empty roster see a sample athlete so the
  // app has real-looking content before anyone joins. Purely client-side.
  const showSample =
    roster.athletes.length === 0 && coachSports.includes(SAMPLE_SPORT) && !sampleDismissed;

  const athletes = useMemo(
    () => (showSample ? [buildSampleRosterAthlete()] : roster.athletes),
    [showSample, roster.athletes],
  );
  const router = useRouter();
  const navigate = useNavigate();
  const coachProAvailable = isCoachProAvailable();
  const [tab, setTab] = useState<RosterTab>("schedule");
  const [selectedSport, setSelectedSport] = useState<string | null>(null);
  const [selectedAthleteId, setSelectedAthleteId] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteStep, setInviteStep] = useState<InviteStep>("hub");
  const scheduleRef = useRef<WeekScheduleHandle>(null);
  const vv = useVisualViewport();

  const athleteLimit = coachProfile?.profile.athleteLimit ?? null;
  const rosterFull = athleteLimit !== null && roster.athletes.length >= athleteLimit;

  const sports = useMemo(() => {
    const set = new Set<string>(coachSports);
    for (const a of athletes) if (a.sport) set.add(a.sport);
    return [...set].sort();
  }, [athletes, coachSports]);

  const visibleAthletes = useMemo(() => {
    if (!selectedSport) return athletes;
    return athletes.filter((a) => a.sport === selectedSport);
  }, [athletes, selectedSport]);

  const practiceQuery = useQuery({
    queryKey: ["coach", "roster", "practice-summaries"],
    queryFn: () => getRosterPracticeSummaries(),
    enabled: tab === "schedule" && !showSample && roster.athletes.length > 0,
    staleTime: 60_000,
  });

  const summariesByAthlete = useMemo(() => {
    const m = new Map<string, AthletePracticeSummary>();
    for (const s of practiceQuery.data ?? []) m.set(s.athleteId, s);
    if (showSample) {
      const sample = buildSamplePracticeSummary();
      m.set(sample.athleteId, sample);
    }
    return m;
  }, [practiceQuery.data, showSample]);

  return (
    <>
      <div className="mx-auto flex min-h-dvh max-w-3xl flex-col px-3 pt-4 pb-24">
        <Sheet
          open={inviteOpen}
          onOpenChange={(o) => {
            setInviteOpen(o);
            setInviteStep("hub");
          }}
        >
          <header className="sticky top-0 z-20 -mx-3 bg-background/90 px-3 pb-2 pt-1 backdrop-blur supports-[backdrop-filter]:bg-background/70">
            <SegmentedToggle tab={tab} onChange={setTab} />

            <div className="mt-3 flex items-center gap-2">
              {athletes.length > 0 && sports.length > 0 ? (
                <div className="min-w-0 flex-1">
                  <FilterPill
                    aria-label="Sport"
                    value={selectedSport ?? "__all"}
                    onValueChange={(v) => setSelectedSport(v === "__all" ? null : v)}
                    placeholder="All sports"
                    options={[
                      { value: "__all", label: "All sports" },
                      ...sports.map((s) => ({
                        value: s,
                        label: getSport(s as SportKey)?.label ?? s,
                      })),
                    ]}
                  />
                </div>
              ) : (
                <div className="flex-1" />
              )}

              <div className="min-w-0 flex-1">
                <SheetTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full"
                    disabled={rosterFull}
                    title={
                      rosterFull
                        ? `Roster full (${roster.athletes.length}/${athleteLimit})`
                        : athleteLimit !== null
                          ? `${roster.athletes.length}/${athleteLimit} athletes`
                          : undefined
                    }
                  >
                    <UserPlus className="size-4" aria-hidden />
                    <span className="truncate">Add athlete</span>
                  </Button>
                </SheetTrigger>
              </div>

              <div className="min-w-0 flex-1">
                {tab === "schedule" && athletes.length > 0 ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => scheduleRef.current?.openCreateLesson()}
                  >
                    <Plus className="size-4" aria-hidden />
                    <span className="truncate">Add event</span>
                  </Button>
                ) : null}
              </div>
            </div>
          </header>

          <FirstPlanBanner />

          {rosterFull ? (
            <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-divider bg-elevated px-3 py-2">
              <div className="text-sm font-bold text-text-primary">
                Your athlete roster is full — {roster.athletes.length} / {athleteLimit}
              </div>
              <Button
                size="sm"
                variant={coachProAvailable ? "default" : "outline"}
                disabled={!coachProAvailable}
                onClick={() => navigate({ to: "/coach/paywall", search: { tier: "coach_pro" } })}
                className="shrink-0"
              >
                {coachProAvailable ? "Upgrade" : "Upgrade · Soon"}
              </Button>
            </div>
          ) : null}

          <SheetContent
            side="bottom"
            className="paper-surface overflow-y-auto"
            style={{ bottom: vv.keyboardInset, maxHeight: Math.round(vv.height * 0.9) }}
          >
            {inviteStep === "hub" ? (
              <>
                <SheetHeader>
                  <SheetTitle>Add an athlete</SheetTitle>
                  <SheetDescription>Three ways to connect.</SheetDescription>
                </SheetHeader>
                <div className="mt-4 overflow-hidden rounded-xl border border-divider bg-elevated">
                  {INVITE_STEPS.map((s, i) => {
                    const Icon = s.icon;
                    return (
                      <button
                        key={s.key}
                        type="button"
                        onClick={() => setInviteStep(s.key)}
                        className={cn(
                          "press flex w-full items-center gap-3 px-4 py-4 text-left",
                          i > 0 && "border-t border-divider",
                        )}
                      >
                        <Icon className="size-5 shrink-0 text-accent-ink" aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-bold text-text-primary">
                            {s.title}
                          </span>
                          <span className="mt-0.5 block text-xs text-text-secondary">
                            {s.description}
                          </span>
                        </span>
                        <ChevronRight className="size-4 shrink-0 text-text-tertiary" aria-hidden />
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              <>
                <SheetHeader>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Back"
                      onClick={() => setInviteStep("hub")}
                      className="-ml-2 shrink-0"
                    >
                      <ChevronLeft className="size-5" aria-hidden />
                    </Button>
                    <SheetTitle className="min-w-0 flex-1">
                      {INVITE_STEPS.find((s) => s.key === inviteStep)?.title}
                    </SheetTitle>
                  </div>
                  <SheetDescription className="sr-only">
                    {INVITE_STEPS.find((s) => s.key === inviteStep)?.description}
                  </SheetDescription>
                </SheetHeader>
                <div className="mt-4">
                  {inviteStep === "share" ? (
                    <InviteCard compact />
                  ) : inviteStep === "code" ? (
                    <EnterInviteCodeCard hideIntro onSuccess={() => setInviteOpen(false)} />
                  ) : (
                    <AddYouthAthleteCard hideHeading onSuccess={() => setInviteOpen(false)} />
                  )}
                </div>
              </>
            )}
          </SheetContent>
        </Sheet>

        {tab === "billing" ? (
          <BillingTab
            athletes={visibleAthletes}
            locked={(coachProfile?.profile.effectiveTier ?? "coach") === "coach"}
          />
        ) : tab === "athletes" ? (
          athletes.length === 0 ? (
            <div className="mt-8 rounded-2xl bg-card p-6 shadow-[0_10px_40px_-12px_rgba(0,0,0,0.15)] sm:p-8">
              <div>
                <h2 className="font-display text-xl text-text-primary">No athletes yet</h2>
                <p className="mt-2 text-sm text-text-secondary">
                  Share your invite code with parents — once they link their athlete to you, they'll
                  show up here.
                </p>
                <div className="mt-5">
                  <InviteCard />
                </div>
                <div className="mt-5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => router.invalidate()}
                  >
                    Refresh
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <ul className="mt-5 space-y-3">
              {visibleAthletes.map((a) => (
                <li key={a.athleteId}>
                  <RosterCard athlete={a} onSelect={setSelectedAthleteId} />
                </li>
              ))}
            </ul>
          )
        ) : (
          <WeekScheduleView
            ref={scheduleRef}
            athletes={visibleAthletes}
            summariesByAthlete={summariesByAthlete}
            onSelectAthlete={setSelectedAthleteId}
            hideInlineCreateButton
          />
        )}
      </div>
      <CoachBottomNav />
      <AthleteDetailSheet athleteId={selectedAthleteId} onOpenChange={setSelectedAthleteId} />
    </>
  );
}

function FirstPlanBanner() {
  const { data: plans } = useQuery({
    queryKey: ["coach", "plans", "any"],
    queryFn: () => listPlans({ data: {} }),
    staleTime: 60_000,
  });
  if (!plans || plans.plans.length > 0) return null;
  return (
    <Link
      to="/coach/plans"
      className="press mt-4 flex items-center gap-3 rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 text-sm"
    >
      <Sparkles className="size-5 shrink-0 text-accent-ink" aria-hidden />
      <div>
        <p className="font-semibold text-text-primary">Create your first plan</p>
        <p className="mt-0.5 text-text-secondary">
          Build a training plan to share with an athlete.
        </p>
      </div>
    </Link>
  );
}
