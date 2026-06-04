import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  LogOut,
  Mail,
  Palette,
  User,
  Users,
  Plus,
  Trash2,
  Target,
  CalendarClock,
  QrCode,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ParentBottomNav } from "@/components/parent/bottom-nav";
import { AthleteInviteCard } from "@/components/parent/athlete-invite-card";
import {
  AthleteGoalsForm,
  type GoalsState,
} from "@/components/parent/athlete-goals-form";
import {
  ScheduleEditor,
  emptySlot,
  validateSlots,
  toISODate,
  type Slot,
} from "@/components/parent/schedule-editor";
import {
  SettingsGroup,
  SettingsList,
  SettingsRow,
  SettingsHeader,
  SettingsButtonRow,
  SettingsDisclosure,
} from "@/components/settings/primitives";
import { ThemeSelect } from "@/components/settings/theme-select";
import { useCurrentUserEmail } from "@/hooks/use-current-user-email";
import {
  getParentSettings,
  updateParentProfile,
  updateAthlete,
  updateAthleteGoals,
  replaceAthleteSchedule,
  addAthlete,
  removeAthlete,
} from "@/lib/parent-settings.functions";
import { getSport } from "@/lib/coach-sports";

export const Route = createFileRoute("/_authenticated/parent/settings")({
  component: ParentSettingsPage,
});

function ParentSettingsPage() {
  const fetchSettings = useServerFn(getParentSettings);
  const { data, isLoading, error } = useQuery({
    queryKey: ["parent-settings"],
    queryFn: () => fetchSettings(),
  });
  const email = useCurrentUserEmail();

  return (
    <>
      <div className="mx-auto min-h-dvh max-w-2xl px-3 pt-4 pb-24">
        <SettingsHeader title="Your account" />

        {isLoading ? (
          <p className="px-3 text-text-tertiary">Loading…</p>
        ) : error ? (
          <p className="px-3 text-text-tertiary">
            {error instanceof Error ? error.message : "Couldn't load settings."}
          </p>
        ) : !data ? (
          <p className="px-3 text-text-tertiary">No settings found.</p>
        ) : (
          <>
            <SettingsGroup label="My profile">
              <SettingsList>
                <NameDisclosure profile={data.profile} />
                <SettingsRow
                  icon={<Mail className="size-4" />}
                  label="Email"
                  value={email ?? "—"}
                />
              </SettingsList>
            </SettingsGroup>

            <SettingsGroup label="My athletes">
              <AthletesList
                athletes={data.athletes}
                coachSports={data.coachSports}
              />
            </SettingsGroup>

            <SettingsGroup label="Preferences">
              <SettingsList>
                <SettingsRow
                  icon={<Palette className="size-4" />}
                  label="Appearance"
                  trailing={<ThemeSelect />}
                />
              </SettingsList>
            </SettingsGroup>

            <SettingsGroup>
              <SettingsList>
                <SignOutRow />
              </SettingsList>
            </SettingsGroup>
          </>
        )}
      </div>
      <ParentBottomNav />
    </>
  );
}

function NameDisclosure({
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
      await save({
        data: { firstName: firstName.trim(), lastName: lastName.trim() },
      });
      toast.success("Name saved");
      qc.invalidateQueries({ queryKey: ["parent-settings"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsDisclosure
      icon={<User className="size-4" />}
      label="Name"
      value={`${profile.firstName} ${profile.lastName}`.trim() || "—"}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">First name</Label>
          <Input
            value={firstName}
            maxLength={80}
            onChange={(e) => setFirstName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Last name</Label>
          <Input
            value={lastName}
            maxLength={80}
            onChange={(e) => setLastName(e.target.value)}
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
    </SettingsDisclosure>
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

function AthletesList({
  athletes,
  coachSports,
}: {
  athletes: AthleteData[];
  coachSports: string[];
}) {
  const [adding, setAdding] = useState(false);

  return (
    <SettingsList>
      {athletes.map((a) => (
        <AthleteDisclosure key={a.id} athlete={a} coachSports={coachSports} />
      ))}
      {adding ? (
        <div className="border-t border-divider bg-elevated/30 px-4 py-4">
          <AddAthleteForm onDone={() => setAdding(false)} />
        </div>
      ) : (
        <SettingsButtonRow
          icon={<Plus className="size-4" />}
          label="Add an athlete"
          tone="accent"
          onClick={() => setAdding(true)}
        />
      )}
    </SettingsList>
  );
}

function AthleteDisclosure({
  athlete,
  coachSports,
}: {
  athlete: AthleteData;
  coachSports: string[];
}) {
  const sportLabel = athlete.goals?.sport
    ? (getSport(athlete.goals.sport)?.label ?? athlete.goals.sport)
    : null;
  const summary = sportLabel
    ? sportLabel
    : athlete.birthdate
      ? "Set up goals"
      : "Set up profile";

  return (
    <SettingsDisclosure
      icon={<Users className="size-4" />}
      label={`${athlete.firstName} ${athlete.lastName}`.trim()}
      value={summary}
    >
      <div className="space-y-3">
        <NestedList>
          <IdentitySubrow athlete={athlete} />
          <GoalsSubrow athlete={athlete} coachSports={coachSports} />
          <ScheduleSubrow athlete={athlete} />
          <InviteSubrow athlete={athlete} />
        </NestedList>
        <RemoveBlock athlete={athlete} />
      </div>
    </SettingsDisclosure>
  );
}

function NestedList({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-divider bg-card divide-y divide-divider">
      {children}
    </div>
  );
}

function IdentitySubrow({ athlete }: { athlete: AthleteData }) {
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
    <SettingsDisclosure
      icon={<User className="size-4" />}
      label="Identity"
      value={
        athlete.birthdate ? `Born ${athlete.birthdate}` : "No birthdate"
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label className="text-xs">First name</Label>
          <Input
            value={firstName}
            maxLength={80}
            onChange={(e) => setFirstName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Last name</Label>
          <Input
            value={lastName}
            maxLength={80}
            onChange={(e) => setLastName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Birthdate</Label>
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
    </SettingsDisclosure>
  );
}

function GoalsSubrow({
  athlete,
  coachSports,
}: {
  athlete: AthleteData;
  coachSports: string[];
}) {
  const defaultSport =
    athlete.goals?.sport || (coachSports.length === 1 ? coachSports[0] : "");
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

  const summary = athlete.goals?.sport
    ? (getSport(athlete.goals.sport)?.label ?? athlete.goals.sport)
    : "Not set";

  return (
    <SettingsDisclosure
      icon={<Target className="size-4" />}
      label="Goals"
      value={summary}
    >
      <AthleteGoalsForm
        athleteName={athlete.firstName}
        availableSports={coachSports}
        value={state}
        onChange={setState}
      />
      <div className="mt-3 flex justify-end">
        <Button size="sm" onClick={handleSave} disabled={!canSave}>
          {saving ? "Saving…" : "Save goals"}
        </Button>
      </div>
    </SettingsDisclosure>
  );
}

function ScheduleSubrow({ athlete }: { athlete: AthleteData }) {
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
      (s) =>
        s.dayOfWeek !== null || s.startMinute !== null || s.endMinute !== null,
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
      startsOn:
        s.frequency === "biweekly" && s.startsOn ? toISODate(s.startsOn) : null,
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

  const summary = athlete.slots.length
    ? `${athlete.slots.length} slot${athlete.slots.length === 1 ? "" : "s"}`
    : "Not set";

  return (
    <SettingsDisclosure
      icon={<CalendarClock className="size-4" />}
      label="Schedule"
      value={summary}
    >
      <ScheduleEditor slots={slots} onChange={setSlots} />
      <div className="mt-3 flex justify-end">
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save schedule"}
        </Button>
      </div>
    </SettingsDisclosure>
  );
}

function InviteSubrow({ athlete }: { athlete: AthleteData }) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const url = athlete.inviteCode
    ? `${origin}/signup/athlete?code=${athlete.inviteCode}`
    : null;
  return (
    <SettingsDisclosure
      icon={<QrCode className="size-4" />}
      label="Athlete invite"
      value={athlete.inviteCode ?? "—"}
    >
      <p className="mb-3 text-xs text-text-tertiary">
        Share this so {athlete.firstName} can sign in to their own account.
      </p>
      <div className="max-w-xs">
        <AthleteInviteCard
          name={`${athlete.firstName} ${athlete.lastName}`}
          code={athlete.inviteCode}
          url={url}
        />
      </div>
    </SettingsDisclosure>
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

  if (confirming) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
        <div className="text-xs text-text-tertiary">
          Remove {athlete.firstName}? Wipes goals, schedule, and invite.
        </div>
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
            {busy ? "Removing…" : "Confirm"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="flex items-center gap-1.5 px-1 text-xs text-destructive hover:underline"
    >
      <Trash2 className="size-3.5" /> Remove athlete
    </button>
  );
}

function AddAthleteForm({ onDone }: { onDone: () => void }) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [birthdate, setBirthdate] = useState("");
  const qc = useQueryClient();
  const create = useServerFn(addAthlete);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!firstName.trim() || !lastName.trim() || !birthdate) return;
    setSaving(true);
    try {
      await create({
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
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label className="text-xs">First name</Label>
          <Input
            value={firstName}
            maxLength={80}
            onChange={(e) => setFirstName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Last name</Label>
          <Input
            value={lastName}
            maxLength={80}
            onChange={(e) => setLastName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Birthdate</Label>
          <Input
            type="date"
            value={birthdate}
            onChange={(e) => setBirthdate(e.target.value)}
          />
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={
            saving || !firstName.trim() || !lastName.trim() || !birthdate
          }
        >
          {saving ? "Adding…" : "Add athlete"}
        </Button>
      </div>
    </div>
  );
}

function SignOutRow() {
  const navigate = useNavigate();
  return (
    <SettingsButtonRow
      icon={<LogOut className="size-4" />}
      label="Sign out"
      tone="destructive"
      onClick={async () => {
        await supabase.auth.signOut();
        navigate({ to: "/login" });
      }}
    />
  );
}
