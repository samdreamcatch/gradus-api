import { useEffect, useState } from "react";
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
  KeyRound,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Chip } from "@/components/ui/chip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ParentBottomNav } from "@/components/parent/bottom-nav";
import { AthleteInviteCard } from "@/components/parent/athlete-invite-card";
import { ConnectCoachSheet } from "@/components/parent/connect-coach-sheet";

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
import { FeedbackSettingsRow } from "@/components/feedback/feedback-fab";
import { InstallAppRow } from "@/components/settings/install-app-row";
import { AccountSecuritySection } from "@/components/settings/account-security-section";
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
  previewCoachByInviteCode,
  updateCoachAthleteSports,
  resetAthletePassword,
} from "@/lib/parent-settings.functions";
import { getSport } from "@/lib/coach-sports";

import { z } from "zod";

const searchSchema = z.object({
  linkCoach: z
    .string()
    .trim()
    .toUpperCase()
    .length(8)
    .regex(/^[A-Z2-9]+$/)
    .optional(),
  checkout: z.string().optional(),
});

export const Route = createFileRoute("/_authenticated/parent/settings")({
  validateSearch: (s) => searchSchema.parse(s),
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
  username: string | null;
  hasAccount: boolean;
  inviteCode: string | null;
  coaches: { coachId: string; coachName: string; sports: string[] }[];
  sports: SportEntry[];
  schedulesByCoach: CoachSchedule[];
};

function ParentSettingsPage() {
  const fetchSettings = useServerFn(getParentSettings);
  const { linkCoach, checkout } = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["parent-settings"],
    queryFn: () => fetchSettings(),
  });
  const email = useCurrentUserEmail();

  // Toast the incoming invite so the parent sees it landed, then let the
  // first athlete's Coaches section auto-open the link form (below).
  useEffect(() => {
    if (linkCoach) toast.success(`Coach invite ${linkCoach} ready to link`);
  }, [linkCoach]);

  // Returning from Stripe checkout — refresh plan data, thank them, and strip
  // the param so a refresh doesn't re-toast.
  useEffect(() => {
    if (checkout !== "return") return;
    void qc.invalidateQueries({ queryKey: ["family-plan-status"] });
    void qc.invalidateQueries({ queryKey: ["family-guardians"] });
    void qc.invalidateQueries({ queryKey: ["parent-settings"] });
    toast.success("Thanks! Your Family plan is being activated.");
    void navigate({
      to: "/parent/settings",
      search: (prev) => ({ ...prev, checkout: undefined }),
      replace: true,
    });
  }, [checkout, qc, navigate]);

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
              <AthletesList
                athletes={data.athletes as AthleteData[]}
                initialLinkCoach={linkCoach ?? null}
                onLinkCoachConsumed={() =>
                  navigate({ to: "/parent/settings", search: {}, replace: true })
                }
              />
            </SettingsGroup>

            <SettingsGroup label="Coaches">
              <ConnectedCoachesList athletes={data.athletes as AthleteData[]} />
              <ConnectCoachSheet athletes={data.athletes as AthleteData[]} />
            </SettingsGroup>

            <SettingsGroup label="Family">
              <FamilySection />
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

            <AccountSecuritySection />

            <SettingsGroup>
              <SettingsList>
                <InstallAppRow />
                <FeedbackSettingsRow />
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

/**
 * Family section — on an active Family plan the parent manages guardians
 * inline (same hub pattern as coaches). Otherwise it routes to the plan page.
 */
function FamilySection() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const fetchGuardians = useServerFn(listFamilyGuardians);
  const remove = useServerFn(removeGuardian);
  const revoke = useServerFn(revokeGuardianInvite);
  const { data, isLoading } = useQuery({
    queryKey: ["family-guardians"],
    queryFn: () => fetchGuardians(),
  });

  const refresh = () => void qc.invalidateQueries({ queryKey: ["family-guardians"] });

  if (isLoading || !data) {
    return (
      <SettingsList>
        <SettingsRow
          icon={<Users className="size-4" />}
          label="Parents & guardians"
          value={isLoading ? "Loading…" : "—"}
        />
      </SettingsList>
    );
  }

  if (!data.planActive) {
    return (
      <SettingsList>
        <SettingsButtonRow
          icon={<Users className="size-4" />}
          label="Parents & guardians"
          description="Add another parent or guardian to your athlete"
          onClick={() => void navigate({ to: "/parent/family", search: {} })}
        />
      </SettingsList>
    );
  }

  return (
    <div className="space-y-2">
      <SettingsList>
        {data.athletes.length === 0 ? (
          <SettingsRow
            icon={<Users className="size-4" />}
            label="Parents & guardians"
            description="Add an athlete first"
          />
        ) : (
          data.athletes.map((a) => (
            <SettingsDisclosure
              key={a.id}
              icon={<Users className="size-4" />}
              label={`${a.firstName} ${a.lastName}`}
              description={`${a.guardians.length + a.invites.length} of 3 guardians`}
              defaultOpen={data.athletes.length === 1}
            >
              <div className="space-y-2">
                {a.guardians.map((g) => (
                  <div
                    key={g.id}
                    className="flex items-center gap-2 rounded-xl border border-divider bg-card px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-text-primary">{g.name}</div>
                      <div className="text-xs text-text-tertiary">
                        {g.role === "primary" ? "Primary" : "Guardian"}
                        {g.isSelf ? " · You" : ""}
                      </div>
                    </div>
                    {g.role === "co" && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          try {
                            await remove({ data: { athleteId: a.id, parentId: g.parentId } });
                            toast.success("Guardian removed");
                            refresh();
                          } catch (e) {
                            toast.error(e instanceof Error ? e.message : "Couldn't remove.");
                          }
                        }}
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                      </Button>
                    )}
                  </div>
                ))}
                {a.invites.map((i) => (
                  <div
                    key={i.id}
                    className="flex items-center gap-2 rounded-xl border border-dashed border-divider px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-text-primary">{i.email ?? "Invite"}</div>
                      <div className="font-mono text-xs text-text-tertiary">
                        Pending · {i.code}
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        try {
                          await revoke({ data: { inviteId: i.id } });
                          toast.success("Invite revoked");
                          refresh();
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : "Couldn't revoke.");
                        }
                      }}
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </Button>
                  </div>
                ))}
              </div>
            </SettingsDisclosure>
          ))
        )}
      </SettingsList>
      <div className="flex justify-end px-1">
        <ConnectGuardianSheet
          athletes={data.athletes.map((a) => ({
            id: a.id,
            firstName: a.firstName,
            lastName: a.lastName,
          }))}
          disabled={data.athletes.length === 0}
        />
      </div>
    </div>
  );
}


function ConnectedCoachesList({ athletes }: { athletes: AthleteData[] }) {
  const qc = useQueryClient();
  const unlink = useServerFn(unlinkAthleteFromCoach);
  const [removing, setRemoving] = useState<string | null>(null);

  const byCoach = new Map<
    string,
    {
      coachId: string;
      coachName: string;
      entries: { athleteId: string; athleteName: string; sports: string[] }[];
    }
  >();
  for (const a of athletes) {
    for (const c of a.coaches) {
      const entry = {
        athleteId: a.id,
        athleteName: `${a.firstName} ${a.lastName}`.trim(),
        sports: c.sports,
      };
      const existing = byCoach.get(c.coachId);
      if (existing) {
        existing.entries.push(entry);
      } else {
        byCoach.set(c.coachId, {
          coachId: c.coachId,
          coachName: c.coachName,
          entries: [entry],
        });
      }
    }
  }
  const coaches = Array.from(byCoach.values());

  const handleUnlink = async (athleteId: string, coachId: string) => {
    setRemoving(`${coachId}:${athleteId}`);
    try {
      await unlink({ data: { athleteId, coachId } });
      toast.success("Coach unlinked");
      qc.invalidateQueries({ queryKey: ["parent-settings"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't unlink");
    } finally {
      setRemoving(null);
    }
  };

  if (coaches.length === 0) {
    return <p className="mb-3 px-1 text-sm text-text-tertiary">No coaches connected yet.</p>;
  }

  return (
    <div className="mb-3 divide-y divide-divider overflow-hidden rounded-xl border border-divider bg-card">
      {coaches.map((c) => (
        <div key={c.coachId} className="px-4 py-3">
          <div className="text-sm font-medium">{c.coachName}</div>
          <ul className="mt-1.5 space-y-1.5">
            {c.entries.map((e) => {
              const sportLabels = e.sports.map((s) => getSport(s)?.label ?? s).join(", ");
              const key = `${c.coachId}:${e.athleteId}`;
              return (
                <li key={key} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 text-xs text-text-secondary">
                    <span className="truncate">{e.athleteName}</span>
                    {sportLabels ? (
                      <span className="text-text-tertiary"> — {sportLabels}</span>
                    ) : null}
                  </span>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 shrink-0 px-2 text-xs text-destructive"
                        disabled={removing === key}
                      >
                        {removing === key ? "Unlinking…" : "Unlink"}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          Unlink {c.coachName} from {e.athleteName}?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          They'll lose access to {e.athleteName}'s plans and messages. Practice
                          history stays intact, and you can re-link later with their invite code.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive text-white"
                          onClick={() => void handleUnlink(e.athleteId, c.coachId)}
                        >
                          Unlink
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function NameDisclosure({ profile }: { profile: { firstName: string; lastName: string } }) {
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
          <Input value={firstName} maxLength={80} onChange={(e) => setFirstName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Last name</Label>
          <Input value={lastName} maxLength={80} onChange={(e) => setLastName(e.target.value)} />
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

function AthletesList({
  athletes,
  initialLinkCoach,
  onLinkCoachConsumed,
}: {
  athletes: AthleteData[];
  initialLinkCoach?: string | null;
  onLinkCoachConsumed?: () => void;
}) {
  const [adding, setAdding] = useState(false);

  return (
    <SettingsList>
      {athletes.map((a, idx) => (
        <AthleteDisclosure
          key={a.id}
          athlete={a}
          initialLinkCoach={idx === 0 ? (initialLinkCoach ?? null) : null}
          onLinkCoachConsumed={idx === 0 ? onLinkCoachConsumed : undefined}
        />
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
  initialLinkCoach,
  onLinkCoachConsumed,
}: {
  athlete: AthleteData;
  initialLinkCoach?: string | null;
  onLinkCoachConsumed?: () => void;
}) {
  const summary =
    athlete.sports.length > 0
      ? athlete.sports.map((s) => getSport(s.sport)?.label ?? s.sport).join(", ")
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
      defaultOpen={!!initialLinkCoach}
    >
      <div className="space-y-3">
        <NestedList>
          <IdentitySubrow athlete={athlete} />
          <CoachesSection
            athlete={athlete}
            initialLinkCoach={initialLinkCoach ?? null}
            onLinkCoachConsumed={onLinkCoachConsumed}
          />
          <GoalsSection athlete={athlete} />
          <ScheduleSection athlete={athlete} />
          <InviteSubrow athlete={athlete} />
          {athlete.hasAccount && <PasswordResetSubrow athlete={athlete} />}
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
      value={athlete.birthdate ? `Born ${athlete.birthdate}` : "No birthdate"}
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
          <Input type="date" value={birthdate} onChange={(e) => setBirthdate(e.target.value)} />
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

function CoachesSection({
  athlete,
  initialLinkCoach,
  onLinkCoachConsumed,
}: {
  athlete: AthleteData;
  initialLinkCoach?: string | null;
  onLinkCoachConsumed?: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [code, setCode] = useState("");
  const [preview, setPreview] = useState<{
    coachId: string;
    coachName: string;
    sports: string[];
  } | null>(null);
  const [selectedSports, setSelectedSports] = useState<string[]>([]);
  const [lookingUp, setLookingUp] = useState(false);
  const qc = useQueryClient();
  const previewFn = useServerFn(previewCoachByInviteCode);
  const link = useServerFn(linkAthleteToCoach);
  const unlink = useServerFn(unlinkAthleteFromCoach);
  const updateSports = useServerFn(updateCoachAthleteSports);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [editingCoachId, setEditingCoachId] = useState<string | null>(null);
  const [editSports, setEditSports] = useState<string[]>([]);
  const [editOptions, setEditOptions] = useState<string[]>([]);
  const [editSaving, setEditSaving] = useState(false);

  const summary = athlete.coaches.length === 0 ? "None linked" : `${athlete.coaches.length} linked`;

  const resetLinkForm = () => {
    setAdding(false);
    setCode("");
    setPreview(null);
    setSelectedSports([]);
  };

  const handleLookup = async (rawCode?: string) => {
    const c = (rawCode ?? code).trim().toUpperCase();
    if (c.length !== 8) return;
    setLookingUp(true);
    try {
      const result = await previewFn({ data: { code: c } });
      setPreview(result);
      // Default: pre-select if there's only one sport
      setSelectedSports(result.sports.length === 1 ? [result.sports[0]] : []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't find coach");
    } finally {
      setLookingUp(false);
    }
  };

  // Auto-open + auto-preview when a coach invite code was passed in via
  // `?linkCoach=CODE` (from the /i/CODE universal invite entry).
  useEffect(() => {
    if (!initialLinkCoach) return;
    setAdding(true);
    setCode(initialLinkCoach);
    void handleLookup(initialLinkCoach);
    onLinkCoachConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLinkCoach]);

  const handleLink = async () => {
    if (!preview) return;
    setSaving(true);
    try {
      await link({
        data: {
          athleteId: athlete.id,
          code: code.trim(),
          sports: selectedSports,
        },
      });
      toast.success("Coach linked");
      resetLinkForm();
      qc.invalidateQueries({ queryKey: ["parent-settings"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't link coach");
    } finally {
      setSaving(false);
    }
  };

  const handleUnlink = async (coachId: string) => {
    setRemovingId(coachId);
    try {
      await unlink({ data: { athleteId: athlete.id, coachId } });
      toast.success("Coach unlinked");
      qc.invalidateQueries({ queryKey: ["parent-settings"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't unlink");
    } finally {
      setRemovingId(null);
    }
  };

  const startEditSports = async (coachId: string, currentSports: string[]) => {
    setEditingCoachId(coachId);
    setEditSports(currentSports);
    // Fetch full set of sports the coach offers (may include ones currently
    // unselected). Reuse the preview function via the coach's own coachId is
    // not possible without an invite code — instead, the union of currently
    // selected sports plus the coach's offerings would be ideal, but the
    // coach's full catalog isn't returned in settings. As a simple solution,
    // start with what's already selected; the parent can remove. Adding a
    // sport later would require re-linking.
    setEditOptions(currentSports);
  };

  const handleSaveSports = async () => {
    if (!editingCoachId) return;
    setEditSaving(true);
    try {
      await updateSports({
        data: {
          athleteId: athlete.id,
          coachId: editingCoachId,
          sports: editSports,
        },
      });
      toast.success("Sports updated");
      setEditingCoachId(null);
      qc.invalidateQueries({ queryKey: ["parent-settings"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update sports");
    } finally {
      setEditSaving(false);
    }
  };

  const toggleSport = (sport: string, list: string[], setList: (l: string[]) => void) => {
    setList(list.includes(sport) ? list.filter((s) => s !== sport) : [...list, sport]);
  };

  return (
    <SettingsDisclosure icon={<UserPlus className="size-4" />} label="Coaches" value={summary}>
      {athlete.coaches.length === 0 ? (
        <p className="mb-3 text-sm text-text-tertiary">
          No coaches linked yet. Ask {athlete.firstName}'s coach for their invite code, then enter
          it below.
        </p>
      ) : (
        <div className="mb-3 space-y-2">
          {athlete.coaches.map((c) => {
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
                        : c.sports.map((s) => getSport(s)?.label ?? s).join(", ")}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {!isEditing && c.sports.length > 0 && (
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
                      Sports {athlete.firstName} does with {c.coachName}
                    </Label>
                    <div className="flex flex-wrap gap-2">
                      {editOptions.map((s) => {
                        const selected = editSports.includes(s);
                        return (
                          <Chip
                            key={s}
                            as="button"
                            caseSensitive
                            selected={selected}
                            onClick={() => toggleSport(s, editSports, setEditSports)}
                          >
                            {getSport(s)?.label ?? s}
                          </Chip>
                        );
                      })}
                    </div>

                    <p className="text-xs text-text-tertiary">
                      Removing a sport here keeps the coach linked but stops tracking that sport
                      with them. To add a sport this coach teaches that isn't shown, unlink and
                      re-link with the invite code.
                    </p>
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setEditingCoachId(null)}>
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

      {athlete.sports.length > 0 && <PrimaryCoachPerSport athlete={athlete} />}

      {adding ? (
        <div className="space-y-2 rounded-lg border border-divider bg-elevated/30 p-3">
          {!preview ? (
            <>
              <Label className="text-xs">Coach's invite code</Label>
              <Input
                value={code}
                maxLength={8}
                placeholder="8-character code"
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                className="font-mono uppercase tracking-widest"
              />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={resetLinkForm}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={() => handleLookup()}
                  disabled={lookingUp || code.trim().length !== 8}
                >
                  {lookingUp ? "Looking up…" : "Continue"}
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm">
                Linking to <span className="font-medium">{preview.coachName}</span>
              </p>
              {preview.sports.length === 0 ? (
                <p className="text-xs text-destructive">
                  This coach hasn't set up any sports yet. Ask them to finish onboarding before
                  linking.
                </p>
              ) : (
                <>
                  <Label className="text-xs">
                    Which sport(s) does {athlete.firstName} do with {preview.coachName}?
                  </Label>
                  <div className="flex flex-wrap gap-2">
                    {preview.sports.map((s) => {
                      const selected = selectedSports.includes(s);
                      return (
                        <Chip
                          key={s}
                          as="button"
                          caseSensitive
                          selected={selected}
                          onClick={() => toggleSport(s, selectedSports, setSelectedSports)}
                        >
                          {getSport(s)?.label ?? s}
                        </Chip>
                      );
                    })}
                  </div>
                </>
              )}
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={resetLinkForm}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleLink}
                  disabled={saving || preview.sports.length === 0 || selectedSports.length === 0}
                >
                  {saving ? "Linking…" : "Link coach"}
                </Button>
              </div>
            </>
          )}
        </div>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setAdding(true)} className="gap-1.5">
          <Plus className="size-3.5" /> Add a coach
        </Button>
      )}
    </SettingsDisclosure>
  );
}

function PrimaryCoachPerSport({ athlete }: { athlete: AthleteData }) {
  const qc = useQueryClient();
  const changePrimary = useServerFn(setPrimaryCoach);
  const [pendingSport, setPendingSport] = useState<string | null>(null);

  const handleChange = async (sport: string, coachId: string) => {
    setPendingSport(sport);
    try {
      await changePrimary({ data: { athleteId: athlete.id, sport, coachId } });
      toast.success("Primary coach updated");
      qc.invalidateQueries({ queryKey: ["parent-settings"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update");
    } finally {
      setPendingSport(null);
    }
  };

  return (
    <div className="mt-4 rounded-lg border border-divider bg-elevated/30 p-3">
      <div className="mb-1 text-sm font-medium">Primary coach per sport</div>
      <p className="mb-3 text-xs text-text-tertiary">
        When more than one coach handles the same sport, pick which one's expectations drive{" "}
        {athlete.firstName}'s goals and practice plans.
      </p>
      <div className="space-y-2">
        {athlete.sports.map((s) => {
          const label = getSport(s.sport)?.label ?? s.sport;
          if (s.eligibleCoaches.length > 1) {
            return (
              <div key={s.sport} className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm">{label}</span>
                <Select
                  value={s.primaryCoachId ?? undefined}
                  onValueChange={(coachId) => handleChange(s.sport, coachId)}
                  disabled={pendingSport === s.sport}
                >
                  <SelectTrigger className="h-8 w-auto min-w-[10rem] text-xs">
                    <SelectValue placeholder="Pick a coach" />
                  </SelectTrigger>
                  <SelectContent>
                    {s.eligibleCoaches.map((c) => (
                      <SelectItem key={c.coachId} value={c.coachId}>
                        {c.coachName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            );
          }
          return (
            <div
              key={s.sport}
              className="flex flex-wrap items-center justify-between gap-2 text-sm"
            >
              <span>{label}</span>
              <span className="text-xs text-text-tertiary">
                {s.primaryCoachName ?? "—"}
                <span className="ml-1 text-text-tertiary/70">(only coach)</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
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
    <SettingsDisclosure icon={<Target className="size-4" />} label="Goals" value={summary}>
      {athlete.coaches.length === 0 ? (
        <p className="text-sm text-text-tertiary">
          Request an invite code from {athlete.firstName}'s coach so they can link up. Then you'll
          be able to set goals here.
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

function GoalsRow({ athlete, sportEntry }: { athlete: AthleteData; sportEntry: SportEntry }) {
  const sportMeta = getSport(sportEntry.sport);
  const [currentLevelKey, setCurrentLevelKey] = useState(sportEntry.goals?.currentLevelKey ?? "");
  const [seasonGoalKey, setSeasonGoalKey] = useState(sportEntry.goals?.seasonGoalKey ?? "");
  const [longTermGoal, setLongTermGoal] = useState(sportEntry.goals?.longTermGoal ?? "");
  const qc = useQueryClient();
  const save = useServerFn(updateAthleteGoals);
  const changePrimary = useServerFn(setPrimaryCoach);
  const [saving, setSaving] = useState(false);
  const [changingPrimary, setChangingPrimary] = useState(false);

  const canSave = !!currentLevelKey && !!seasonGoalKey && !saving;

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
        <div className="font-medium text-sm">{sportMeta?.label ?? sportEntry.sport}</div>
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
            <span className="text-text-secondary">{sportEntry.primaryCoachName ?? "—"}</span>
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
          <Select value={currentLevelKey} onValueChange={setCurrentLevelKey} disabled={!sportMeta}>
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
          <Select value={seasonGoalKey} onValueChange={setSeasonGoalKey} disabled={!sportMeta}>
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
  const totalSlots = athlete.schedulesByCoach.reduce((n, c) => n + c.slots.length, 0);
  const summary =
    athlete.coaches.length === 0
      ? "Link a coach first"
      : totalSlots === 0
        ? "Not set"
        : `${totalSlots} slot${totalSlots === 1 ? "" : "s"}`;

  const [selectedCoachId, setSelectedCoachId] = useState<string>(athlete.coaches[0]?.coachId ?? "");
  const activeCoachId = athlete.coaches.some((c) => c.coachId === selectedCoachId)
    ? selectedCoachId
    : (athlete.coaches[0]?.coachId ?? "");

  return (
    <SettingsDisclosure
      icon={<CalendarClock className="size-4" />}
      label="Schedule"
      value={summary}
    >
      {athlete.coaches.length === 0 ? (
        <p className="text-sm text-text-tertiary">
          Request an invite code from {athlete.firstName}'s coach so they can link up. Then you'll
          be able to set a schedule here.
        </p>
      ) : (
        <div className="space-y-3">
          {athlete.coaches.length > 1 && (
            <div className="space-y-1.5">
              <Label className="text-xs">Coach</Label>
              <Select value={activeCoachId} onValueChange={setSelectedCoachId}>
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
            c.coachId === activeCoachId ? (
              <CoachScheduleEditor
                key={c.coachId}
                athleteId={athlete.id}
                coachId={c.coachId}
                slots={athlete.schedulesByCoach.find((s) => s.coachId === c.coachId)?.slots ?? []}
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
  const url = athlete.inviteCode ? `${origin}/i/${athlete.inviteCode}` : null;
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

function PasswordResetSubrow({ athlete }: { athlete: AthleteData }) {
  const reset = useServerFn(resetAthletePassword);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      toast.error("Passwords don't match.");
      return;
    }
    setSaving(true);
    try {
      await reset({ data: { athleteId: athlete.id, password } });
      toast.success(`Password updated for ${athlete.firstName}.`);
      setPassword("");
      setConfirm("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't reset password");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsDisclosure
      icon={<KeyRound className="size-4" />}
      label="Sign-in"
      value={athlete.username ? `@${athlete.username}` : "Account"}
    >
      <p className="mb-3 text-xs text-text-tertiary">
        {athlete.username
          ? `${athlete.firstName} signs in with @${athlete.username}.`
          : `${athlete.firstName} signs in with their email.`}{" "}
        Set a new password here if they&apos;ve forgotten it.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">New password</Label>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={8}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Confirm password</Label>
          <Input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            minLength={8}
          />
        </div>
      </div>
      <div className="mt-3 flex justify-end">
        <Button
          size="sm"
          onClick={handleSave}
          disabled={saving || password.length < 8 || password !== confirm}
        >
          {saving ? "Saving…" : "Set password"}
        </Button>
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
          <Button size="sm" variant="destructive" onClick={handleRemove} disabled={busy}>
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
          <Input value={firstName} maxLength={80} onChange={(e) => setFirstName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Last name</Label>
          <Input value={lastName} maxLength={80} onChange={(e) => setLastName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Birthdate</Label>
          <Input type="date" value={birthdate} onChange={(e) => setBirthdate(e.target.value)} />
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={saving || !firstName.trim() || !lastName.trim() || !birthdate}
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
