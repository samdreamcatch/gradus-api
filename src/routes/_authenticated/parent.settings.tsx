import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, Trash2, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ParentBottomNav } from "@/components/parent/bottom-nav";
import { AthleteInviteCard } from "@/components/parent/athlete-invite-card";
import { AthleteGoalsForm, type GoalsState } from "@/components/parent/athlete-goals-form";
import {
  ScheduleEditor,
  emptySlot,
  validateSlots,
  toISODate,
  type Slot,
} from "@/components/parent/schedule-editor";
import {
  getParentSettings,
  updateParentProfile,
  updateAthlete,
  updateAthleteGoals,
  replaceAthleteSchedule,
  addAthlete,
  removeAthlete,
} from "@/lib/parent-settings.functions";

export const Route = createFileRoute("/_authenticated/parent/settings")({
  component: ParentSettingsPage,
});

function ParentSettingsPage() {
  const fetchSettings = useServerFn(getParentSettings);
  const { data, isLoading } = useQuery({
    queryKey: ["parent-settings"],
    queryFn: () => fetchSettings(),
  });

  return (
    <>
      <div className="mx-auto min-h-dvh max-w-3xl px-4 pt-8 pb-24">
        <header className="mb-4">
          <p className="text-xs font-bold uppercase tracking-widest text-accent-ink">
            Settings
          </p>
          <h1 className="mt-1 text-3xl sm:text-4xl">Your account</h1>
        </header>

        {isLoading || !data ? (
          <p className="text-text-tertiary">Loading…</p>
        ) : (
          <div className="space-y-3">
            <NameSection profile={data.profile} />
            <AthletesSection
              athletes={data.athletes}
              coachSports={data.coachSports}
            />
            <AccountSection />
          </div>
        )}
      </div>
      <ParentBottomNav />
    </>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-card p-6 shadow-card sm:p-8">
      <h2 className="text-xl">{title}</h2>
      <div className="mt-6">{children}</div>
    </section>
  );
}

function NameSection({
  profile,
}: {
  profile: { firstName: string; lastName: string };
}) {
  const [firstName, setFirstName] = useState(profile.firstName);
  const [lastName, setLastName] = useState(profile.lastName);
  const qc = useQueryClient();
  const save = useServerFn(updateParentProfile);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await save({ data: { firstName: firstName.trim(), lastName: lastName.trim() } });
      toast.success("Name saved");
      qc.invalidateQueries({ queryKey: ["parent-settings"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard title="Your name">
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="p-firstName">First name</Label>
          <Input
            id="p-firstName"
            value={firstName}
            maxLength={80}
            onChange={(e) => setFirstName(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="p-lastName">Last name</Label>
          <Input
            id="p-lastName"
            value={lastName}
            maxLength={80}
            onChange={(e) => setLastName(e.target.value)}
          />
        </div>
      </div>
      <div className="mt-4 flex justify-end">
        <Button
          onClick={handleSave}
          disabled={saving || !firstName.trim() || !lastName.trim()}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </SectionCard>
  );
}

type AthleteData = {
  id: string;
  firstName: string;
  lastName: string;
  birthdate: string | null;
  inviteCode: string | null;
  goals: GoalsState | null;
  slots: {
    dayOfWeek: number;
    startMinute: number;
    endMinute: number;
    frequency: "weekly" | "biweekly" | "twice_monthly" | "monthly";
    weeksOfMonth: number[];
    startsOn: string | null;
  }[];
};

function AthletesSection({
  athletes,
  coachSports,
}: {
  athletes: AthleteData[];
  coachSports: string[];
}) {
  const [adding, setAdding] = useState(false);

  return (
    <SectionCard title="Athletes">
      <div className="space-y-3">
        {athletes.map((a) => (
          <AthleteCard key={a.id} athlete={a} coachSports={coachSports} />
        ))}
      </div>

      {adding ? (
        <AddAthleteForm onDone={() => setAdding(false)} />
      ) : (
        <Button
          type="button"
          variant="ghost"
          onClick={() => setAdding(true)}
          className="mt-4 text-accent-ink"
        >
          <Plus className="size-4" /> Add an athlete
        </Button>
      )}
    </SectionCard>
  );
}

function AthleteCard({
  athlete,
  coachSports,
}: {
  athlete: AthleteData;
  coachSports: string[];
}) {
  const [open, setOpen] = useState(false);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const url = athlete.inviteCode ? `${origin}/signup/athlete?code=${athlete.inviteCode}` : null;

  return (
    <div className="rounded-2xl border border-divider bg-elevated p-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <div>
          <p className="font-display text-lg text-text-primary">
            {athlete.firstName} {athlete.lastName}
          </p>
          <p className="text-xs text-text-tertiary">
            {athlete.birthdate ? `Born ${athlete.birthdate}` : "No birthdate"}
            {athlete.goals?.sport ? ` · ${athlete.goals.sport}` : ""}
          </p>
        </div>
        {open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
      </button>

      {open && (
        <div className="mt-5 space-y-6 border-t border-divider pt-5">
          <IdentityBlock athlete={athlete} />
          <GoalsBlock athlete={athlete} coachSports={coachSports} />
          <ScheduleBlock athlete={athlete} />
          <div>
            <h3 className="text-sm font-bold uppercase tracking-widest text-accent-ink">
              Athlete invite
            </h3>
            <p className="mt-1 text-xs text-text-tertiary">
              Share this code so {athlete.firstName} can sign in to their own account.
            </p>
            <div className="mt-3 max-w-xs">
              <AthleteInviteCard
                name={`${athlete.firstName} ${athlete.lastName}`}
                code={athlete.inviteCode}
                url={url}
              />
            </div>
          </div>
          <RemoveBlock athlete={athlete} />
        </div>
      )}
    </div>
  );
}

function IdentityBlock({ athlete }: { athlete: AthleteData }) {
  const [firstName, setFirstName] = useState(athlete.firstName);
  const [lastName, setLastName] = useState(athlete.lastName);
  const [birthdate, setBirthdate] = useState(athlete.birthdate ?? "");
  const qc = useQueryClient();
  const save = useServerFn(updateAthlete);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await save({
        data: {
          athleteId: athlete.id,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          birthdate: birthdate.trim() ? birthdate.trim() : null,
        },
      });
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: ["parent-settings"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h3 className="text-sm font-bold uppercase tracking-widest text-accent-ink">
        Identity
      </h3>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <div className="space-y-2">
          <Label>First name</Label>
          <Input
            value={firstName}
            maxLength={80}
            onChange={(e) => setFirstName(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>Last name</Label>
          <Input
            value={lastName}
            maxLength={80}
            onChange={(e) => setLastName(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>Birthdate</Label>
          <Input
            type="date"
            value={birthdate}
            onChange={(e) => setBirthdate(e.target.value)}
          />
        </div>
      </div>
      <div className="mt-3 flex justify-end">
        <Button
          size="sm"
          onClick={handleSave}
          disabled={saving || !firstName.trim() || !lastName.trim()}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

function GoalsBlock({
  athlete,
  coachSports,
}: {
  athlete: AthleteData;
  coachSports: string[];
}) {
  const defaultSport = athlete.goals?.sport || (coachSports.length === 1 ? coachSports[0] : "");
  const [state, setState] = useState<GoalsState>({
    sport: defaultSport,
    currentLevelKey: athlete.goals?.currentLevelKey ?? "",
    seasonGoalKey: athlete.goals?.seasonGoalKey ?? "",
    longTermGoal: athlete.goals?.longTermGoal ?? "",
  });
  const qc = useQueryClient();
  const save = useServerFn(updateAthleteGoals);
  const [saving, setSaving] = useState(false);

  const canSave =
    !!state.sport && !!state.currentLevelKey && !!state.seasonGoalKey && !saving;

  const handleSave = async () => {
    setSaving(true);
    try {
      await save({
        data: {
          athleteId: athlete.id,
          sport: state.sport,
          currentLevelKey: state.currentLevelKey,
          seasonGoalKey: state.seasonGoalKey,
          longTermGoal: state.longTermGoal.trim(),
        },
      });
      toast.success("Goals saved");
      qc.invalidateQueries({ queryKey: ["parent-settings"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h3 className="text-sm font-bold uppercase tracking-widest text-accent-ink">
        Goals
      </h3>
      <div className="mt-3">
        <AthleteGoalsForm
          athleteName={athlete.firstName}
          availableSports={coachSports}
          value={state}
          onChange={setState}
        />
      </div>
      <div className="mt-3 flex justify-end">
        <Button size="sm" onClick={handleSave} disabled={!canSave}>
          {saving ? "Saving…" : "Save goals"}
        </Button>
      </div>
    </div>
  );
}

function ScheduleBlock({ athlete }: { athlete: AthleteData }) {
  const initial: Slot[] = athlete.slots.length
    ? athlete.slots.map((s) => ({
        dayOfWeek: s.dayOfWeek,
        startMinute: s.startMinute,
        endMinute: s.endMinute,
        frequency: s.frequency,
        weeksOfMonth: s.weeksOfMonth,
        startsOn: s.startsOn ? new Date(`${s.startsOn}T00:00:00`) : null,
      }))
    : [emptySlot()];
  const [slots, setSlots] = useState<Slot[]>(initial);
  const qc = useQueryClient();
  const save = useServerFn(replaceAthleteSchedule);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const filtered = slots.filter(
      (s) => s.dayOfWeek !== null || s.startMinute !== null || s.endMinute !== null,
    );
    const err = filtered.length ? validateSlots(filtered) : null;
    if (err) {
      toast.error(err);
      return;
    }
    const cleaned = filtered.map((s) => ({
      dayOfWeek: s.dayOfWeek as number,
      startMinute: s.startMinute as number,
      endMinute: s.endMinute as number,
      frequency: s.frequency,
      weeksOfMonth:
        s.frequency === "weekly" || s.frequency === "biweekly"
          ? []
          : [...s.weeksOfMonth].sort((a, b) => a - b),
      startsOn: s.frequency === "biweekly" && s.startsOn ? toISODate(s.startsOn) : null,
    }));
    setSaving(true);
    try {
      await save({ data: { athleteId: athlete.id, slots: cleaned } });
      toast.success("Schedule saved");
      qc.invalidateQueries({ queryKey: ["parent-settings"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h3 className="text-sm font-bold uppercase tracking-widest text-accent-ink">
        Lesson schedule
      </h3>
      <div className="mt-3">
        <ScheduleEditor slots={slots} onChange={setSlots} />
      </div>
      <div className="mt-3 flex justify-end">
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save schedule"}
        </Button>
      </div>
    </div>
  );
}

function RemoveBlock({ athlete }: { athlete: AthleteData }) {
  const qc = useQueryClient();
  const remove = useServerFn(removeAthlete);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleRemove = async () => {
    setBusy(true);
    try {
      await remove({ data: { athleteId: athlete.id } });
      toast.success("Athlete removed");
      qc.invalidateQueries({ queryKey: ["parent-settings"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't remove");
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-divider/60 bg-card p-3">
      <div className="text-xs text-text-tertiary">
        Removing wipes goals, schedule, and the invite code for {athlete.firstName}.
      </div>
      {confirming ? (
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={handleRemove}
            disabled={busy}
          >
            {busy ? "Removing…" : "Confirm remove"}
          </Button>
        </div>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          className="text-destructive"
          onClick={() => setConfirming(true)}
        >
          <Trash2 className="size-4" /> Remove
        </Button>
      )}
    </div>
  );
}

function AddAthleteForm({ onDone }: { onDone: () => void }) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [birthdate, setBirthdate] = useState("");
  const qc = useQueryClient();
  const add = useServerFn(addAthlete);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await add({
        data: {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          birthdate,
        },
      });
      toast.success("Athlete added");
      qc.invalidateQueries({ queryKey: ["parent-settings"] });
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't add");
    } finally {
      setBusy(false);
    }
  };

  const valid =
    firstName.trim().length > 0 &&
    lastName.trim().length > 0 &&
    /^\d{4}-\d{2}-\d{2}$/.test(birthdate);

  return (
    <div className="mt-4 rounded-2xl border border-divider bg-elevated p-4">
      <p className="text-sm font-bold uppercase tracking-widest text-accent-ink">
        Add athlete
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <div className="space-y-2">
          <Label>First name</Label>
          <Input value={firstName} maxLength={80} onChange={(e) => setFirstName(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Last name</Label>
          <Input value={lastName} maxLength={80} onChange={(e) => setLastName(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Birthdate</Label>
          <Input type="date" value={birthdate} onChange={(e) => setBirthdate(e.target.value)} />
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button size="sm" onClick={submit} disabled={!valid || busy}>
          {busy ? "Adding…" : "Add athlete"}
        </Button>
      </div>
    </div>
  );
}

function AccountSection() {
  const navigate = useNavigate();
  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/login" });
  };
  return (
    <SectionCard title="Account">
      <Button variant="outline" onClick={handleSignOut}>
        Sign out
      </Button>
    </SectionCard>
  );
}
// suppress unused warning for useEffect — kept for future expansion
void useEffect;
