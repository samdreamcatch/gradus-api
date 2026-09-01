import { useEffect, useMemo, useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, X } from "lucide-react";
import { getBoard, getMySkaterNames } from "@/lib/board.functions";
import { normalizeName } from "@/lib/board-types";
import { findMySkaters, type SkaterMatch } from "@/components/board/my-skaters";
import {
  dismissBanner,
  isBannerDismissed,
  readBoardHistory,
  readExtraFollows,
  readUnfollowed,
} from "@/lib/board-follow-store";

const REFRESH_MS = 30_000;
const PRIORITY: Record<SkaterMatch["state"], number> = {
  "on-ice": 0,
  "up-next": 1,
  scored: 2,
  waiting: 3,
  scheduled: 4,
};

function line(m: SkaterMatch): string | null {
  const first = m.skater.name.split(" ")[0] || m.skater.name;
  if (m.state === "on-ice") return `${first} is on the ice — ${m.event.rink}`;
  if (m.state === "up-next") return `${first} is up next — ${m.event.rink}`;
  if (m.state === "scored" && m.skater.segScore)
    return `${first} scored ${m.skater.segScore}${m.skater.place ? ` — ${m.skater.place}` : ""}`;
  return null;
}

/**
 * Slim sticky bar shown on any signed-in page while a competition the viewer
 * follows on this device is live. Mirrors the running-session pill so the two
 * never compete for attention.
 */
export function FollowingBanner() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const board = useServerFn(getBoard);
  const mine = useServerFn(getMySkaterNames);

  const [slug, setSlug] = useState<string | null>(null);
  const [extras, setExtras] = useState<string[]>([]);
  const [unfollowed, setUnfollowed] = useState<string[]>([]);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const recent = readBoardHistory()[0];
    if (!recent) return;
    setSlug(recent.slug);
    setExtras(readExtraFollows(recent.slug));
    setUnfollowed(readUnfollowed(recent.slug));
    setDismissed(isBannerDismissed(recent.slug));
  }, []);

  const onBoard = pathname.startsWith("/board");
  const enabled = !!slug && !dismissed && !onBoard;

  const { data } = useQuery({
    queryKey: ["board", slug],
    queryFn: () => board({ data: { slug: slug as string } }),
    enabled,
    refetchInterval: (q) => (q.state.data?.isLiveWindow ? REFRESH_MS : false),
    refetchIntervalInBackground: false,
  });

  const { data: myNames } = useQuery({
    queryKey: ["board-my-skaters"],
    queryFn: () => mine(),
    enabled,
    staleTime: 5 * 60_000,
  });

  const watched = useMemo(() => [...(myNames ?? []), ...extras], [myNames, extras]);
  const matches = useMemo(
    () => findMySkaters(data?.payload ?? null, watched),
    [data?.payload, watched],
  );

  const top = useMemo(() => {
    const live = matches
      .filter((m) => !unfollowed.includes(normalizeName(m.skater.name)))
      .filter((m) => line(m) !== null)
      .sort((a, b) => PRIORITY[a.state] - PRIORITY[b.state]);
    return live[0] ?? null;
  }, [matches, unfollowed]);

  if (!enabled || !data?.isLiveWindow || !top || !slug) return null;
  const text = line(top);
  if (!text) return null;

  return (
    <div className="sticky top-2 z-40 mx-auto mt-2 flex max-w-2xl px-3">
      <div
        aria-live="polite"
        className="flex w-full items-center gap-2 rounded-full border border-accent/50 bg-accent/15 px-3 py-1.5 text-accent-ink shadow-card backdrop-blur"
      >
        <span className="relative inline-flex size-2 shrink-0">
          <span className="absolute inset-0 animate-ping rounded-full bg-accent opacity-60" />
          <span className="relative inline-flex size-2 rounded-full bg-accent" />
        </span>
        <button
          type="button"
          onClick={() => navigate({ to: "/board/$slug", params: { slug } })}
          className="press flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{text}</span>
          <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-black uppercase tracking-widest">
            LIVE BOARD
            <ArrowRight className="size-3.5" />
          </span>
        </button>
        <button
          type="button"
          aria-label="Hide live updates for this competition"
          onClick={() => {
            dismissBanner(slug);
            setDismissed(true);
          }}
          className="press-soft shrink-0 rounded-full p-1"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
