import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SportChip } from "@/components/onboarding/sport-chip";
import { getSport, sportDisplayLabel } from "@/lib/coach-sports";
import {
  linkAdultAthleteToCoach,
  previewCoachForAdultAthlete,
} from "@/lib/adult-athlete-signup.functions";

/**
 * Code-entry flow for a self-managed athlete linking themselves to a coach.
 * Mirrors the parent-side `AddCoachByCodeCard` so both can live inside the
 * shared "Add a coach" sheet.
 */
export function AddCoachByCodeAdultCard({
  initialCode,
  onSuccess,
  onCancel,
}: {
  initialCode?: string | null;
  onSuccess?: () => void;
  onCancel?: () => void;
}) {
  const qc = useQueryClient();
  const previewFn = useServerFn(previewCoachForAdultAthlete);
  const linkFn = useServerFn(linkAdultAthleteToCoach);

  const [code, setCode] = useState(initialCode ?? "");
  const [preview, setPreview] = useState<{
    coachId: string;
    coachName: string;
    sports: string[];
  } | null>(null);
  const [selectedSports, setSelectedSports] = useState<string[]>([]);
  const [lookingUp, setLookingUp] = useState(false);
  const [saving, setSaving] = useState(false);

  const codeValid = /^[A-Z2-9]{8}$/.test(code.trim().toUpperCase());

  const handleLookup = async (rawCode?: string) => {
    const c = (rawCode ?? code).trim().toUpperCase();
    if (!/^[A-Z2-9]{8}$/.test(c)) return;
    setLookingUp(true);
    try {
      const result = await previewFn({ data: { code: c } });
      setPreview(result);
      setSelectedSports(result.sports.length === 1 ? [result.sports[0]] : []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't find coach");
    } finally {
      setLookingUp(false);
    }
  };

  // Deep link: `?linkCoach=CODE` pre-fills and looks the coach up right away.
  useEffect(() => {
    if (!initialCode) return;
    setCode(initialCode);
    void handleLookup(initialCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCode]);

  const handleLink = async () => {
    if (!preview) return;
    setSaving(true);
    try {
      await linkFn({ data: { code: code.trim(), sports: selectedSports } });
      toast.success("Coach linked");
      setCode("");
      setPreview(null);
      setSelectedSports([]);
      qc.invalidateQueries({ queryKey: ["adult-athlete-coaches"] });
      onSuccess?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't link coach");
    } finally {
      setSaving(false);
    }
  };

  const toggle = (sport: string) => {
    setSelectedSports((list) =>
      list.includes(sport) ? list.filter((s) => s !== sport) : [...list, sport],
    );
  };

  if (!preview) {
    return (
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void handleLookup();
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
          <Button size="sm" variant="ghost" type="button" onClick={onCancel} disabled={lookingUp}>
            Cancel
          </Button>
          <Button size="sm" type="submit" disabled={!codeValid || lookingUp}>
            {lookingUp ? "Looking up…" : "Look up"}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-divider bg-elevated/30 px-3 py-2">
        <div className="text-xs text-text-tertiary">Coach</div>
        <div className="text-sm font-medium">{preview.coachName}</div>
      </div>
      <div>
        <Label className="text-xs">Sports you do with this coach</Label>
        <div className="mt-2 flex flex-wrap gap-2">
          {preview.sports.map((s) => (
            <SportChip key={s} selected={selectedSports.includes(s)} onClick={() => toggle(s)}>
              {sportDisplayLabel(s)}
            </SportChip>
          ))}
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
          onClick={() => {
            setPreview(null);
            setSelectedSports([]);
          }}
          disabled={saving}
        >
          Back
        </Button>
        <Button size="sm" onClick={handleLink} disabled={saving || selectedSports.length === 0}>
          {saving ? "Linking…" : "Link coach"}
        </Button>
      </div>
    </div>
  );
}
