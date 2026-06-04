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
  UserPlus,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ParentBottomNav } from "@/components/parent/bottom-nav";
import { AthleteInviteCard } from "@/components/parent/athlete-invite-card";

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
  SettingsButtonRow,
  SettingsDisclosure,
} from "@/components/settings/primitives";
import { PageTitle } from "@/components/page-title";
import { ThemeSelect } from "@/components/settings/theme-select";
import { useCurrentUserEmail } from "@/hooks/use-current-user-email";
import {
  getParentSettings,
  updateParentProfile,
  updateAthlete,
  updateAthleteGoals,
  setPrimaryCoach,
  replaceAthleteSchedule,
  addAthlete,
  removeAthlete,
  linkAthleteToCoach,
  unlinkAthleteFromCoach,
} from "@/lib/parent-settings.functions";
import { getSport } from "@/lib/coach-sports";

export const Route = createFileRoute("/_authenticated/parent/settings")({
  component: ParentSettingsPage,
});

type SportEntry = {
  sport: string;
  primaryCoachId: string | null;
  primaryCoachName: string | null;
  eligibleCoaches: { coachId: string; coachName: string }[];
  goals: {
    currentLevelKey: string;
    seasonGoalKey: string;
    longTermGoal: string;
  } | null;
};

type CoachSchedule = {
  coachId: string;
  coachName: string;
  slots: {
    dayOfWeek: number;
    startMinute: number;
    endMinute: number;
    frequency: "weekly" | "biweekly" | "twice_monthly" | "monthly";
    weeksOfMonth: number[];
    startsOn: string | null;
  }[];
};

type AthleteData = {
  id: string;
  firstName: string;
  lastName: string;
  birthdate: string | null;
  inviteCode: string | null;
  coaches: { coachId: string; coachName: string; sports: string[] }[];
  sports: SportEntry[];
  schedulesByCoach: CoachSchedule[];
};

function ParentSettingsPage() {
  const fetchSettings = useServerFn(getParentSettings);
  const { data, isLoading, error } = useQuery({
    queryKey: ["parent-settings"],
    queryFn: () => fetchSettings(),
  });
  const email = useCurrentUserEmail();

  return (
    <>
      <div className="mx-auto min-h-dvh max-w-2xl px-3 pt-6 pb-24">
        <PageTitle>Settings</PageTitle>

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
              <AthletesList athletes={data.athletes as AthleteData[]} />
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

function AthletesList({ athletes }: { athletes: AthleteData[] }) {
  const [adding, setAdding] = useState(false);

  return (
    <SettingsList>
      {athletes.map((a) => (
        <AthleteDisclosure key={a.id} athlete={a} />
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

function AthleteDisclosure({ athlete }: { athlete: AthleteData }) {
  const summary =
    athlete.sports.length > 0
      ? athlete.sports
          .map((s) => getSport(s.sport)?.label ?? s.sport)
          .join(", ")
      : athlete.coaches.length === 0
        ? "No coach linked"
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
          <CoachesSection athlete={athlete} />
          <GoalsSection athlete={athlete} />
          <ScheduleSection athlete={athlete} />
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

function GoalsSection({ athlete }: { athlete: AthleteData }) {
  const summary =
    athlete.sports.length === 0
      ? athlete.coaches.length === 0
        ? "Link a coach first"
        : "Not set"
      : `${athlete.sports.filter((s) => s.goals).length} of ${athlete.sports.length} set`;

  return (
    <SettingsDisclosure
      icon={<Target className="size-4" />}
      label="Goals"
      value={summary}
    >
      {athlete.coaches.length === 0 ? (
        <p className="text-sm text-text-tertiary">
          Request an invite code from {athlete.firstName}'s coach so they can link
          up. Then you'll be able to set goals here.
        </p>
      ) : athlete.sports.length === 0 ? (
        <p className="text-sm text-text-tertiary">
          {athlete.firstName}'s coaches haven't set up their sports yet.
        </p>
      ) : (
        <div className="space-y-5">
          {athlete.sports.map((s) => (
            <GoalsRow key={s.sport} athlete={athlete} sportEntry={s} />
          ))}
        </div>
      )}
    </SettingsDisclosure>
  );
}

function GoalsRow({
  athlete,
  sportEntry,
}: {
  athlete: AthleteData;
  sportEntry: SportEntry;
}) {
  const sportMeta = getSport(sportEntry.sport);
  const [currentLevelKey, setCurrentLevelKey] = useState(
    sportEntry.goals?.currentLevelKey ?? "",
  );
  const [seasonGoalKey, setSeasonGoalKey] = useState(
    sportEntry.goals?.seasonGoalKey ?? "",
  );
  const [longTermGoal, setLongTermGoal] = useState(
    sportEntry.goals?.longTermGoal ?? "",
  );
  const qc = useQueryClient();
  const save = useServerFn(updateAthleteGoals);
  const changePrimary = useServerFn(setPrimaryCoach);
  const [saving, setSaving] = useState(false);
  const [changingPrimary, setChangingPrimary] = useState(false);

  const canSave =
    !!currentLevelKey && !!seasonGoalKey && !saving;

  const handleSave = async () => {
    setSaving(true);
    try {
      await save({
        data: {
          athleteId: athlete.id,
          sport: sportEntry.sport,
          currentLevelKey,
          seasonGoalKey,
          longTermGoal: longTermGoal.trim(),
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

  const handlePrimaryChange = async (coachId: string) => {
    setChangingPrimary(true);
    try {
      await changePrimary({
        data: { athleteId: athlete.id, sport: sportEntry.sport, coachId },
      });
      toast.success("Primary coach updated");
      qc.invalidateQueries({ queryKey: ["parent-settings"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update");
    } finally {
      setChangingPrimary(false);
    }
  };

  return (
    <div className="rounded-lg border border-divider bg-elevated/30 p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="font-medium text-sm">
          {sportMeta?.label ?? sportEntry.sport}
        </div>
        <div className="flex items-center gap-2 text-xs text-text-tertiary">
          <span>Primary coach:</span>
          {sportEntry.eligibleCoaches.length > 1 ? (
            <Select
              value={sportEntry.primaryCoachId ?? undefined}
              onValueChange={handlePrimaryChange}
              disabled={changingPrimary}
            >
              <SelectTrigger className="h-7 w-auto min-w-[8rem] text-xs">
                <SelectValue placeholder="Pick" />
              </SelectTrigger>
              <SelectContent>
                {sportEntry.eligibleCoaches.map((c) => (
                  <SelectItem key={c.coachId} value={c.coachId}>
                    {c.coachName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="text-text-secondary">
              {sportEntry.primaryCoachName ?? "—"}
            </span>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label className="text-xs">Current level</Label>
          {sportMeta && (
            <p className="text-xs uppercase tracking-wider text-text-tertiary">
              {sportMeta.standard}
            </p>
          )}
          <Select
            value={currentLevelKey}
            onValueChange={setCurrentLevelKey}
            disabled={!sportMeta}
          >
            <SelectTrigger>
              <SelectValue placeholder="Pick a level" />
            </SelectTrigger>
            <SelectContent>
              {(sportMeta?.levels ?? []).map((lvl) => (
                <SelectItem key={lvl.key} value={lvl.key}>
                  {lvl.label}
                  {lvl.hint ? ` — ${lvl.hint}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Season goal</Label>
          <p className="text-xs text-text-tertiary">
            Where you&apos;d like {athlete.firstName} to be by the end of the season.
          </p>
          <Select
            value={seasonGoalKey}
            onValueChange={setSeasonGoalKey}
            disabled={!sportMeta}
          >
            <SelectTrigger>
              <SelectValue placeholder="Pick a target level" />
            </SelectTrigger>
            <SelectContent>
              {(sportMeta?.levels ?? []).map((lvl) => (
                <SelectItem key={lvl.key} value={lvl.key}>
                  {lvl.label}
                  {lvl.hint ? ` — ${lvl.hint}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Long-term goal</Label>
          <p className="text-xs text-text-tertiary">
            The bigger picture — college team, junior tour, lifelong skill. Optional.
          </p>
          <textarea
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={longTermGoal}
            onChange={(e) => setLongTermGoal(e.target.value)}
            maxLength={2000}
            rows={3}
            placeholder="e.g. Play D1 college tennis"
          />
        </div>
      </div>

      <div className="mt-3 flex justify-end">
        <Button size="sm" onClick={handleSave} disabled={!canSave}>
          {saving ? "Saving…" : "Save goals"}
        </Button>
      </div>
    </div>
  );
}

function ScheduleSection({ athlete }: { athlete: AthleteData }) {
  const totalSlots = athlete.schedulesByCoach.reduce(
    (n, c) => n + c.slots.length,
    0,
  );
  const summary =
    athlete.coaches.length === 0
      ? "Link a coach first"
      : totalSlots === 0
        ? "Not set"
        : `${totalSlots} slot${totalSlots === 1 ? "" : "s"}`;

  const [selectedCoachId, setSelectedCoachId] = useState<string>(
    athlete.coaches[0]?.coachId ?? "",
  );

  return (
    <SettingsDisclosure
      icon={<CalendarClock className="size-4" />}
      label="Schedule"
      value={summary}
    >
      {athlete.coaches.length === 0 ? (
        <p className="text-sm text-text-tertiary">
          Request an invite code from {athlete.firstName}'s coach so they can link
          up. Then you'll be able to set a schedule here.
        </p>
      ) : (
        <div className="space-y-3">
          {athlete.coaches.length > 1 && (
            <div className="space-y-1.5">
              <Label className="text-xs">Coach</Label>
              <Select value={selectedCoachId} onValueChange={setSelectedCoachId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {athlete.coaches.map((c) => (
                    <SelectItem key={c.coachId} value={c.coachId}>
                      {c.coachName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {athlete.coaches.map((c) =>
            c.coachId === selectedCoachId ? (
              <CoachScheduleEditor
                key={c.coachId}
                athleteId={athlete.id}
                coachId={c.coachId}
                slots={
                  athlete.schedulesByCoach.find((s) => s.coachId === c.coachId)
                    ?.slots ?? []
                }
              />
            ) : null,
          )}
        </div>
      )}
    </SettingsDisclosure>
  );
}

function CoachScheduleEditor({
  athleteId,
  coachId,
  slots: initialSlots,
}: {
  athleteId: string;
  coachId: string;
  slots: CoachSchedule["slots"];
}) {
  const initial: Slot[] = initialSlots.length
    ? initialSlots.map((s) => ({
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
      await save({ data: { athleteId, coachId, slots: cleaned } });
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
      <ScheduleEditor slots={slots} onChange={setSlots} />
      <div className="mt-3 flex justify-end">
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save schedule"}
        </Button>
      </div>
    </div>
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
