import { useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addAthleteWithGuardian } from "@/lib/coach-roster-mutations.functions";

/**
 * Lets a coach put a youth athlete on the roster right away by recording the
 * parent/guardian email instead of waiting on the parent to sign up. The
 * guardian gets a claim link immediately and copies of coach messages until
 * they join.
 */
export function AddYouthAthleteCard({
  onSuccess,
  hideHeading = false,
}: {
  onSuccess?: () => void;
  hideHeading?: boolean;
}) {
  const addAthlete = useServerFn(addAthleteWithGuardian);
  const qc = useQueryClient();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [birthdate, setBirthdate] = useState("");
  const [guardianEmail, setGuardianEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await addAthlete({
        data: {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          birthdate,
          ...(guardianEmail.trim() ? { guardianEmail: guardianEmail.trim().toLowerCase() } : {}),
        },
      });
      await qc.invalidateQueries({ queryKey: ["coach-roster"] });
      toast.success("Athlete added — we emailed their parent a link.");
      setFirstName("");
      setLastName("");
      setBirthdate("");
      setGuardianEmail("");
      onSuccess?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className={
        hideHeading ? "space-y-4" : "space-y-4 rounded-xl border border-divider bg-elevated p-4"
      }
    >
      {hideHeading ? null : (
        <div>
          <p className="font-display text-lg text-text-primary">Add an athlete yourself</p>
          <p className="mt-1 text-sm text-text-secondary">
            No code needed. We&apos;ll email their parent a link so they can follow along and join
            when they&apos;re ready.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="ya-first">First name</Label>
          <Input
            id="ya-first"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            required
            maxLength={80}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ya-last">Last name</Label>
          <Input
            id="ya-last"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            required
            maxLength={80}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="ya-dob">Birthday</Label>
        <Input
          id="ya-dob"
          type="date"
          value={birthdate}
          onChange={(e) => setBirthdate(e.target.value)}
          required
          max={new Date().toISOString().slice(0, 10)}
        />
      </div>

      {isMinor && (
        <div className="space-y-1.5">
          <Label htmlFor="ya-guardian">Parent or guardian email</Label>
          <Input
            id="ya-guardian"
            type="email"
            inputMode="email"
            value={guardianEmail}
            onChange={(e) => setGuardianEmail(e.target.value)}
            maxLength={255}
            required
          />
          <p className="text-xs text-text-tertiary">Required for athletes under 18.</p>
        </div>
      )}


      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" className="w-full" disabled={saving}>
        {saving ? "Adding…" : "Add athlete"}
      </Button>
    </form>
  );
}
