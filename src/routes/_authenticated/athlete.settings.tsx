import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { LogOut, Mail, Palette, User, UserPlus } from "lucide-react";
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
import {
  getAthleteSettings,
  updateAthleteSelf,
} from "@/lib/athlete-settings.functions";
import {
  getCoachOfferedSportsForAdult,
  linkAdultAthleteToCoach,
  listAdultAthleteCoaches,
  previewCoachForAdultAthlete,
  unlinkAdultAthleteFromCoach,
  updateAdultAthleteCoachSports,
} from "@/lib/adult-athlete-signup.functions";
import { getSport } from "@/lib/coach-sports";
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

export const Route = createFileRoute("/_authenticated/athlete/settings")({
  component: AthleteSettingsPage,
});

function AthleteSettingsPage() {
  const fetchSettings = useServerFn(getAthleteSettings);
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
  const isSelfManaged = coachData?.selfManaged === true;

  return (
    <>
      <div className="mx-auto min-h-dvh max-w-2xl px-3 pt-6 pb-24">
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
              </SettingsList>
            </SettingsGroup>

            {isSelfManaged && (
              <SettingsGroup label="My coaches">
                <SettingsList>
                  <AdultCoachesSection
                    coaches={coachData?.coaches ?? []}
                  />
                </SettingsList>
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

            <SettingsGroup>
              <SettingsList>
                <FeedbackSettingsRow />
                <SignOutRow />
              </SettingsList>
            </SettingsGroup>
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
  profile: { firstName: string; lastName: string; birthdate: string | null; username: string | null };
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

type AdultCoach = { coachId: string; coachName: string; sports: string[] };

function AdultCoachesSection({ coaches }: { coaches: AdultCoach[] }) {
  const qc = useQueryClient();
  const previewFn = useServerFn(previewCoachForAdultAthlete);
  const linkFn = useServerFn(linkAdultAthleteToCoach);
  const unlinkFn = useServerFn(unlinkAdultAthleteFromCoach);
  const updateSportsFn = useServerFn(updateAdultAthleteCoachSports);
  const offeredFn = useServerFn(getCoachOfferedSportsForAdult);

  const [adding, setAdding] = useState(false);
  const [code, setCode] = useState("");
  const [preview, setPreview] = useState<
    { coachId: string; coachName: string; sports: string[] } | null
  >(null);
  const [selectedSports, setSelectedSports] = useState<string[]>([]);
  const [lookingUp, setLookingUp] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [editingCoachId, setEditingCoachId] = useState<string | null>(null);
  const [editOptions, setEditOptions] = useState<string[]>([]);
  const [editSports, setEditSports] = useState<string[]>([]);
  const [editSaving, setEditSaving] = useState(false);

  const summary =
    coaches.length === 0 ? "None linked" : `${coaches.length} linked`;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["adult-athlete-coaches"] });
  };

  const resetLinkForm = () => {
    setAdding(false);
    setCode("");
    setPreview(null);
    setSelectedSports([]);
  };

  const handleLookup = async () => {
    setLookingUp(true);
    try {
      const result = await previewFn({ data: { code: code.trim() } });
      setPreview(result);
      setSelectedSports(result.sports.length === 1 ? [result.sports[0]] : []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't find coach");
    } finally {
      setLookingUp(false);
    }
  };

  const handleLink = async () => {
    if (!preview) return;
    setSaving(true);
    try {
      await linkFn({
        data: { code: code.trim(), sports: selectedSports },
      });
      toast.success("Coach linked");
      resetLinkForm();
      invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't link coach");
    } finally {
      setSaving(false);
    }
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

  const toggle = (
    sport: string,
    list: string[],
    setList: (l: string[]) => void,
  ) => {
    setList(list.includes(sport) ? list.filter((s) => s !== sport) : [...list, sport]);
  };

  const codeValid = /^[A-Z2-9]{8}$/.test(code.trim().toUpperCase());

  return (
    <SettingsDisclosure
      icon={<UserPlus className="size-4" />}
      label="Coaches"
      value={summary}
    >
      {coaches.length === 0 ? (
        <p className="mb-3 text-sm text-text-tertiary">
          No coaches linked yet. Ask your coach for their invite code, then
          enter it below.
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
                    <div className="truncate text-sm font-medium">
                      {c.coachName}
                    </div>
                    <div className="truncate text-xs text-text-tertiary">
                      {c.sports.length === 0
                        ? "No sports set"
                        : c.sports
                            .map((s) => getSport(s)?.label ?? s)
                            .join(", ")}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
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
                      onClick={() => handleUnlink(c.coachId)}
                      disabled={removingId === c.coachId}
                      className="text-destructive hover:text-destructive"
                    >
                      {removingId === c.coachId ? "Removing…" : "Unlink"}
                    </Button>
                  </div>
                </div>
                {isEditing && (
                  <div className="mt-3 space-y-2 border-t border-divider pt-3">
                    <Label className="text-xs">
                      Sports you do with {c.coachName}
                    </Label>
                    <div className="flex flex-wrap gap-2">
                      {editOptions.map((s) => {
                        const checked = editSports.includes(s);
                        return (
                          <SportChip
                            key={s}
                            selected={checked}
                            onClick={() => toggle(s, editSports, setEditSports)}
                          >
                            {getSport(s)?.label ?? s}
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

      {!adding ? (
        <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
          Link a coach
        </Button>
      ) : !preview ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            handleLookup();
          }}
        >
          <Label className="text-xs">Coach invite code</Label>
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={8}
            placeholder="––––––––"
            className="text-center font-mono text-lg tracking-[0.3em] uppercase"
            autoComplete="off"
          />
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              type="button"
              onClick={resetLinkForm}
              disabled={lookingUp}
            >
              Cancel
            </Button>
            <Button size="sm" type="submit" disabled={!codeValid || lookingUp}>
              {lookingUp ? "Looking up…" : "Look up"}
            </Button>
          </div>
        </form>
      ) : (
        <div className="space-y-3">
          <div className="rounded-lg border border-divider bg-elevated/30 px-3 py-2">
            <div className="text-xs text-text-tertiary">Coach</div>
            <div className="text-sm font-medium">{preview.coachName}</div>
          </div>
          <div>
            <Label className="text-xs">Sports you do with this coach</Label>
            <div className="mt-2 flex flex-wrap gap-2">
              {preview.sports.map((s) => {
                const checked = selectedSports.includes(s);
                return (
                  <SportChip
                    key={s}
                    selected={checked}
                    onClick={() =>
                      toggle(s, selectedSports, setSelectedSports)
                    }
                  >
                    {getSport(s)?.label ?? s}
                  </SportChip>
                );
              })}
            </div>
            {preview.sports.length === 0 && (
              <p className="mt-2 text-xs text-text-tertiary">
                This coach hasn&apos;t set up sports yet.
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={resetLinkForm}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleLink}
              disabled={saving || selectedSports.length === 0}
            >
              {saving ? "Linking…" : "Link coach"}
            </Button>
          </div>
        </div>
      )}
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

