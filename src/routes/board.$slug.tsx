import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Tag } from "@/components/ui/tag";
import { Skeleton } from "@/components/ui/skeleton";
import { Logo } from "@/components/logo";
import { RinkPanel, untilLabel } from "@/components/board/rink-panel";
import { MySkaters, findMySkaters, type SkaterMatch } from "@/components/board/my-skaters";
import { ScheduleBoard } from "@/components/board/schedule-board";
import { FollowSearch } from "@/components/board/follow-search";
import { BoardAccountSheet } from "@/components/board/board-account-sheet";
import { ScoreSheet } from "@/components/board/score-sheet";
import { EventResults } from "@/components/board/event-results";
import { SegmentedToggle } from "@/components/plans/segmented-toggle";
import { useChangedKeys } from "@/hooks/use-changed-keys";
import { getBoard, getMySkaterNames } from "@/lib/board.functions";
import { normalizeName, type BoardEvent, type BoardSkater } from "@/lib/board-types";

const REFRESH_MS = 30_000;
const HISTORY_KEY = "gradus.boardHistory";
const FOLLOW_KEY = "gradus.boardFollow";
const EXTRA_KEY = "gradus.boardFollowExtra";

type BoardTab = "mine" | "rinks" | "schedule";

const TABS = [
  {
    key: "rinks" as const,
    label: "Live",
    id: "board-tab-rinks",
    controls: "board-panel-rinks",
  },
  {
    key: "schedule" as const,
    label: "Schedule",
    id: "board-tab-schedule",
    controls: "board-panel-schedule",
  },
  { key: "mine" as const, label: "Following", id: "board-tab-mine", controls: "board-panel-mine" },
];

export const Route = createFileRoute("/board/$slug")({
  head: () => ({
    meta: [
      { title: "Live Board — Gradus" },
      {
        name: "description",
        content:
          "A live figure skating scoreboard: who is on the ice, the latest score, who is up next, and when the next event starts.",
      },
      { property: "og:title", content: "Gradus Live Board" },
      {
        property: "og:description",
        content: "Follow the competition live — current skater, scores, and what is coming up.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BoardPage,
});

function rememberVisit(slug: string, name: string) {
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    const list = (raw ? (JSON.parse(raw) as { slug: string; name: string }[]) : []).filter(
      (e) => e.slug !== slug,
    );
    list.unshift({ slug, name });
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 20)));
  } catch {
    // History is a convenience; storage failures are not worth surfacing.
  }
}

function BoardPage() {
  const { slug } = Route.useParams();
  const board = useServerFn(getBoard);
  const mine = useServerFn(getMySkaterNames);
  const [signedIn, setSignedIn] = useState(false);
  const [rinkName, setRinkName] = useState<string | null>(null);
  const [tab, setTab] = useState<BoardTab | null>(null);
  const [score, setScore] = useState<{ skater: BoardSkater; eventLabel: string } | null>(null);
  const [resultsEvent, setResultsEvent] = useState<BoardEvent | null>(null);
  /** Names the viewer has muted for this competition. Absent = following. */
  const [unfollowed, setUnfollowed] = useState<string[]>([]);
  /** Skaters the viewer added by hand — no account or connection required. */
  const [extras, setExtras] = useState<string[]>([]);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSignedIn(!!data.session));
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(`${FOLLOW_KEY}.${slug}`);
      setUnfollowed(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      setUnfollowed([]);
    }
    try {
      const raw = window.localStorage.getItem(`${EXTRA_KEY}.${slug}`);
      setExtras(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      setExtras([]);
    }
  }, [slug]);

  const { data, isLoading } = useQuery({
    queryKey: ["board", slug],
    queryFn: () => board({ data: { slug } }),
    refetchInterval: (q) => (q.state.data?.isLiveWindow ? REFRESH_MS : false),
    refetchIntervalInBackground: false,
  });

  const { data: myNames } = useQuery({
    queryKey: ["board-my-skaters"],
    queryFn: () => mine(),
    enabled: signedIn,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (data?.name) rememberVisit(slug, data.name);
  }, [slug, data?.name]);

  const payload = data?.payload ?? null;
  const watched = useMemo(() => [...(myNames ?? []), ...extras], [myNames, extras]);
  const extraKeys = useMemo(() => extras.map(normalizeName), [extras]);
  const matches = useMemo(() => findMySkaters(payload, watched), [payload, watched]);

  // Flash a card when its state moves — the flight-board flip.
  const signature = useMemo(() => {
    const sig: Record<string, string> = {};
    for (const m of matches) sig[m.key] = `${m.state}:${m.ahead}:${m.skater.segScore ?? ""}`;
    return sig;
  }, [matches]);
  const changed = useChangedKeys(signature);

  const isFollowed = useCallback(
    (m: SkaterMatch) => !unfollowed.includes(normalizeName(m.skater.name)),
    [unfollowed],
  );

  const saveExtras = useCallback(
    (next: string[]) => {
      setExtras(next);
      try {
        window.localStorage.setItem(`${EXTRA_KEY}.${slug}`, JSON.stringify(next));
      } catch {
        // Following is a local preference; storage failures are silent.
      }
    },
    [slug],
  );

  const saveUnfollowed = useCallback(
    (next: string[]) => {
      setUnfollowed(next);
      try {
        window.localStorage.setItem(`${FOLLOW_KEY}.${slug}`, JSON.stringify(next));
      } catch {
        // Following is a local preference; storage failures are silent.
      }
    },
    [slug],
  );

  const followByName = useCallback(
    (name: string) => {
      const key = normalizeName(name);
      if (!extraKeys.includes(key)) saveExtras([...extras, name]);
      saveUnfollowed(unfollowed.filter((n) => n !== key));
    },
    [extras, extraKeys, unfollowed, saveExtras, saveUnfollowed],
  );

  const unfollowByKey = useCallback(
    (key: string) => {
      if (extraKeys.includes(key)) {
        saveExtras(extras.filter((n) => normalizeName(n) !== key));
        return;
      }
      if (!unfollowed.includes(key)) saveUnfollowed([...unfollowed, key]);
    },
    [extras, extraKeys, unfollowed, saveExtras, saveUnfollowed],
  );

  const toggleFollow = useCallback(
    (m: SkaterMatch) => {
      const key = normalizeName(m.skater.name);
      if (unfollowed.includes(key)) {
        saveUnfollowed(unfollowed.filter((n) => n !== key));
        return;
      }
      unfollowByKey(key);
    },
    [unfollowed, saveUnfollowed, unfollowByKey],
  );

  const followedMatches = useMemo(() => matches.filter(isFollowed), [matches, isFollowed]);
  const rinks = payload?.rinks ?? [];
  const firstRink = followedMatches[0]?.event.rink ?? matches[0]?.event.rink;
  const selected =
    rinks.find((r) => r.name === rinkName) ??
    rinks.find((r) => r.name === firstRink) ??
    rinks.find((r) => r.state === "live") ??
    rinks[0];

  // Land where the viewer has something to look at: their own skaters if any.
  const activeTab: BoardTab = tab ?? (matches.length > 0 ? "mine" : "rinks");

  const goToRink = useCallback((name: string) => {
    setRinkName(name);
    setTab("rinks");
  }, []);

  // A short spoken version of whatever just flipped on screen.
  const announcement = useMemo(() => {
    const moved = matches.filter((m) => changed.has(m.key));
    if (moved.length === 0) return "";
    return moved
      .map((m) => {
        if (m.state === "scored" && m.skater.segScore)
          return `${m.skater.name} scored ${m.skater.segScore}${m.skater.place ? `, currently ${m.skater.place}` : ""}`;
        if (m.state === "on-ice") return `${m.skater.name} is on the ice at ${m.event.rink}`;
        if (m.state === "up-next") return `${m.skater.name} is up next at ${m.event.rink}`;
        return `${m.skater.name}: ${m.ahead} ahead at ${m.event.rink}`;
      })
      .join(". ");
  }, [matches, changed]);

  if (isLoading) {
    return (
      <div role="status" aria-busy="true" className="mx-auto max-w-2xl space-y-4 px-4 py-8">
        <span className="sr-only">Loading the live board</span>
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="font-display text-h2 text-text-primary">No board here</h1>
        <p className="mt-2 text-sm text-text-secondary">
          This competition code isn&apos;t set up. Check the sign and try again.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-3 px-4 py-4 pb-12">
      <header className="space-y-1">
        <div className="flex items-center justify-between gap-3">
          <Link to="/" className="press">
            <Logo className="text-xl" />
          </Link>
          <div className="flex shrink-0 items-center gap-2">
            {data.isLiveWindow ? (
              <Tag size="caption" tone="accent">
                LIVE
              </Tag>
            ) : (
              <Tag size="caption">FINISHED</Tag>
            )}
            {signedIn ? (
              <Chip size="caption" as={Link} to="/" className="press shrink-0">
                My Gradus
              </Chip>
            ) : (
              <BoardAccountSheet redirect={`/board/${slug}`} />
            )}
          </div>
        </div>
        <h1 className="font-display text-h3 leading-tight text-text-primary">{data.name}</h1>
        <p className="truncate font-mono text-nano uppercase tracking-wider text-text-tertiary">
          {[data.datesLabel, data.location].filter(Boolean).join(" · ")}
        </p>
      </header>

      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>

      <SegmentedToggle
        label="Board view"
        value={activeTab}
        onChange={(v) => setTab(v)}
        options={TABS}
      />

      {activeTab === "mine" ? (
        <div
          role="tabpanel"
          id="board-panel-mine"
          aria-labelledby="board-tab-mine"
          className="space-y-3"
        >
          <MySkaters
            matches={followedMatches.length > 0 ? followedMatches : matches}
            followed={isFollowed}
            changed={changed}
            onToggleFollow={toggleFollow}
            onSelectRink={goToRink}
            onOpenScore={(m) =>
              setScore({
                skater: m.skater,
                eventLabel: [m.event.name, m.event.segment].filter(Boolean).join(" · "),
              })
            }
          />

          <FollowSearch
            payload={payload}
            followedKeys={extraKeys.filter((k) => !unfollowed.includes(k))}
            onFollow={followByName}
            onUnfollow={unfollowByKey}
          />

          {!signedIn ? (
            <Card variant="section" className="space-y-2 text-center">
              <p className="font-display text-base text-text-primary">
                Sign in and your skaters show up here
              </p>
              <p className="text-sm text-text-secondary">
                Your connected athletes appear automatically, and you&apos;ll get live updates
                while you use the app.
              </p>
              <div className="flex justify-center pt-1">
                <BoardAccountSheet redirect={`/board/${slug}`} label="Sign in or sign up" />
              </div>
            </Card>
          ) : null}
        </div>
      ) : activeTab === "rinks" ? (
        <div
          role="tabpanel"
          id="board-panel-rinks"
          aria-labelledby="board-tab-rinks"
          className="space-y-3"
        >
          {rinks.length > 1 ? (
            <div className="flex flex-wrap gap-2">
              {rinks.map((r) => (
                <Chip
                  key={r.name}
                  onClick={() => setRinkName(r.name)}
                  selected={selected?.name === r.name}
                  aria-pressed={selected?.name === r.name}
                >
                  {r.name}
                  {r.state === "live" ? (
                    <>
                      <span aria-hidden="true"> •</span>
                      <span className="sr-only"> live</span>
                    </>
                  ) : null}
                </Chip>
              ))}
            </div>
          ) : null}

          {selected ? (
            <RinkPanel rink={selected} />

          ) : (
            <Card variant="section">
              <p className="text-sm text-text-secondary">
                No events scheduled on this day yet. The board fills in as the competition starts.
              </p>
            </Card>
          )}

          {selected?.next && !selected.current ? (
            <p className="text-center font-mono text-xs text-text-tertiary">
              next event {untilLabel(selected.next.startIso)}
            </p>
          ) : null}

          <details className="font-mono text-nano text-text-tertiary">
            <summary className="press-soft cursor-pointer uppercase tracking-wider">
              How this board works
            </summary>
            <p className="mt-2">
              &ldquo;On the ice&rdquo; is inferred from the last posted score — IJS does not publish
              who is currently skating, and scores post 1–2 minutes late.
            </p>
            <p className="mt-1">
              {data.generatedAt
                ? `updated ${new Date(data.generatedAt).toLocaleTimeString()}`
                : "not updated yet"}
            </p>
          </details>
        </div>
      ) : (
        <div role="tabpanel" id="board-panel-schedule" aria-labelledby="board-tab-schedule">
          <ScheduleBoard
            schedule={payload?.schedule ?? []}
            myNames={watched}
            onOpenEvent={(e) => setResultsEvent(e)}
          />
        </div>
      )}

      <EventResults
        event={resultsEvent}
        onOpenChange={(open) => {
          if (!open) setResultsEvent(null);
        }}
        onOpenScore={(s) =>
          setScore({
            skater: s,
            eventLabel: [resultsEvent?.name, resultsEvent?.segment].filter(Boolean).join(" · "),
          })
        }
      />

      <ScoreSheet
        skater={score?.skater ?? null}
        eventLabel={score?.eventLabel ?? ""}
        onOpenChange={(open) => {
          if (!open) setScore(null);
        }}
      />
    </div>
  );
}
