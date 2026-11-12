import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useSuspenseQuery, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { clubCoachesOptions } from "@/components/org-admin/club-coaches-data";
import { getClubCoachWeeks } from "@/lib/club-coaches.functions";
import { targetPercent, weekStart } from "@/lib/club-coach-metrics";
import { sportDisplayLabel } from "@/lib/coach-sports";
import { downloadCsv, toCsv } from "@/lib/csv";
import { Button } from "@/components/ui/button";
import { PageTitle } from "@/components/page-title";
import { ClubTable } from "@/components/org-admin/club-table";
import { TableHeader, TableHead, TableBody, TableRow, TableCell, TableFooter } from "@/components/ui/table";
import { Download } from "lucide-react";

export const Route = createFileRoute("/_authenticated/org-admin/coaches/$coachId")({
  head: () => ({ meta: [
    { title: "Coach profile · Gradus Club" }, { name: "description", content: "Coach profile, teaching levels and aggregate practice history." },
    { property: "og:title", content: "Coach profile · Gradus Club" }, { property: "og:description", content: "Coach profile, teaching levels and aggregate practice history." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  loader: async ({ context, params }) => {
    const data = await context.queryClient.ensureQueryData(clubCoachesOptions());
    if (!data.coaches.some((c) => c.coachId === params.coachId)) throw notFound();
  },
  component: CoachProfile,
});

function CoachProfile() {
  const { coachId } = Route.useParams();
  const { data: { org, coaches } } = useSuspenseQuery(clubCoachesOptions());
  const coach = coaches.find((c) => c.coachId === coachId);
  const read = useServerFn(getClubCoachWeeks);
  const metrics = useQuery({ queryKey: ["club-coach-weeks", org.id], queryFn: () => read({ data: { organizationId: org.id } }), retry: false });
  if (!coach) return null;
  const weeks = (metrics.data?.weeks ?? []).filter((w) => w.coach_id === coachId);
  const current = weeks.find((w) => w.week_start === weekStart());
  const club = (metrics.data?.weeks ?? []).filter((w) => w.week_start === weekStart());
  const clubPractice = club.reduce((n, w) => n + Number(w.practice_min), 0);
  const clubTarget = club.every((w) => w.target_min !== null) ? club.reduce((n, w) => n + Number(w.target_min), 0) : null;
  const num = (v: number | null | undefined) => v == null ? "—" : Math.round(v).toLocaleString();
  const pct = (value: number | null) => value === null ? "—" : `${value}%`;
  const stats = [
    ["Students", String(coach.athleteCount), `${coach.parentCount} parent accounts · ${coach.adultAthleteCount} self-managed`],
    ["Practice / target", current ? `${num(current.practice_min)} / ${num(current.target_min)} min` : "—", current ? `${pct(targetPercent(current.practice_min, current.target_min))} · Club ${pct(targetPercent(clubPractice, clubTarget))}` : "This week"],
    ["Sessions", num(current?.sessions), "This week"],
  ];
  const profile = [
    ["Email", coach.email ?? "Not on file"], ["Club", org.name], ["Sports", [...new Set(coach.levels.map((l) => sportDisplayLabel(l.sport)))].join(", ") || "Not set"],
    ["Joined", coach.joinedAt ? new Date(coach.joinedAt).toLocaleDateString() : "Not recorded"],
  ];
  return <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 md:px-8 md:py-8">
    <Button variant="link" asChild className="p-0 text-text-secondary"><Link to="/org-admin/coaches">Coaches</Link></Button>
    <div className="flex flex-wrap items-center justify-between gap-4"><PageTitle>{`${coach.firstName} ${coach.lastName}`.trim() || "Coach profile"}</PageTitle><div className="flex flex-wrap gap-2"><Button variant="outline" asChild><Link to="/org-admin/people">Open in Users</Link></Button><Button variant="outline" disabled={!weeks.length} onClick={() => downloadCsv("coach-practice.csv", toCsv(["Week (UTC)", "Students", "Practice min", "Target min", "Sessions"], weeks.map((w) => [w.week_start, w.students, w.practice_min, w.target_min, w.sessions])))}><Download className="size-4" />Export CSV</Button></div></div>
    <div className="grid gap-4 border-y border-divider py-4 sm:grid-cols-3">{stats.map(([label, value, reference]) => <div key={label}><p className="text-sm text-text-secondary">{label}</p><p className="font-display text-h2">{value}</p><p className="text-xs text-text-secondary">{reference}</p></div>)}</div>
    <section className="space-y-3"><h2 className="font-display text-h3">Profile</h2><ClubTable><TableBody>{profile.map(([label, value]) => <TableRow key={label}><TableCell className="w-48 text-text-secondary">{label}</TableCell><TableCell>{value}</TableCell></TableRow>)}</TableBody></ClubTable></section>
    <section className="space-y-3"><h2 className="font-display text-h3">Sports & levels</h2><ClubTable><TableHeader><TableRow><TableHead>Sport</TableHead><TableHead>Level</TableHead><TableHead className="text-right">Expected hours / week</TableHead></TableRow></TableHeader><TableBody>{coach.levels.map((l) => <TableRow key={`${l.sport}:${l.key}`}><TableCell>{sportDisplayLabel(l.sport)}</TableCell><TableCell>{l.label}</TableCell><TableCell className="text-right font-mono">{l.practiceHours}</TableCell></TableRow>)}{!coach.levels.length && <TableRow><TableCell colSpan={3} className="text-text-secondary">No teaching levels recorded.</TableCell></TableRow>}</TableBody></ClubTable></section>
    <section className="space-y-3"><h2 className="font-display text-h3">Practice · last 8 weeks</h2>
      {metrics.isError ? <p role="alert" className="text-sm text-text-secondary">Weekly practice records become available after this draft is accepted.</p> : <ClubTable><TableHeader><TableRow>{["Week (UTC)", "Students", "Practice min", "Target min", "% of target", "Sessions"].map((h, i) => <TableHead key={h} className={i ? "text-right" : ""}>{h}</TableHead>)}</TableRow></TableHeader><TableBody>{weeks.map((w) => <TableRow key={w.week_start}><TableCell>{w.week_start}</TableCell><TableCell className="text-right font-mono">{num(w.students)}</TableCell><TableCell className="text-right font-mono">{num(w.practice_min)}</TableCell><TableCell className="text-right font-mono">{num(w.target_min)}</TableCell><TableCell className="text-right font-mono">{pct(targetPercent(w.practice_min, w.target_min))}</TableCell><TableCell className="text-right font-mono">{num(w.sessions)}</TableCell></TableRow>)}</TableBody><TableFooter><TableRow><TableCell colSpan={2}>8-week total</TableCell><TableCell className="text-right font-mono">{weeks.length ? num(weeks.reduce((n, w) => n + Number(w.practice_min), 0)) : "—"}</TableCell><TableCell colSpan={2} /><TableCell className="text-right font-mono">{weeks.length ? num(weeks.reduce((n, w) => n + w.sessions, 0)) : "—"}</TableCell></TableRow></TableFooter></ClubTable>}
    </section>
  </div>;
}