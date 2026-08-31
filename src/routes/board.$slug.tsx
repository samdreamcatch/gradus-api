import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Tag } from "@/components/ui/tag";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Skeleton } from "@/components/ui/skeleton";
import { Logo } from "@/components/logo";
import { RinkPanel, untilLabel } from "@/components/board/rink-panel";
import { getBoard, getMySkaterNames } from "@/lib/board.functions";
import { normalizeName, type BoardPayload } from "@/lib/board-types";

const REFRESH_MS = 30_000;
const HISTORY_KEY = "gradus.boardHistory";
const MATCH_KEY = "gradus.boardSkater";

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

/** Find the viewer's own skater in any rink's start order. */
function findMySkater(payload: BoardPayload | null, names: string[]) {
  if (!payload || names.length === 0) return null;
  const wanted = new Set(names.map(normalizeName));
  for (const rink of payload.rinks) {
    const order = rink.current?.startOrder ?? [];
    for (const s of order) {
      if (wanted.has(normalizeName(s.name))) {
        return { rink, skater: s, done: rink.current?.done ?? 0 };
      }
    }
  }
  return null;
}

function BoardPage() {
  const { slug } = Route.useParams();
  const board = useServerFn(getBoard);
  const mine = useServerFn(getMySkaterNames);
  const [signedIn, setSignedIn] = useState(false);
  const [rinkName, setRinkName] = useState<string | null>(null);
  const [matchAnswer, setMatchAnswer] = useState<"yes" | "no" | null>(null);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSignedIn(!!data.session));
  }, []);

  useEffect(() => {
    try {
      setMatchAnswer(
        (window.localStorage.getItem(`${MATCH_KEY}.${slug}`) as "yes" | "no" | null) ?? null,
      );
    } catch {
      setMatchAnswer(null);
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
  const match = useMemo(() => findMySkater(payload, myNames ?? []), [payload, myNames]);

  const rinks = payload?.rinks ?? [];
  const selected =
    rinks.find((r) => r.name === rinkName) ??
    (match ? rinks.find((r) => r.name === match.rink.name) : undefined) ??
    rinks.find((r) => r.state === "live") ??
    rinks[0];

  const answerMatch = (answer: "yes" | "no") => {
    setMatchAnswer(answer);
    try {
      window.localStorage.setItem(`${MATCH_KEY}.${slug}`, answer);
    } catch {
      // ignore
    }
  };

  if (isLoading) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-8">
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
    <div className="mx-auto max-w-2xl space-y-5 px-4 py-6 pb-16">
      <header className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <Link to="/" className="press">
            <Logo className="text-2xl" />
          </Link>
          {data.isLiveWindow ? (
            <Tag size="caption" tone="accent">
              LIVE
            </Tag>
          ) : (
            <Tag size="caption">FINISHED</Tag>
          )}
        </div>
        <h1 className="font-display text-h2 leading-tight text-text-primary">{data.name}</h1>
        <p className="font-mono text-xs text-text-tertiary">
          {[data.datesLabel, data.location].filter(Boolean).join(" · ")}
        </p>
      </header>

      {match && matchAnswer !== "no" ? (
        <Card variant="row" className="border-secondary-accent/50">
          <Eyebrow size="micro" tone="tertiary">
            YOUR SKATER
          </Eyebrow>
          <p className="mt-1 text-base text-text-primary">
            <span className="font-bold">{match.skater.name}</span> skates{" "}
            <span className="font-mono tabular-nums">#{match.skater.start}</span> in{" "}
            {match.rink.name}
            {match.rink.current ? ` — ${match.rink.current.done} have skated so far` : ""}.
          </p>
          {matchAnswer === null ? (
            <div className="mt-3 flex items-center gap-2">
              <span className="text-sm text-text-secondary">Is this your skater?</span>
              <Button type="button" size="sm" onClick={() => answerMatch("yes")}>
                Yes
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => answerMatch("no")}
              >
                Not mine
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-3"
              onClick={() => setRinkName(match.rink.name)}
            >
              Go to {match.rink.name}
            </Button>
          )}
        </Card>
      ) : null}

      {rinks.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          {rinks.map((r) => (
            <Chip
              key={r.name}
              onClick={() => setRinkName(r.name)}
              selected={selected?.name === r.name}
            >
              {r.name}
              {r.state === "live" ? " •" : ""}
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

      {!signedIn ? (
        <p className="text-center text-sm text-text-secondary">
          <Link to="/login" className="underline underline-offset-2">
            Sign in
          </Link>{" "}
          to follow your skater.
        </p>
      ) : null}

      <footer className="space-y-1 border-t border-divider pt-4 font-mono text-xs text-text-tertiary">
        <p>
          &ldquo;On the ice&rdquo; is inferred from the last posted score — IJS does not publish
          who is currently skating, and scores post 1–2 minutes late.
        </p>
        <p>
          {data.generatedAt
            ? `updated ${new Date(data.generatedAt).toLocaleTimeString()}`
            : "not updated yet"}
        </p>
      </footer>
    </div>
  );
}
