import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { getPreLessonBriefing } from "@/lib/pre-lesson-briefing.functions";


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
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const queryKey = ["pre-lesson-briefing", athleteId, lessonDate];

  const { data, isLoading, isError, error } = useQuery({
    queryKey,
    queryFn: () => getPreLessonBriefing({ data: { athleteId, lessonDate } }),
    staleTime: 5 * 60_000,
  });

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const fresh = await getPreLessonBriefing({
        data: { athleteId, lessonDate, refresh: true },
      });
      qc.setQueryData(queryKey, fresh);
    } finally {
      setRefreshing(false);
    }
  };

  const time = formatTime(startMinute);

  return (
    <div className="mt-5 rounded-2xl border border-accent/40 bg-card p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
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
      </div>

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
