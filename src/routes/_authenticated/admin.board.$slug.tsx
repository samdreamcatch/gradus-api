import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Tag } from "@/components/ui/tag";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Skeleton } from "@/components/ui/skeleton";
import { RinkPanel } from "@/components/board/rink-panel";
import { getBoard } from "@/lib/board.functions";
import type { BoardEvent } from "@/lib/board-types";

const REFRESH_MS = 30_000;

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
  component: WallBoard,
});

/** Events still to come today, across every sheet. */
function upcoming(schedule: BoardEvent[]): BoardEvent[] {
  const now = Date.now();
  return schedule
    .filter((e) => e.status === "scheduled" || (e.startIso && new Date(e.startIso).getTime() > now))
    .slice(0, 8);
}

function WallBoard() {
  const { slug } = Route.useParams();
  const board = useServerFn(getBoard);

  const { data, isLoading } = useQuery({
    queryKey: ["board", slug],
    queryFn: () => board({ data: { slug } }),
    refetchInterval: (q) => (q.state.data?.isLiveWindow ? REFRESH_MS : false),
  });

  const payload = data?.payload ?? null;
  const next = useMemo(() => upcoming(payload?.schedule ?? []), [payload]);

  if (isLoading) {
    return (
      <div role="status" aria-busy="true" className="mx-auto max-w-4xl space-y-6 px-6 py-10">
        <span className="sr-only">Loading the wall display</span>
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-72 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-16 text-center">
        <h1 className="font-display text-h2 text-text-primary">No board here</h1>
        <p className="mt-2 text-sm text-text-secondary">
          This competition code isn&apos;t set up. Check the sign and try again.
        </p>
      </div>
    );
  }

  const rinks = payload?.rinks ?? [];

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-8 text-[1.15rem] leading-relaxed">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <Eyebrow size="small" tone="tertiary">
            Wall display
          </Eyebrow>
          {data.isLiveWindow ? (
            <Tag size="caption" tone="accent">
              LIVE
            </Tag>
          ) : (
            <Tag size="caption">FINISHED</Tag>
          )}
          <span className="ml-auto font-mono text-xs text-text-tertiary">
            {data.generatedAt
              ? `updated ${new Date(data.generatedAt).toLocaleTimeString()}`
              : "not updated yet"}
          </span>
        </div>
        <h1 className="font-display text-h1 leading-tight text-text-primary">{data.name}</h1>
        <p className="font-mono text-caption uppercase tracking-wider text-text-tertiary">
          {[data.datesLabel, data.location].filter(Boolean).join(" · ")}
        </p>
      </header>

      {rinks.length > 0 ? (
        <div className="space-y-6">
          {rinks.map((r) => (
            <RinkPanel key={r.name} rink={r} />
          ))}
        </div>
      ) : (
        <Card variant="section">
          <p className="text-sm text-text-secondary">
            No events scheduled on this day yet. The board fills in as the competition starts.
          </p>
        </Card>
      )}

      {next.length > 0 ? (
        <Card variant="section" className="space-y-3">
          <Eyebrow size="caption" tone="tertiary">
            Next up
          </Eyebrow>
          <ul className="divide-y divide-divider">
            {next.map((e) => (
              <li key={`${e.file}-${e.segment}`} className="flex items-baseline gap-3 py-2">
                <span className="w-20 shrink-0 font-mono text-sm tabular-nums text-text-secondary">
                  {e.timeLabel}
                </span>
                <span className="min-w-0 flex-1 font-display leading-snug text-text-primary">
                  {[e.name, e.segment].filter(Boolean).join(" · ")}
                </span>
                <span className="shrink-0 font-mono text-xs uppercase tracking-wider text-text-tertiary">
                  {e.rink}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
