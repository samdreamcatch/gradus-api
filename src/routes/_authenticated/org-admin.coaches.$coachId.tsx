import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useSuspenseQuery, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { clubCoachesOptions } from "@/components/org-admin/club-coaches-data";
import { getClubCoachWeeks } from "@/lib/club-coaches.functions";
import { targetPercent, weekStart } from "@/lib/club-coach-metrics";
import { sportDisplayLabel } from "@/lib/coach-sports";
import { downloadCsv, toCsv } from "@/lib/csv";
import { Button } from "@/components/ui/button";
import { ClubPageHeader } from "@/components/org-admin/club-page-header";
import { ClubTable } from "@/components/org-admin/club-table";
import {
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TableFooter,
} from "@/components/ui/table";
import { ClubSection } from "@/components/org-admin/club-section";
import { ClubKeyValueTable } from "@/components/org-admin/club-key-value-table";
import { ClubNumber } from "@/components/org-admin/club-number";
import { ClubMeter } from "@/components/org-admin/club-meter";
import { ClubTag } from "@/components/org-admin/club-tag";

export const Route = createFileRoute("/_authenticated/org-admin/coaches/$coachId")({
  head: () => ({
    meta: [
      { title: "Coach profile · Gradus Club" },
      {
        name: "description",
        content: "Coach profile, teaching levels and aggregate practice history.",
      },
      { property: "og:title", content: "Coach profile · Gradus Club" },
      {
        property: "og:description",
        content: "Coach profile, teaching levels and aggregate practice history.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: async ({ context, params }) => {
    const data = await context.queryClient.ensureQueryData(clubCoachesOptions());
    if (!data.coaches.some((c) => c.coachId === params.coachId)) throw notFound();
  },
  component: CoachProfile,
});

function CoachProfile() {
  const { coachId } = Route.useParams();
  const {
    data: { org, coaches },
  } = useSuspenseQuery(clubCoachesOptions());
  const coach = coaches.find((c) => c.coachId === coachId);
  const read = useServerFn(getClubCoachWeeks);
  const metrics = useQuery({
    queryKey: ["club-coach-weeks", org.id],
    queryFn: () => read({ data: { organizationId: org.id } }),
    retry: false,
  });
  if (!coach) return null;
  const weeks = (metrics.data?.weeks ?? []).filter((w) => w.coach_id === coachId);
  const current = weeks.find((w) => w.week_start === weekStart());
  const club = (metrics.data?.weeks ?? []).filter((w) => w.week_start === weekStart());
  const clubPractice = club.reduce((n, w) => n + Number(w.practice_min), 0);
  const clubTarget = club.every((w) => w.target_min !== null)
    ? club.reduce((n, w) => n + Number(w.target_min), 0)
    : null;
  const num = (v: number | null | undefined) => (v == null ? "—" : Math.round(v).toLocaleString());
  const pct = (value: number | null) => (value === null ? "—" : `${value}%`);
  const stats = [
    [
      "Students",
      String(coach.athleteCount),
      `${coach.parentCount} parent accounts · ${coach.adultAthleteCount} self-managed`,
    ],
    [
      "Practice / target",
      current ? `${num(current.practice_min)} / ${num(current.target_min)} min` : "—",
      current
        ? `${pct(targetPercent(current.practice_min, current.target_min))} · Club ${pct(targetPercent(clubPractice, clubTarget))}`
        : "This week",
    ],
    ["Sessions", num(current?.sessions), "This week"],
  ];
  const profile: [string, React.ReactNode][] = [
    ["Email", coach.email || <ClubNumber value={null} />],
    ["Club", org.name],
    [
      "Sports",
      [...new Set(coach.levels.map((l) => sportDisplayLabel(l.sport)))].join(", ") || (
        <Link to="/org-admin/people" className="underline underline-offset-4">
          Set sport
        </Link>
      ),
    ],
    [
      "Joined",
      coach.joinedAt ? (
        new Date(coach.joinedAt).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
          timeZone: "UTC",
        })
      ) : (
        <ClubNumber value={null} />
      ),
    ],
  ];
  return (
    <div className="mx-auto max-w-7xl space-y-5 px-4 py-6 md:px-6 md:py-8">
      <ClubPageHeader
        back={{ to: "/org-admin/coaches", label: "Coaching" }}
        title={
          coach.firstName.trim() || coach.lastName.trim() ? (
            `${coach.firstName} ${coach.lastName}`.trim()
          ) : (
            <span className="inline-flex flex-wrap items-center gap-2">
              {coach.email || <ClubNumber value={null} />}
              <ClubTag>Invited</ClubTag>
            </span>
          )
        }
        actions={
          <>
            <Button variant="outline" className="min-h-11" asChild>
              <Link to="/org-admin/people">Open in Users</Link>
            </Button>
            <Button
              variant="outline"
              disabled={!weeks.length}
              onClick={() =>
                downloadCsv(
                  "coach-practice.csv",
                  toCsv(
                    ["Week (UTC)", "Students", "Practice min", "Target min", "Sessions"],
                    weeks.map((w) => [
                      w.week_start,
                      w.students,
                      w.practice_min,
                      w.target_min,
                      w.sessions,
                    ]),
                  ),
                )
              }
            >
              Export CSV
            </Button>
          </>
        }
      />
      <div className="grid gap-4 border-y border-divider py-4 sm:grid-cols-3">
        {stats.map(([label, value, reference]) => (
          <div key={label}>
            <p className="text-sm text-text-secondary">{label}</p>
            <p className="font-mono tabular-nums text-2xl font-medium text-text-primary">{value}</p>
            <p className="text-xs text-text-secondary">{reference}</p>
          </div>
        ))}
      </div>
      <ClubSection title="Profile">
        <ClubKeyValueTable rows={profile} />
      </ClubSection>
      <ClubSection title="Sports & levels">
        <ClubTable>
          <TableHeader>
            <TableRow>
              <TableHead>Sport</TableHead>
              <TableHead>Level</TableHead>
              <TableHead className="text-right">Expected hours / week</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {coach.levels.map((l) => (
              <TableRow key={`${l.sport}:${l.key}`}>
                <TableCell>{sportDisplayLabel(l.sport)}</TableCell>
                <TableCell>{l.label}</TableCell>
                <TableCell className="text-right">
                  <ClubNumber value={l.practiceHours} />
                </TableCell>
              </TableRow>
            ))}
            {!coach.levels.length && (
              <TableRow>
                <TableCell colSpan={3} className="text-text-secondary">
                  No teaching levels recorded.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </ClubTable>
      </ClubSection>
      <ClubSection title="Practice · last 8 weeks">
        {metrics.isError ? (
          <div className="flex flex-wrap items-center gap-3">
            <p role="alert" className="text-sm text-text-secondary">
              Practice records couldn't load.
            </p>
            <Button variant="outline" className="min-h-11" onClick={() => metrics.refetch()}>
              Try again
            </Button>
          </div>
        ) : (
          <ClubTable>
            <TableHeader>
              <TableRow>
                {[
                  "Week (UTC)",
                  "Students",
                  "Practice min",
                  "Target min",
                  "% of target",
                  "Sessions",
                ].map((h, i) => (
                  <TableHead key={h} className={i ? "text-right" : ""}>
                    {h}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {weeks.map((w) => (
                <TableRow key={w.week_start}>
                  <TableCell>{formatWeek(w.week_start)}</TableCell>
                  <TableCell className="text-right font-mono">
                    <ClubNumber value={w.students} />
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    <ClubNumber value={w.practice_min} />
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    <ClubNumber value={w.target_min} />
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    <ClubMeter value={w.practice_min} target={w.target_min} />
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    <ClubNumber value={w.sessions} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={2}>8-week total</TableCell>
                <TableCell className="text-right font-mono">
                  {weeks.length ? num(weeks.reduce((n, w) => n + Number(w.practice_min), 0)) : "—"}
                </TableCell>
                <TableCell colSpan={2} />
                <TableCell className="text-right font-mono">
                  {weeks.length ? num(weeks.reduce((n, w) => n + w.sessions, 0)) : "—"}
                </TableCell>
              </TableRow>
            </TableFooter>
          </ClubTable>
        )}
      </ClubSection>
    </div>
  );
}

function formatWeek(iso: string) {
  const start = new Date(`${iso}T00:00:00Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  const format = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${format(start)}–${start.getUTCMonth() === end.getUTCMonth() ? end.getUTCDate() : format(end)}`;
}
