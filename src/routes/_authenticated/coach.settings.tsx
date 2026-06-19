import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useSuspenseQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { LogOut, Mail, Palette, User, Dumbbell, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { SportMultiselect, type SelectedSport } from "@/components/onboarding/sport-multiselect";
import { SPORTS, getSport, type SportKey } from "@/lib/coach-sports";
import {
  coachProfileQueryOptions,
  useSaveCoachLevels,
  useSaveCoachProfile,
} from "@/hooks/use-coach-profile";
import { coachInviteQueryOptions } from "@/hooks/use-coach-invite";
import { InviteCard } from "@/components/onboarding/invite-card";
import { CoachBottomNav } from "@/components/coach/bottom-nav";
import { RosterSettingsSection } from "@/components/coach/roster-settings-section";

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

export const Route = createFileRoute("/_authenticated/coach/settings")({
  loader: ({ context }) => {
    context.queryClient.prefetchQuery(coachInviteQueryOptions);
    return context.queryClient.ensureQueryData(coachProfileQueryOptions);
  },
  component: SettingsPage,
});

type LevelEntry = { sport: string; levelKey: string; hoursPerWeek: number };

function SettingsPage() {
  const { data } = useSuspenseQuery(coachProfileQueryOptions);
  const email = useCurrentUserEmail();
  const sportsSummary =
    Array.from(new Set(data.levels.map((l) => getSport(l.sport)?.label ?? l.sport)))
      .join(", ") || "None yet";

  return (
    <>
      <div className="mx-auto min-h-dvh max-w-2xl px-3 pt-6 pb-24">
        <PageTitle>Settings</PageTitle>

        <SettingsGroup label="My profile">
          <SettingsList>
            <NameDisclosure
              firstName={data.profile.firstName}
              lastName={data.profile.lastName}
            />
            <SettingsRow
              icon={<Mail className="size-4" />}
              label="Email"
              value={email ?? "—"}
            />
          </SettingsList>
        </SettingsGroup>

        <SettingsGroup label="Coaching">
          <SettingsList>
            <SportsDisclosure levels={data.levels} summary={sportsSummary} />
            <RosterSettingsSection />
            <InviteDisclosure />
          </SettingsList>
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
      </div>
      <CoachBottomNav />
    </>
  );
}

function NameDisclosure({
  firstName: f0,
  lastName: l0,
}: {
  firstName: string;
  lastName: string;
}) {
  const [firstName, setFirstName] = useState(f0);
  const [lastName, setLastName] = useState(l0);
  const save = useSaveCoachProfile();

  const handleSave = async () => {
    try {
      await save.mutateAsync({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
      });
      toast.success("Name saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save");
    }
  };

  return (
    <SettingsDisclosure
      icon={<User className="size-4" />}
      label="Name"
      value={`${f0} ${l0}`.trim() || "—"}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">First name</Label>
          <Input
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            maxLength={80}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Last name</Label>
          <Input
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            maxLength={80}
          />
        </div>
      </div>
      <div className="mt-3 flex justify-end">
        <Button
          size="sm"
          onClick={handleSave}
          disabled={
            save.isPending ||
            firstName.trim().length === 0 ||
            lastName.trim().length === 0
          }
        >
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </SettingsDisclosure>
  );
}

function SportsDisclosure({
  levels,
  summary,
}: {
  levels: LevelEntry[];
  summary: string;
}) {
  const initialSports = useMemo(
    () => Array.from(new Set(levels.map((l) => l.sport))) as SportKey[],
    [levels],
  );
  const [sports, setSports] = useState<SportKey[]>(initialSports);
  const [entries, setEntries] = useState<LevelEntry[]>(levels);
  const save = useSaveCoachLevels();

  useEffect(() => {
    setSports(initialSports);
    setEntries(levels);
  }, [initialSports, levels]);

  const toggleSport = (key: SportKey) => {
    setSports((prev) => {
      if (prev.includes(key)) {
        setEntries((es) => es.filter((e) => e.sport !== key));
        return prev.filter((k) => k !== key);
      }
      return [...prev, key];
    });
  };

  const toggleLevel = (sport: SportKey, levelKey: string) => {
    setEntries((prev) => {
      const exists = prev.some(
        (e) => e.sport === sport && e.levelKey === levelKey,
      );
      if (exists)
        return prev.filter(
          (e) => !(e.sport === sport && e.levelKey === levelKey),
        );
      const lvl = getSport(sport)?.levels.find((l) => l.key === levelKey);
      return [
        ...prev,
        { sport, levelKey, hoursPerWeek: lvl?.suggestedHours ?? 0 },
      ];
    });
  };

  const updateHours = (sport: string, levelKey: string, hours: number) => {
    setEntries((prev) =>
      prev.map((e) =>
        e.sport === sport && e.levelKey === levelKey
          ? { ...e, hoursPerWeek: hours }
          : e,
      ),
    );
  };

  const handleSave = async () => {
    try {
      await save.mutateAsync({ entries });
      toast.success("Sports saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save");
    }
  };

  const valid =
    sports.length > 0 && sports.every((s) => entries.some((e) => e.sport === s));

  return (
    <SettingsDisclosure
      icon={<Dumbbell className="size-4" />}
      label="Sports & levels"
      description="Levels you coach and weekly practice expectations"
      value={summary}
    >
      <div className="space-y-5">
        <div>
          <Label className="mb-2 block text-xs">Sports you coach</Label>
          <SportMultiselect
            allowCustom={false}
            customSports={[]}
            selected={sports.map((k): SelectedSport => ({
              key: k,
              label: getSport(k)?.label ?? k,
              custom: false,
            }))}
            onToggle={(s) => toggleSport(s.key as SportKey)}
            onAddCustom={() => ({ status: "added", label: "" })}
            onRemoveCustom={() => {}}
          />
        </div>

        {sports.map((sportKey) => {
          const sport = getSport(sportKey)!;
          const sportEntries = entries.filter((e) => e.sport === sportKey);
          return (
            <div key={sportKey} className="rounded-xl border border-divider bg-card/60 p-3">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="font-display text-base text-text-primary">
                  {sport.label}
                </h3>
                <span className="text-[10px] uppercase tracking-wider text-text-tertiary">
                  {sport.standard}
                </span>
              </div>
              <div className="mt-3 grid gap-1.5">
                {sport.levels.map((lvl) => {
                  const entry = sportEntries.find((e) => e.levelKey === lvl.key);
                  const checked = !!entry;
                  return (
                    <label
                      key={lvl.key}
                      className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-elevated/60"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggleLevel(sportKey, lvl.key)}
                      />
                      <div className="min-w-0 flex-1 leading-tight">
                        <div className="text-sm text-text-primary">
                          {lvl.label}
                        </div>
                        {lvl.hint && (
                          <div className="text-[11px] text-text-tertiary">
                            {lvl.hint}
                          </div>
                        )}
                      </div>
                      {checked && (
                        <div className="flex items-center gap-1.5">
                          <Input
                            type="number"
                            inputMode="decimal"
                            min={0}
                            max={40}
                            step={0.5}
                            value={entry!.hoursPerWeek}
                            onChange={(e) =>
                              updateHours(
                                sportKey,
                                lvl.key,
                                Math.max(
                                  0,
                                  Math.min(40, Number(e.target.value) || 0),
                                ),
                              )
                            }
                            className="h-8 w-16 text-right text-sm"
                          />
                          <span className="text-[11px] text-text-tertiary">
                            hr/wk
                          </span>
                        </div>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}

        <div className="flex justify-end">
          <Button size="sm" onClick={handleSave} disabled={save.isPending || !valid}>
            {save.isPending ? "Saving…" : "Save sports"}
          </Button>
        </div>
      </div>
    </SettingsDisclosure>
  );
}

function InviteDisclosure() {
  return (
    <SettingsDisclosure
      icon={<Send className="size-4" />}
      label="Invite parents"
      description="Share your code so parents can connect"
    >
      <InviteCard compact />
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
