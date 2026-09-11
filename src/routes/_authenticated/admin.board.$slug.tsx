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
import { RinkPanel } from "@/components/board/rink-panel";
import {
  MySkaters,
  findMySkaters,
  allEvents,
  type SkaterMatch,
} from "@/components/board/my-skaters";
import { ScheduleBoard } from "@/components/board/schedule-board";
import { FollowSearch } from "@/components/board/follow-search";
import { ScoreSheet, type ScoreEntry } from "@/components/board/score-sheet";
import { EventResults } from "@/components/board/event-results";
import { SegmentedToggle } from "@/components/plans/segmented-toggle";
import { useChangedKeys } from "@/hooks/use-changed-keys";
import { getBoard, getMySkaterNames } from "@/lib/board.functions";
import { normalizeName, type BoardEvent, type BoardSkater } from "@/lib/board-types";

const REFRESH_MS = 30_000;
const FOLLOW_KEY = "gradus.boardFollow";
const EXTRA_KEY = "gradus.boardFollowExtra";

type BoardTab = "mine" | "rinks" | "schedule";

const TABS = [
  { key: "rinks" as const, label: "Live", id: "wall-tab-rinks", controls: "wall-panel-rinks" },
  {
    key: "schedule" as const,
    label: "Schedule",
    id: "wall-tab-schedule",
    controls: "wall-panel-schedule",
  },
  { key: "mine" as const, label: "Following", id: "wall-tab-mine", controls: "wall-panel-mine" },
];

export const Route = createFileRoute("/_authenticated/admin/board/$slug")({
  head: () => ({
    meta: [
      { title: "Wall Display — Gradus Admin" },
      {
        name: "description",
        content: "Every rink of a live competition stacked for a portrait wall display.",
      },
      { property: "og:title", content: "Wall Display — Gradus Admin" },
      {
        property: "og:description",
        content: "Every rink of a live competition stacked for a portrait wall display.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: WallBoardPage,
});

function WallBoardPage() {
  const { slug } = Route.useParams();
  const board = useServerFn(getBoard);
  const mine = useServerFn(getMySkaterNames);
  const [signedIn, setSignedIn] = useState(false);
  const [tab, setTab] = useState<BoardTab | null>(null);
  const [score, setScore] = useState<{
    skater: BoardSkater;
    eventLabel: string;
    entries?: ScoreEntry[];
  } | null>(null);
  const [resultsEvent, setResultsEvent] = useState<BoardEvent | null>(null);
  const [unfollowed, setUnfollowed] = useState<string[]>([]);
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

  const payload = data?.payload ?? null;
  const watched = useMemo(() => [...(myNames ?? []), ...extras], [myNames, extras]);
  const extraKeys = useMemo(() => extras.map(normalizeName), [extras]);
  const matches = useMemo(() => findMySkaters(payload, watched), [payload, watched]);

  const signature = useMemo(() => {
    const sig: Record<string, string> = {};
    for (const m of matches) sig[m.key] = `${m.state}:${m.ahead}:${m.skater.segScore ?? ""}`;
    return sig;
  }, [matches]);
  const changed = useChangedKeys(signature);

  const openByName = useCallback(
    (skater: BoardSkater) => {
      const key = normalizeName(skater.name);
      const entries: ScoreEntry[] = payload
        ? allEvents(payload).flatMap((e) =>
            e.results
              .filter((r) => normalizeName(r.name) === key)
              .map((r) => ({
                skater: r,
                eventLabel: [e.name, e.segment].filter(Boolean).join(" \u00b7 "),
                pendingLabel: e.timeLabel,
              })),
          )
        : [];
      setScore({ skater, eventLabel: entries[0]?.eventLabel ?? "", entries });
    },
    [payload],
  );

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

  const activeTab: BoardTab = tab ?? "rinks";

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
    <div className="mx-auto max-w-2xl space-y-3 px-4 py-4">
      <header className="space-y-1">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Link to="/" className="press">
              <Logo className="text-xl" />
            </Link>
            {data.isLiveWindow ? (
              <Tag size="caption" tone="accent">
                LIVE BOARD
              </Tag>
            ) : (
              <Tag size="caption">FINISHED</Tag>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Chip size="caption" as={Link} to="/admin/competitions" className="press shrink-0">
              Competitions
            </Chip>
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
          id="wall-panel-mine"
          aria-labelledby="wall-tab-mine"
          className="space-y-3"
        >
          <MySkaters
            matches={followedMatches.length > 0 ? followedMatches : matches}
            followed={isFollowed}
            changed={changed}
            onToggleFollow={toggleFollow}
            onOpenScore={(m) =>
              setScore({
                skater: m.skater,
                eventLabel: [m.event.name, m.event.segment].filter(Boolean).join(" · "),
                entries: [
                  {
                    skater: m.skater,
                    eventLabel: [m.event.name, m.event.segment].filter(Boolean).join(" · "),
                    pendingLabel: m.event.timeLabel,
                  },
                ],
              })
            }
            onOpenName={(rows) => openByName(rows[0].skater)}
          />

          <FollowSearch
            payload={payload}
            followedKeys={extraKeys.filter((k) => !unfollowed.includes(k))}
            onFollow={followByName}
            onUnfollow={unfollowByKey}
          />
        </div>
      ) : activeTab === "rinks" ? (
        <div
          role="tabpanel"
          id="wall-panel-rinks"
          aria-labelledby="wall-tab-rinks"
          className="space-y-3"
        >
          {rinks.length > 0 ? (
            rinks.map((r) => <RinkPanel key={r.name} rink={r} onOpenScore={openByName} />)
          ) : (
            <Card variant="section">
              <p className="text-sm text-text-secondary">
                No events scheduled on this day yet. The board fills in as the competition starts.
              </p>
            </Card>
          )}

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
        <div role="tabpanel" id="wall-panel-schedule" aria-labelledby="wall-tab-schedule">
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
        entries={score?.entries}
        onOpenChange={(open) => {
          if (!open) setScore(null);
        }}
      />
    </div>
  );
}
