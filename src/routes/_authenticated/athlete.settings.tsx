import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { LogOut, Mail, Palette, User } from "lucide-react";
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
import { useCurrentUserEmail } from "@/hooks/use-current-user-email";
import {
  getAthleteSettings,
  updateAthleteSelf,
} from "@/lib/athlete-settings.functions";

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
                  label="Email"
                  value={email ?? "—"}
                />
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
  profile: { firstName: string; lastName: string; birthdate: string | null };
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
