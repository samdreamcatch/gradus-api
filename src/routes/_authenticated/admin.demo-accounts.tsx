import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Tag } from "@/components/ui/tag";
import {
  adminGetDemoAccounts,
  adminSeedDemoAccounts,
  DEMO_PEOPLE,
  type DemoAccountsResult,
} from "@/lib/admin-demo-accounts.functions";

export const Route = createFileRoute("/_authenticated/admin/demo-accounts")({
  component: DemoAccountsPage,
});

const DEFAULTS = {
  coachEmail: "demo-coach@gradussports.com",
  parentEmail: "demo-parent@gradussports.com",
  athleteUsername: "demo_athlete",
};

function DemoAccountsPage() {
  const getFn = useServerFn(adminGetDemoAccounts);
  const seedFn = useServerFn(adminSeedDemoAccounts);

  const [coachEmail, setCoachEmail] = useState(DEFAULTS.coachEmail);
  const [parentEmail, setParentEmail] = useState(DEFAULTS.parentEmail);
  const [athleteUsername, setAthleteUsername] = useState(DEFAULTS.athleteUsername);
  const [password, setPassword] = useState("");
  const [reset, setReset] = useState(false);
  const [result, setResult] = useState<DemoAccountsResult | null>(null);

  const status = useQuery({
    queryKey: ["admin-demo-accounts", coachEmail, parentEmail, athleteUsername],
    queryFn: () => getFn({ data: { coachEmail, parentEmail, athleteUsername } }),
    enabled: !!coachEmail && !!parentEmail && !!athleteUsername,
  });

  const seed = useMutation({
    mutationFn: () =>
      seedFn({ data: { coachEmail, parentEmail, athleteUsername, password, reset } }),
    onSuccess: (r) => {
      setResult(r);
      setPassword("");
      setReset(false);
      toast.success("Demo accounts created and seeded");
      status.refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const s = status.data;
  const anyExists = !!(s?.coach.userId || s?.parent.userId || s?.athlete.userId);
  const canSeed = password.length >= 12 && (!anyExists || reset) && !seed.isPending;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 space-y-10">
      <header className="space-y-3">
        <Eyebrow>Membership</Eyebrow>
        <h1 className="font-display text-3xl">Demo accounts</h1>
        <p className="text-text-secondary max-w-prose">
          The App Review set (PRD decision #26): coach{" "}
          <strong>
            {DEMO_PEOPLE.coach.firstName} {DEMO_PEOPLE.coach.lastName}
          </strong>
          , parent{" "}
          <strong>
            {DEMO_PEOPLE.parent.firstName} {DEMO_PEOPLE.parent.lastName}
          </strong>{" "}
          and their {DEMO_PEOPLE.athlete.ageYears}-year-old{" "}
          <strong>
            {DEMO_PEOPLE.athlete.firstName} {DEMO_PEOPLE.athlete.lastName}
          </strong>{" "}
          (username login), seeded with a lesson, goals, the starter move library, one active plan,
          four logged sessions and a short conversation. Invented names; every row is marked as test
          data. The password is not stored anywhere here: put it in App Store Connect.
        </p>
      </header>

      <section className="space-y-4 rounded-xl border border-divider bg-card p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="demo-coach-email">Coach email</Label>
            <Input
              id="demo-coach-email"
              type="email"
              value={coachEmail}
              onChange={(e) => setCoachEmail(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="demo-parent-email">Parent email</Label>
            <Input
              id="demo-parent-email"
              type="email"
              value={parentEmail}
              onChange={(e) => setParentEmail(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="demo-athlete-username">Athlete username</Label>
            <Input
              id="demo-athlete-username"
              value={athleteUsername}
              onChange={(e) => setAthleteUsername(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="demo-password">Password for all three (12+ characters)</Label>
            <Input
              id="demo-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <div className="flex items-center gap-2">
            <Switch id="demo-reset" checked={reset} onCheckedChange={setReset} />
            <Label htmlFor="demo-reset">
              Reset: delete existing demo accounts with these emails first
            </Label>
          </div>
          <Button
            type="button"
            className="ml-auto"
            disabled={!canSeed}
            onClick={() => seed.mutate()}
          >
            {seed.isPending ? "Seeding…" : anyExists ? "Reset and seed" : "Create and seed"}
          </Button>
        </div>
        {anyExists && !reset ? (
          <p className="text-xs text-text-secondary">
            Accounts already exist for these emails or username. Tick Reset to delete and recreate
            them (their seeded data is deleted with them).
          </p>
        ) : null}
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-xl">Current state</h2>
        {status.isLoading ? (
          <p className="text-text-secondary">Checking…</p>
        ) : s ? (
          <ul className="divide-y divide-divider rounded-xl border border-divider bg-card">
            <Row
              label="Coach"
              value={s.coach.email}
              exists={!!s.coach.userId}
              extra={s.coach.inviteCode ? `Invite code ${s.coach.inviteCode}` : undefined}
            />
            <Row label="Parent" value={s.parent.email} exists={!!s.parent.userId} />
            <Row label="Athlete" value={s.athlete.username} exists={!!s.athlete.userId} />
          </ul>
        ) : null}
        {result ? (
          <p className="text-sm text-text-secondary">
            Seeded {result.seeded.plans} plan, {result.seeded.sessions} sessions,{" "}
            {result.seeded.messages} messages, {result.seeded.lessons} lesson. Sign in on the
            TestFlight build as each account before pasting them into App Store Connect.
          </p>
        ) : null}
      </section>
    </div>
  );
}

function Row({
  label,
  value,
  exists,
  extra,
}: {
  label: string;
  value: string;
  exists: boolean;
  extra?: string;
}) {
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <span className="w-20 text-xs font-bold uppercase tracking-wide text-text-secondary">
        {label}
      </span>
      <span className="min-w-0 flex-1 font-medium">{value}</span>
      {extra ? <span className="text-xs text-text-secondary">{extra}</span> : null}
      <Tag tone={exists ? "accent" : "muted"}>{exists ? "Exists" : "Not created"}</Tag>
    </li>
  );
}
