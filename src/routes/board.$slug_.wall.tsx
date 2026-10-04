import { useCallback, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Tag } from "@/components/ui/tag";
import { Skeleton } from "@/components/ui/skeleton";
import { Logo } from "@/components/logo";
import { RinkPanel } from "@/components/board/rink-panel";
import { ScheduleBoard } from "@/components/board/schedule-board";
import { ScoreSheet } from "@/components/board/score-sheet";
import { EventResults } from "@/components/board/event-results";
import { SegmentedToggle } from "@/components/plans/segmented-toggle";
import { getBoard } from "@/lib/board.functions";
import type { BoardEvent, BoardSkater } from "@/lib/board-types";
import { eventKey, scoreSelectionFor, type ScoreSelection } from "@/lib/board-skaters";

const REFRESH_MS = 30_000;

type WallTab = "rinks" | "schedule";

const TABS = [
  { key: "rinks" as const, label: "Live", id: "wall-tab-rinks", controls: "wall-panel-rinks" },
  {
    key: "schedule" as const,
    label: "Schedule",
    id: "wall-tab-schedule",
    controls: "wall-panel-schedule",
  },
];

export const Route = createFileRoute("/board/$slug_/wall")({
  head: () => ({
    meta: [
      { title: "Wall Display — Gradus" },
      {
        name: "description",
        content: "Every rink of a live competition stacked for a portrait wall display.",
      },
      { property: "og:title", content: "Wall Display — Gradus" },
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
  const [tab, setTab] = useState<WallTab>("rinks");
  const [score, setScore] = useState<ScoreSelection | null>(null);
  const [resultsEvent, setResultsEvent] = useState<BoardEvent | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["board", slug],
    queryFn: () => board({ data: { slug } }),
    refetchInterval: (q) => (q.state.data?.isLiveWindow ? REFRESH_MS : false),
    refetchIntervalInBackground: true,
  });

  const payload = data?.payload ?? null;

  /** Opens a skater's scores, from any surface; `focusKey` is the event tapped from. */
  const openSkater = useCallback(
    (skater: BoardSkater, focusKey?: string | null) =>
      setScore(scoreSelectionFor(payload, skater, focusKey)),
    [payload],
  );

  const rinks = useMemo(() => payload?.rinks ?? [], [payload]);

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
        <div className="flex items-center gap-2">
          <Logo className="text-xl" />
          {data.isLiveWindow ? (
            <Tag size="caption" tone="accent">
              LIVE BOARD
            </Tag>
          ) : (
            <Tag size="caption">FINISHED</Tag>
          )}
        </div>

        <h1 className="font-display text-h3 leading-tight text-text-primary">{data.name}</h1>
        <p className="truncate font-mono text-nano uppercase tracking-wider text-text-tertiary">
          {[data.datesLabel, data.location].filter(Boolean).join(" · ")}
        </p>
      </header>

      <SegmentedToggle label="Board view" value={tab} onChange={(v) => setTab(v)} options={TABS} />

      {tab === "rinks" ? (
        <div
          role="tabpanel"
          id="wall-panel-rinks"
          aria-labelledby="wall-tab-rinks"
          className="space-y-3"
        >
          {rinks.length > 0 ? (
            rinks.map((r) => (
              <RinkPanel
                key={r.name}
                rink={r}
                onOpenScore={(s, rink) =>
                  openSkater(
                    s,
                    rink.current
                      ? eventKey(rink.current.event, rink.current.segment, rink.name)
                      : null,
                  )
                }
                timeZone={payload?.competition.timeZone}
              />
            ))
          ) : (
            <Card variant="section">
              <p className="text-sm text-text-secondary">
                No events scheduled on this day yet. The board fills in as the competition starts.
              </p>
            </Card>
          )}

          <p className="font-mono text-nano uppercase tracking-wider text-text-tertiary">
            {data.generatedAt
              ? `updated ${new Date(data.generatedAt).toLocaleTimeString()}`
              : "not updated yet"}
          </p>
        </div>
      ) : (
        <div role="tabpanel" id="wall-panel-schedule" aria-labelledby="wall-tab-schedule">
          <ScheduleBoard
            schedule={payload?.schedule ?? []}
            myNames={[]}
            onOpenEvent={(e) => setResultsEvent(e)}
            timeZone={payload?.competition.timeZone}
          />
        </div>
      )}

      <EventResults
        event={resultsEvent}
        onOpenChange={(open) => {
          if (!open) setResultsEvent(null);
        }}
        onOpenScore={(s) =>
          openSkater(
            s,
            resultsEvent
              ? eventKey(resultsEvent.name, resultsEvent.segment, resultsEvent.rink)
              : null,
          )
        }
      />

      <ScoreSheet
        selection={score}
        onOpenChange={(open) => {
          if (!open) setScore(null);
        }}
      />
    </div>
  );
}
