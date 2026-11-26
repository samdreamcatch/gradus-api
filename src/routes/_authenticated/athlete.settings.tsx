import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { LogOut, Mail, Palette, ShieldCheck, User, UserPlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AthleteBottomNav } from "@/components/athlete/bottom-nav";
import {
  SettingsGroup,
  SettingsList,
  SettingsRow,
  SettingsButtonRow,
  SettingsDisclosure,
} from "@/components/settings/primitives";
import { PageTitle } from "@/components/page-title";
import { ThemeSelect } from "@/components/settings/theme-select";
import { SportChip } from "@/components/onboarding/sport-chip";
import { useCurrentUserEmail } from "@/hooks/use-current-user-email";
import { FeedbackSettingsRow } from "@/components/feedback/feedback-fab";
import { AccountSecurityRow } from "@/components/settings/account-security-row";
import { PaymentsRow } from "@/components/settings/payments-row";
import { LegalSection } from "@/components/settings/legal-section";
import { getAthleteSettings, updateAthleteSelf } from "@/lib/athlete-settings.functions";
import { resendGuardianInvite } from "@/lib/guardian.functions";
import { ageInYears } from "@/lib/pending-athlete-dob";
import {
  getCoachOfferedSportsForAdult,
  listAdultAthleteCoaches,
  unlinkAdultAthleteFromCoach,
  updateAdultAthleteCoachSports,
} from "@/lib/adult-athlete-signup.functions";
import { getSport, sportDisplayLabel } from "@/lib/coach-sports";
import {
  getAdultAthleteSchedules,
  saveAdultAthleteScheduleForCoach,
} from "@/lib/adult-athlete-schedule.functions";
import {
  ScheduleEditor,
  emptySlot,
  toISODate,
  validateSlots,
  type Slot,
} from "@/components/parent/schedule-editor";
import { ConnectCoachSheet } from "@/components/parent/connect-coach-sheet";

import { z } from "zod";

const searchSchema = z.object({
  linkCoach: z
    .string()
    .trim()
    .toUpperCase()
    .length(8)
    .regex(/^[A-Z2-9]+$/)
    .optional(),
});

export const Route = createFileRoute("/_authenticated/athlete/settings")({
  validateSearch: (s) => searchSchema.parse(s),
  component: AthleteSettingsPage,
});

function AthleteSettingsPage() {
  const fetchSettings = useServerFn(getAthleteSettings);
  const { linkCoach } = Route.useSearch();
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ["athlete-settings"],
    queryFn: () => fetchSettings(),
  });
  const email = useCurrentUserEmail();

  const fetchCoaches = useServerFn(listAdultAthleteCoaches);
  const { data: coachData } = useQuery({
    queryKey: ["adult-athlete-coaches"],
    queryFn: () => fetchCoaches(),
  });
  const showCoaches = coachData?.hasAthlete === true;

  useEffect(() => {
    if (linkCoach) toast.success(`Coach invite ${linkCoach} ready to link`);
  }, [linkCoach]);

  return (
    <>
      <div className="mx-auto min-h-dvh max-w-2xl px-3 pt-6 pb-app-chrome">
        <PageTitle>Settings</PageTitle>

        {isLoading ? (
          <p className="px-3 text-text-tertiary">Loading…</p>
        ) : !data ? (
          <p className="px-3 text-text-tertiary">No athlete profile found.</p>
        ) : (
          <>
            <SettingsGroup label="My profile">
              <SettingsList>
                <ProfileDisclosure profile={data} />
                <SettingsRow
                  icon={<Mail className="size-4" />}
                  label={data.username ? "Username" : "Email"}
                  value={data.username ? `@${data.username}` : (email ?? "—")}
                />
                <GuardianRow athlete={data} />
              </SettingsList>
            </SettingsGroup>

            {showCoaches && (
              <SettingsGroup label="Coaches">
                <SettingsList>
                  <AdultCoachesSection coaches={coachData?.coaches ?? []} />
                </SettingsList>
                <div className="mt-3">
                  {coachData?.needsGuardianEmail ? (
                    <p className="px-1 text-xs text-text-tertiary">
                      Add a parent or guardian email above, then you can invite a coach or enter
                      their code.
                    </p>
                  ) : (
                    <ConnectCoachSheet
                      audience="adult-athlete"
                      initialCode={linkCoach ?? null}
                      onInitialCodeConsumed={() =>
                        navigate({
                          to: "/athlete/settings",
                          search: {},
                          replace: true,
                        })
                      }
                    />
                  )}
                </div>
              </SettingsGroup>
            )}

            <SettingsGroup label="Preferences">
              <SettingsList>
                <SettingsRow
                  icon={<Palette className="size-4" />}
                  label="Appearance"
                  trailing={<ThemeSelect />}
                />
              </SettingsList>
            </SettingsGroup>

            <SettingsGroup label="Account">
              <PaymentsRow to="/athlete/settings/payments" />
              <AccountSecurityRow to="/athlete/settings/account" />
            </SettingsGroup>

            <SettingsGroup label="Support">
              <SettingsList>
                <FeedbackSettingsRow />
              </SettingsList>
            </SettingsGroup>

            <LegalSection />

            <SettingsList className="mt-6">
              <SignOutRow />
            </SettingsList>
          </>
        )}
      </div>
      <AthleteBottomNav />
    </>
  );
}

function ProfileDisclosure({
  profile,
}: {
  profile: {
    firstName: string;
    lastName: string;
    birthdate: string | null;
    username: string | null;
  };
}) {
  const [firstName, setFirstName] = useState(profile.firstName);
  const [lastName, setLastName] = useState(profile.lastName);
  const [birthdate, setBirthdate] = useState(profile.birthdate ?? "");
  const qc = useQueryClient();
  const save = useServerFn(updateAthleteSelf);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await save({
        data: {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          birthdate: birthdate.trim() ? birthdate.trim() : null,
        },
      });
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: ["athlete-settings"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsDisclosure
      icon={<User className="size-4" />}
      label="Name & birthdate"
      value={`${profile.firstName} ${profile.lastName}`.trim()}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label className="text-xs">First name</Label>
          <Input value={firstName} maxLength={80} onChange={(e) => setFirstName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Last name</Label>
          <Input value={lastName} maxLength={80} onChange={(e) => setLastName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Birthdate</Label>
          <Input
            type="date"
            value={birthdate}
            disabled={Boolean(profile.birthdate)}
            onChange={(e) => setBirthdate(e.target.value)}
          />
          {profile.birthdate ? (
            <p className="text-xs text-muted-foreground">
              Your birthdate can't be changed. Contact support if it's wrong.
            </p>
          ) : null}
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

type AdultCoach = { coachId: string; coachName: string; sports: string[] };

function AdultCoachesSection({ coaches }: { coaches: AdultCoach[] }) {
  const qc = useQueryClient();
  const unlinkFn = useServerFn(unlinkAdultAthleteFromCoach);
  const updateSportsFn = useServerFn(updateAdultAthleteCoachSports);
  const offeredFn = useServerFn(getCoachOfferedSportsForAdult);

  const [removingId, setRemovingId] = useState<string | null>(null);
  const [editingCoachId, setEditingCoachId] = useState<string | null>(null);
  const [editOptions, setEditOptions] = useState<string[]>([]);
  const [editSports, setEditSports] = useState<string[]>([]);
  const [editSaving, setEditSaving] = useState(false);
  const [scheduleCoachId, setScheduleCoachId] = useState<string | null>(null);

  const summary = coaches.length === 0 ? "None linked" : `${coaches.length} linked`;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["adult-athlete-coaches"] });
  };

  const handleUnlink = async (coachId: string) => {
    setRemovingId(coachId);
    try {
      await unlinkFn({ data: { coachId } });
      toast.success("Coach unlinked");
      invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't unlink");
    } finally {
      setRemovingId(null);
    }
  };

  const startEditSports = async (coachId: string, currentSports: string[]) => {
    setEditingCoachId(coachId);
    setEditSports(currentSports);
    // Load the coach's full offered catalog so the athlete can add sports too.
    try {
      const res = await offeredFn({ data: { coachId } });
      const union = Array.from(new Set([...res.sports, ...currentSports]));
      setEditOptions(union);
    } catch {
      setEditOptions(currentSports);
    }
  };

  const handleSaveSports = async () => {
    if (!editingCoachId) return;
    setEditSaving(true);
    try {
      await updateSportsFn({
        data: { coachId: editingCoachId, sports: editSports },
      });
      toast.success("Sports updated");
      setEditingCoachId(null);
      invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update sports");
    } finally {
      setEditSaving(false);
    }
  };

  const toggle = (sport: string, list: string[], setList: (l: string[]) => void) => {
    setList(list.includes(sport) ? list.filter((s) => s !== sport) : [...list, sport]);
  };

  return (
    <SettingsDisclosure icon={<UserPlus className="size-4" />} label="Coaches" value={summary}>
      {coaches.length === 0 ? (
        <p className="mb-3 text-sm text-text-tertiary">
          No coaches linked yet. Use “Add a coach” below to invite them or enter their code.
        </p>
      ) : (
        <div className="mb-3 space-y-2">
          {coaches.map((c) => {
            const isEditing = editingCoachId === c.coachId;
            return (
              <div
                key={c.coachId}
                className="rounded-lg border border-divider bg-elevated/30 px-3 py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{c.coachName}</div>
                    <div className="truncate text-xs text-text-tertiary">
                      {c.sports.length === 0
                        ? "No sports set"
                        : c.sports.map((s) => sportDisplayLabel(s)).join(", ")}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-1">
                    {!isEditing && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => startEditSports(c.coachId, c.sports)}
                      >
                        Edit sports
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setScheduleCoachId(scheduleCoachId === c.coachId ? null : c.coachId)
                      }
                    >
                      {scheduleCoachId === c.coachId ? "Close schedule" : "Schedule"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleUnlink(c.coachId)}
                      disabled={removingId === c.coachId}
                      className="text-destructive hover:text-destructive"
                    >
                      {removingId === c.coachId ? "Removing…" : "Unlink"}
                    </Button>
                  </div>
                </div>
                {scheduleCoachId === c.coachId && (
                  <div className="mt-3 border-t border-divider pt-3">
                    <CoachScheduleEditor
                      coachId={c.coachId}
                      coachName={c.coachName}
                      onDone={() => setScheduleCoachId(null)}
                    />
                  </div>
                )}
                {isEditing && (
                  <div className="mt-3 space-y-2 border-t border-divider pt-3">
                    <Label className="text-xs">Sports you do with {c.coachName}</Label>
                    <div className="flex flex-wrap gap-2">
                      {editOptions.map((s) => {
                        const checked = editSports.includes(s);
                        return (
                          <SportChip
                            key={s}
                            selected={checked}
                            onClick={() => toggle(s, editSports, setEditSports)}
                          >
                            {sportDisplayLabel(s)}
                          </SportChip>
                        );
                      })}
                    </div>
                    <div className="flex justify-end gap-2 pt-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditingCoachId(null)}
                        disabled={editSaving}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleSaveSports}
                        disabled={editSaving || editSports.length === 0}
                      >
                        {editSaving ? "Saving…" : "Save"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </SettingsDisclosure>
  );
}

/**
 * Parent/guardian email on file. Only shown while the athlete is under 18 —
 * adults who signed up 18+ never see it. Saving re-issues the claim invite.
 */
function GuardianRow({
  athlete,
}: {
  athlete: {
    id: string;
    birthdate: string | null;
    guardianEmail: string | null;
    guardianInvitedAt: string | null;
    guardianClaimed: boolean;
    accountState?: "active" | "provisional" | "paused";
  };
}) {
  const qc = useQueryClient();
  const resend = useServerFn(resendGuardianInvite);
  const [value, setValue] = useState(athlete.guardianEmail ?? "");
  const [saving, setSaving] = useState(false);

  const age = athlete.birthdate ? ageInYears(athlete.birthdate) : null;
  const isMinor = age !== null && age < 18;
  if (!isMinor) return null;

  if (athlete.guardianClaimed) {
    return (
      <SettingsRow
        icon={<ShieldCheck className="size-4" />}
        label="Parent or guardian"
        value={athlete.guardianEmail ?? "On Gradus"}
      />
    );
  }

  const emailValid = /^\S+@\S+\.\S+$/.test(value.trim());
  const changed = value.trim().toLowerCase() !== (athlete.guardianEmail ?? "").toLowerCase();

  const handleSave = async () => {
    if (!emailValid) return;
    setSaving(true);
    try {
      await resend({
        data: { athleteId: athlete.id, guardianEmail: value.trim().toLowerCase() },
      });
      toast.success(changed ? "Guardian email updated" : "Invite re-sent");
      qc.invalidateQueries({ queryKey: ["athlete-settings"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsDisclosure
      icon={<ShieldCheck className="size-4" />}
      label="Parent or guardian"
      value={athlete.guardianEmail ?? "Needed"}
    >
      {athlete.accountState === "provisional" ? (
        <p
          className="mb-3 rounded-lg border border-divider bg-elevated p-3 text-xs text-text-secondary"
          role="status"
        >
          Waiting for your parent. Until they claim your account you can set goals and see plans,
          but you can&apos;t connect a coach or message. Check they got the email, or resend it
          below.
        </p>
      ) : null}
      <p className="mb-3 text-xs text-text-secondary">
        {athlete.guardianInvitedAt
          ? "We emailed them a link to follow along. They haven't joined yet — check the address or send it again."
          : "Because you're under 18, we keep a parent or guardian email on file and send them a link to follow along."}
      </p>
      <div className="space-y-1.5">
        <Label className="text-xs">Parent or guardian email</Label>
        <Input
          type="email"
          inputMode="email"
          autoComplete="email"
          value={value}
          maxLength={160}
          placeholder="parent@example.com"
          onChange={(e) => setValue(e.target.value)}
        />
      </div>
      <div className="mt-3 flex justify-end">
        <Button size="sm" onClick={handleSave} disabled={saving || !emailValid}>
          {saving ? "Saving…" : changed ? "Save & send invite" : "Re-send invite"}
        </Button>
      </div>
    </SettingsDisclosure>
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

function CoachScheduleEditor({
  coachId,
  coachName,
  onDone,
}: {
  coachId: string;
  coachName: string;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const fetchSchedules = useServerFn(getAdultAthleteSchedules);
  const saveFn = useServerFn(saveAdultAthleteScheduleForCoach);

  const { data, isLoading } = useQuery({
    queryKey: ["adult-athlete-schedules"],
    queryFn: () => fetchSchedules(),
  });

  const coach = data?.coaches.find((c) => c.coachId === coachId);
  const initial: Slot[] =
    coach && coach.slots.length > 0
      ? coach.slots.map((s) => ({
          dayOfWeek: s.dayOfWeek,
          startMinute: s.startMinute,
          endMinute: s.endMinute,
          frequency: s.frequency,
          weeksOfMonth: s.weeksOfMonth,
          startsOn: s.startsOn ? new Date(s.startsOn + "T00:00:00") : null,
        }))
      : [emptySlot()];

  const [slots, setSlots] = useState<Slot[]>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isLoading) {
    return <p className="text-sm text-text-tertiary">Loading schedule…</p>;
  }

  const save = async () => {
    setError(null);
    const filtered = slots.filter(
      (s): s is Slot & { dayOfWeek: number; startMinute: number; endMinute: number } =>
        s.dayOfWeek !== null && s.startMinute !== null && s.endMinute !== null,
    );
    const err = filtered.length ? validateSlots(filtered) : null;
    if (err) {
      setError(err);
      return;
    }
    const cleaned = filtered.map((s) => ({
      dayOfWeek: s.dayOfWeek,
      startMinute: s.startMinute,
      endMinute: s.endMinute,
      frequency: s.frequency,
      weeksOfMonth:
        s.frequency === "weekly" || s.frequency === "biweekly"
          ? []
          : [...s.weeksOfMonth].sort((a, b) => a - b),
      startsOn: s.frequency === "biweekly" && s.startsOn ? toISODate(s.startsOn) : null,
    }));
    setSaving(true);
    try {
      await saveFn({ data: { coachId, slots: cleaned } });
      toast.success("Schedule saved");
      qc.invalidateQueries({ queryKey: ["adult-athlete-schedules"] });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <Label className="text-xs">Your lessons with {coachName}</Label>
      <ScheduleEditor slots={slots} onChange={setSlots} />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onDone} disabled={saving}>
          Cancel
        </Button>
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save schedule"}
        </Button>
      </div>
    </div>
  );
}
