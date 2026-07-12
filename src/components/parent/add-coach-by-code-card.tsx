import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Chip } from "@/components/ui/chip";

import {
  linkAthleteToCoach,
  previewCoachByInviteCode,
} from "@/lib/parent-settings.functions";
import { getSport } from "@/lib/coach-sports";

type Athlete = {
  id: string;
  firstName: string;
  lastName: string;
};

/**
 * Parent-side "Add coach by code" entry. Sits in the top-level Coaches
 * section so parents don't have to open an individual athlete disclosure
 * to link a new coach.
 */
export function AddCoachByCodeCard({ athletes }: { athletes: Athlete[] }) {
  const qc = useQueryClient();
  const previewFn = useServerFn(previewCoachByInviteCode);
  const linkFn = useServerFn(linkAthleteToCoach);

  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [lookingUp, setLookingUp] = useState(false);
  const [preview, setPreview] = useState<
    { coachId: string; coachName: string; sports: string[] } | null
  >(null);
  const [athleteId, setAthleteId] = useState<string>(athletes[0]?.id ?? "");
  const [selectedSports, setSelectedSports] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const codeValid = /^[A-Z2-9]{8}$/.test(code.trim().toUpperCase());

  const reset = () => {
    setOpen(false);
    setCode("");
    setPreview(null);
    setSelectedSports([]);
    setAthleteId(athletes[0]?.id ?? "");
  };

  const toggleSport = (s: string) =>
    setSelectedSports((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
    );

  const handleLookup = async () => {
    setLookingUp(true);
    try {
      const result = await previewFn({
        data: { code: code.trim().toUpperCase() },
      });
      setPreview(result);
      setSelectedSports(result.sports.length === 1 ? [result.sports[0]] : []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't find coach");
    } finally {
      setLookingUp(false);
    }
  };

  const handleLink = async () => {
    if (!preview || !athleteId) return;
    setSaving(true);
    try {
      await linkFn({
        data: {
          athleteId,
          code: code.trim().toUpperCase(),
          sports: selectedSports,
        },
      });
      toast.success("Coach linked");
      qc.invalidateQueries({ queryKey: ["parent-settings"] });
      reset();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't link coach");
    } finally {
      setSaving(false);
    }
  };

  if (athletes.length === 0) return null;

  if (!open) {
    return (
      <div className="mb-3">
        <Button
          size="sm"
          variant="outline"
          onClick={() => setOpen(true)}
          className="gap-1.5"
        >
          <Plus className="size-3.5" /> Add a coach
        </Button>
      </div>
    );
  }

  return (
    <div className="mb-3 space-y-3 rounded-xl border border-divider bg-card p-4">
      <div className="flex items-center gap-2">
        <Plus className="size-4 text-text-secondary" />
        <div className="text-sm font-medium">Add a coach</div>
      </div>


      {!preview ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (codeValid) void handleLookup();
          }}
        >
          <div className="space-y-1.5">
            <Label className="text-xs">Coach's invite code</Label>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              maxLength={8}
              placeholder="––––––––"
              className="text-center font-mono text-lg tracking-[0.3em] uppercase"
              autoComplete="off"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              type="button"
              onClick={reset}
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

          {athletes.length > 1 && (
            <div className="space-y-1.5">
              <Label className="text-xs">Which athlete?</Label>
              <div className="flex flex-wrap gap-2">
                {athletes.map((a) => {
                  const selected = athleteId === a.id;
                  return (
                    <Chip
                      key={a.id}
                      as="button"
                      caseSensitive
                      selected={selected}
                      onClick={() => setAthleteId(a.id)}
                    >
                      {`${a.firstName} ${a.lastName}`.trim()}
                    </Chip>
                  );
                })}
              </div>

            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs">Sports with this coach</Label>
            {preview.sports.length === 0 ? (
              <p className="text-xs text-destructive">
                This coach hasn't set up any sports yet.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {preview.sports.map((s) => {
                  const selected = selectedSports.includes(s);
                  return (
                    <Chip
                      key={s}
                      as="button"
                      caseSensitive
                      selected={selected}
                      onClick={() => toggleSport(s)}
                    >
                      {getSport(s)?.label ?? s}
                    </Chip>
                  );
                })}
              </div>

            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={reset}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleLink}
              disabled={
                saving || !athleteId || selectedSports.length === 0
              }
            >
              {saving ? "Linking…" : "Link coach"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
