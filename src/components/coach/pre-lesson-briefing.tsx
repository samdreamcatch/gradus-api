import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { getPreLessonBriefing } from "@/lib/pre-lesson-briefing.functions";
import { buildSampleBriefing, isSampleAthlete } from "@/data/sample-athlete";

export function PreLessonBriefing({
  athleteId,
  athleteName,
  lessonDate,
  startMinute,
}: {
  athleteId: string;
  athleteName: string;
  lessonDate: string; // YYYY-MM-DD
  startMinute: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const isSample = isSampleAthlete(athleteId);
  const queryKey = ["pre-lesson-briefing", athleteId, lessonDate];

  const {
    data: fetched,
    isLoading: isFetching,
    isError,
    error,
  } = useQuery({
    queryKey,
    queryFn: () => getPreLessonBriefing({ data: { athleteId, lessonDate } }),
    staleTime: 5 * 60_000,
    enabled: !isSample,
  });

  const data = isSample ? { narrative: buildSampleBriefing() } : fetched;
  const isLoading = !isSample && isFetching;


  const time = formatTime(startMinute);

  return (
    <div className="mt-5 rounded-2xl border border-accent/40 bg-card p-4 shadow-card">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-3 text-left focus-visible:outline-none"
      >
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/15 text-accent-ink">
            <Sparkles className="h-4 w-4" />
          </span>
          <div className="leading-tight">
            <div className="text-[10px] font-bold uppercase tracking-widest text-text-tertiary">
              Up next briefing
            </div>
            <div className="font-display text-base font-black text-text-primary">
              {athleteName} <span className="text-text-tertiary font-normal">· {time}</span>
            </div>
          </div>
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-text-tertiary transition-transform",
            expanded && "rotate-180",
          )}
        />
      </button>

      {expanded ? (
        <div className="mt-3 text-sm leading-relaxed text-text-primary">
          {isLoading ? (
            <div className="space-y-2">
              <div className="h-3 w-full animate-pulse rounded bg-divider/60" />
              <div className="h-3 w-11/12 animate-pulse rounded bg-divider/60" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-divider/60" />
            </div>
          ) : isError ? (
            <p className="text-text-secondary">
              Couldn't load the briefing{error instanceof Error ? `: ${error.message}` : "."}
            </p>
          ) : (
            <p>{data?.narrative}</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function formatTime(minute: number): string {
  const h24 = Math.floor(minute / 60);
  const m = minute % 60;
  const ampm = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return m === 0 ? `${h12} ${ampm}` : `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}
