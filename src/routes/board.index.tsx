import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Tag } from "@/components/ui/tag";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Logo } from "@/components/logo";
import { Chip } from "@/components/ui/chip";
import { BoardAccountSheet } from "@/components/board/board-account-sheet";
import { useAuthReady } from "@/hooks/use-auth-ready";
import { Input } from "@/components/ui/input";
import { listBoards, searchBoards } from "@/lib/board.functions";

const HISTORY_KEY = "gradus.boardHistory";

export const Route = createFileRoute("/board/")({
  head: () => ({
    meta: [
      { title: "Live Boards — Gradus" },
      {
        name: "description",
        content:
          "Live figure skating scoreboards. Search any U.S. Figure Skating IJS competition, scan the QR code at the rink, or pick one you have followed before.",
      },
      { property: "og:title", content: "Gradus Live Boards" },
      {
        property: "og:description",
        content: "Live competition boards: who is on the ice, latest scores, and what is next.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BoardIndex,
});

function BoardIndex() {
  const list = useServerFn(listBoards);
  const { user, isReady } = useAuthReady();
  const [history, setHistory] = useState<{ slug: string; name: string }[]>([]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(HISTORY_KEY);
      setHistory(raw ? (JSON.parse(raw) as { slug: string; name: string }[]) : []);
    } catch {
      setHistory([]);
    }
  }, []);

  const { data } = useQuery({ queryKey: ["boards"], queryFn: () => list() });
  const live = (data ?? []).filter((c) => c.isLiveWindow);

  const search = useServerFn(searchBoards);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query.trim()), 300);
    return () => window.clearTimeout(t);
  }, [query]);
  const searching = debounced.length >= 2;
  const { data: results, isFetching } = useQuery({
    queryKey: ["boards", "search", debounced],
    queryFn: () => search({ data: { q: debounced } }),
    enabled: searching,
    staleTime: 60_000,
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      <header className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <Link to="/" className="press inline-block">
            <Logo className="text-2xl" />
          </Link>
          {isReady && !user ? <BoardAccountSheet redirect="/board" /> : null}
          {isReady && user ? (
            <Chip size="caption" as={Link} to="/" className="press shrink-0">
              Go to My Gradus
            </Chip>
          ) : null}
        </div>
        <h1 className="font-display text-h2 text-text-primary">Live boards</h1>
        <p className="text-sm text-text-secondary">
          Search for a competition, or scan the QR code on the sign at your rink.
        </p>
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search competitions, or paste an IJS link"
          aria-label="Search competitions"
          autoComplete="off"
          enterKeyHint="search"
        />
      </header>

      {searching ? (
        <section className="space-y-2" aria-live="polite">
          <Eyebrow size="caption" tone="tertiary">
            RESULTS
          </Eyebrow>
          {(results ?? []).map((c) => (
            <Link key={c.slug} to="/board/$slug" params={{ slug: c.slug }} className="block press">
              <Card variant="row" className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-display text-base text-text-primary">{c.name}</p>
                  <p className="truncate font-mono text-xs text-text-tertiary">
                    {[c.datesLabel, c.location].filter(Boolean).join(" · ")}
                  </p>
                </div>
                {c.isLiveWindow ? (
                  <Tag size="caption" tone="accent">
                    LIVE
                  </Tag>
                ) : null}
              </Card>
            </Link>
          ))}
          {!isFetching && results && results.length === 0 ? (
            <Card variant="row">
              <p className="text-sm text-text-secondary">
                No competitions match yet. A competition shows up once IJS posts its page, usually
                on its first day. Pasting its IJS link finds it right away.
              </p>
            </Card>
          ) : null}
          {isFetching && !results ? (
            <p className="text-sm text-text-tertiary" role="status">
              Searching…
            </p>
          ) : null}
        </section>
      ) : null}

      {!searching && live.length > 0 ? (
        <section className="space-y-2">
          <Eyebrow size="caption" tone="tertiary">
            HAPPENING NOW
          </Eyebrow>
          {live.map((c) => (
            <Link key={c.slug} to="/board/$slug" params={{ slug: c.slug }} className="block press">
              <Card variant="row" className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-display text-base text-text-primary">{c.name}</p>
                  <p className="truncate font-mono text-xs text-text-tertiary">
                    {[c.datesLabel, c.location].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <Tag size="caption" tone="accent">
                  LIVE
                </Tag>
              </Card>
            </Link>
          ))}
        </section>
      ) : null}

      {!searching && history.length > 0 ? (
        <section className="space-y-2">
          <Eyebrow size="caption" tone="tertiary">
            YOU&apos;VE FOLLOWED
          </Eyebrow>
          {history.map((h) => (
            <Link key={h.slug} to="/board/$slug" params={{ slug: h.slug }} className="block press">
              <Card variant="row">
                <p className="truncate text-sm text-text-primary">{h.name}</p>
              </Card>
            </Link>
          ))}
        </section>
      ) : null}

      {!searching && live.length === 0 && history.length === 0 ? (
        <Card variant="hero">
          <p className="text-sm text-text-secondary">
            No competitions are live right now. Boards appear here once you&apos;ve opened one.
          </p>
        </Card>
      ) : null}
    </div>
  );
}
