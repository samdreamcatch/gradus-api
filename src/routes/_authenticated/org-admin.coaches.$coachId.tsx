import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useSuspenseQuery, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { clubCoachesOptions } from "@/components/org-admin/club-coaches-data";
import { getClubCoachWeeks, getClubCoachStudents } from "@/lib/club-coaches.functions";
import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { practiceAdherence, weekStart } from "@/lib/club-coach-metrics";
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
        content: "Coach profile, teaching levels, students and parents, and practice adherence.",
      },
      { property: "og:title", content: "Coach profile · Gradus Club" },
      {
        property: "og:description",
        content: "Coach profile, teaching levels, students and parents, and practice adherence.",
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
  const [tab, setTab] = useState("profile");
  const readStudents = useServerFn(getClubCoachStudents);
  const students = useQuery({
    queryKey: ["club-coach-students", org.id, coachId],
    queryFn: () => readStudents({ data: { organizationId: org.id, coachId } }),
    enabled: tab === "students",
    retry: false,
  });
  const metrics = useQuery({
    queryKey: ["club-coach-weeks", org.id],
    queryFn: () => read({ data: { organizationId: org.id } }),
    retry: false,
  });
  if (!coach) return null;
  const weeks = (metrics.data?.weeks ?? []).filter((w) => w.coach_id === coachId);
  const current = weeks.find((w) => w.week_start === weekStart());
  const club = (metrics.data?.weeks ?? []).filter((w) => w.week_start === weekStart());
  const clubMeeting = club.every((w) => w.students_meeting_target != null)
    ? club.reduce((n, w) => n + Number(w.students_meeting_target), 0)
    : null;
  const clubStudents = club.every((w) => w.students != null)
    ? club.reduce((n, w) => n + Number(w.students), 0)
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
      "Practice adherence",
      current ? pct(practiceAdherence(current.students_meeting_target, current.students)) : "—",
      current
        ? current.students_meeting_target == null
          ? "Individual targets unavailable"
          : `${num(current.students_meeting_target)} of ${num(current.students)} meeting target · Club ${pct(practiceAdherence(clubMeeting, clubStudents))}`
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
        back={{ to: "/org-admin/people", label: "Users" }}
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
            <Button variant="outline" className="h-11 rounded-md" asChild>
              <Link to="/org-admin/people">Open in Users</Link>
            </Button>
            <Button
              variant="outline"
              className="h-11 rounded-md"
              disabled={!weeks.length}
              onClick={() =>
                downloadCsv(
                  "coach-practice.csv",
                  toCsv(
                    ["Week (UTC)", "Students", "Students meeting target", "Practice adherence %", "Sessions"],
                    weeks.map((w) => [
                      w.week_start,
                      w.students,
                      w.students_meeting_target,
                      practiceAdherence(w.students_meeting_target, w.students),
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
      <Tabs value={tab} onValueChange={setTab} className="min-w-0">
        <div className="overflow-x-auto border-b border-divider">
          <TabsList aria-label="Coach profile sections" className="h-auto justify-start gap-2 rounded-none bg-transparent p-0">
            {[["profile", "Profile"], ["levels", "Sports & levels"], ["students", "Students"], ["practice", "Practice"]].map(([value, label]) => (
              <TabsTrigger key={value} value={value} className="press-soft min-h-11 shrink-0 rounded-none border-b-2 border-transparent px-3 data-[state=active]:border-accent-ink data-[state=active]:bg-transparent data-[state=active]:text-accent-ink data-[state=active]:shadow-none">{label}</TabsTrigger>
            ))}
          </TabsList>
        </div>
      <TabsContent value="profile" className="pt-3">
      <ClubSection title="Profile">
        <ClubKeyValueTable rows={profile} />
      </ClubSection>
      </TabsContent>
      <TabsContent value="levels" className="pt-3">
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
      </TabsContent>
      <TabsContent value="students" className="pt-3">
        <ClubSection title="Students">
          {students.isPending ? <p role="status" className="text-sm text-text-secondary">Loading students…</p> : students.isError ? (
            <div className="flex items-center gap-3">
              <p role="alert" className="text-sm text-text-secondary">Students couldn't load.</p>
              <Button variant="outline" className="h-11" onClick={() => students.refetch()}>Try again</Button>
            </div>
          ) : (
            <ClubTable>
              <TableHeader><TableRow><TableHead>Student</TableHead><TableHead>Parents / guardians</TableHead></TableRow></TableHeader>
              <TableBody>
                {(students.data ?? []).map((student) => (
                  <TableRow key={student.id}>
                    <TableCell>{student.name || "Unnamed student"}</TableCell>
                    <TableCell>
                      {student.parents.length ? student.parents.join(", ") : student.selfManaged ? "Self-managed" : student.pendingParent ? `${student.pendingParent} · Not linked` : "No parent linked"}
                    </TableCell>
                  </TableRow>
                ))}
                {!students.data?.length && <TableRow><TableCell colSpan={2} className="text-text-secondary">No active students linked.</TableCell></TableRow>}
              </TableBody>
            </ClubTable>
          )}
        </ClubSection>
      </TabsContent>
      <TabsContent value="practice" className="pt-3">
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
                  "Meeting target",
                  "Practice adherence",
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
                    <ClubNumber value={w.students_meeting_target} />
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    <ClubMeter value={w.students_meeting_target} target={w.students} />
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
                <TableCell colSpan={2} />
                <TableCell className="text-right font-mono">
                  {weeks.length ? num(weeks.reduce((n, w) => n + w.sessions, 0)) : "—"}
                </TableCell>
              </TableRow>
            </TableFooter>
          </ClubTable>
        )}
      </ClubSection>
      </TabsContent>
      </Tabs>
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
