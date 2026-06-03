import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AthleteBottomNav } from "@/components/athlete/bottom-nav";
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

  return (
    <>
      <div className="mx-auto min-h-dvh max-w-2xl px-4 pt-8 pb-24">
        <header className="mb-4">
          <p className="text-xs font-bold uppercase tracking-widest text-accent-ink">
            Settings
          </p>
          <h1 className="mt-1 text-3xl sm:text-4xl">Your account</h1>
        </header>

        {isLoading ? (
          <p className="text-text-tertiary">Loading…</p>
        ) : !data ? (
          <p className="text-text-tertiary">No athlete profile found.</p>
        ) : (
          <div className="space-y-3">
            <ProfileSection profile={data} />
            <AccountSection />
          </div>
        )}
      </div>
      <AthleteBottomNav />
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

function ProfileSection({
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
    <SectionCard title="About you">
      <div className="grid gap-2 sm:grid-cols-3">
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
