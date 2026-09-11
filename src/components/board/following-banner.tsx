import { useEffect, useMemo, useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, X } from "lucide-react";
import { getBoard, getMySkaterNames } from "@/lib/board.functions";
import { normalizeName } from "@/lib/board-types";
import { supabase } from "@/integrations/supabase/client";
import { findMySkaters, type SkaterMatch } from "@/components/board/my-skaters";
import {
  dismissBanner,
  isBannerDismissed,
  readBoardHistory,
  readBoardReturn,
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

function ordinal(place: string | number): string {
  const n = Number(place);
  if (!Number.isFinite(n)) return String(place);
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  const suffix = ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${n % 10 <= 3 ? suffix : "th"}`;
}

function line(m: SkaterMatch): string | null {
  const first = m.skater.name.split(" ")[0] || m.skater.name;
  if (m.state === "on-ice") return `${first} on the ice · ${m.event.rink}`;
  if (m.state === "up-next") return `${first} up next · ${m.event.rink}`;
  if (m.state === "scored" && m.skater.segScore)
    return `${first} scored ${m.skater.segScore}${m.skater.place ? ` · ${ordinal(m.skater.place)}` : ""}`;
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
  const [compName, setCompName] = useState<string>("");
  const [fromBoard, setFromBoard] = useState(false);
  const [extras, setExtras] = useState<string[]>([]);
  const [unfollowed, setUnfollowed] = useState<string[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSignedIn(!!data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) =>
      setSignedIn(!!session),
    );
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    setFromBoard(!!readBoardReturn());
    const recent = readBoardHistory()[0];
    if (!recent) return;
    setSlug(recent.slug);
    setCompName(recent.name ?? "");
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

  const isLive = !!data?.isLiveWindow;
  // The banner is a way back to the board first, a status ticker second: it
  // stays available for anyone who arrived from a board in this session, even
  // when nothing is happening on the ice.
  if (!enabled || !slug || (!isLive && !fromBoard)) return null;

  const newsText = top ? line(top) : null;
  const text = newsText ?? (isLive && compName ? `${compName} · live` : "Back to the Live Board");
  const hasNews = !!newsText;

  return (
    <div className="sticky top-2 z-40 mx-auto mt-2 flex max-w-2xl px-3">
      <div
        aria-live="polite"
        className={
          hasNews
            ? "flex w-full items-center gap-2 rounded-full border border-accent/50 bg-accent/15 px-3 py-1.5 text-accent-ink shadow-card backdrop-blur"
            : "flex w-full items-center gap-2 rounded-full border border-divider bg-card px-3 py-1.5 text-text-secondary shadow-card backdrop-blur"
        }
      >
        {hasNews ? (
          <span className="relative inline-flex size-2 shrink-0">
            <span className="absolute inset-0 animate-ping rounded-full bg-accent opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-accent" />
          </span>
        ) : (
          <span className="inline-flex size-2 shrink-0 rounded-full bg-text-tertiary" />
        )}
        <button
          type="button"
          onClick={() => navigate({ to: "/board/$slug", params: { slug } })}
          className="press flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{text}</span>
          <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-black uppercase tracking-widest">
            <span className="hidden sm:inline">LIVE&nbsp;</span>BOARD
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
