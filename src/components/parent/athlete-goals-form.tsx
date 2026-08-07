import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getSport, SPORTS } from "@/lib/coach-sports";

export type GoalsState = {
  sport: string;
  currentLevelKey: string;
  seasonGoalKey: string;
  longTermGoal: string;
};

interface AthleteGoalsFormProps {
  /** Sports the coach offers. */
  availableSports: string[];
  /** Name to interpolate into helper text. */
  athleteName: string;
  value: GoalsState;
  onChange: (next: GoalsState) => void;
}

export function AthleteGoalsForm({
  availableSports,
  athleteName,
  value,
  onChange,
}: AthleteGoalsFormProps) {
  const sportMeta = getSport(value.sport);
  const update = (patch: Partial<GoalsState>) => onChange({ ...value, ...patch });

  return (
    <div className="space-y-5">
      {availableSports.length > 1 && (
        <div className="space-y-2">
          <Label>Sport with this coach</Label>
          <Select
            value={value.sport}
            onValueChange={(v) => update({ sport: v, currentLevelKey: "", seasonGoalKey: "" })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Pick a sport" />
            </SelectTrigger>
            <SelectContent>
              {availableSports.map((s) => (
                <SelectItem key={s} value={s}>
                  {getSport(s)?.label ?? s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="space-y-2">
        <Label>Current level</Label>
        {sportMeta && (
          <p className="text-xs uppercase tracking-wider text-text-tertiary">
            {sportMeta.standard}
          </p>
        )}
        <Select
          value={value.currentLevelKey}
          onValueChange={(v) => update({ currentLevelKey: v })}
          disabled={!sportMeta}
        >
          <SelectTrigger>
            <SelectValue placeholder="Pick a level" />
          </SelectTrigger>
          <SelectContent>
            {(sportMeta?.levels ?? SPORTS[0].levels).map((lvl) => (
              <SelectItem key={lvl.key} value={lvl.key}>
                {lvl.label}
                {lvl.hint ? ` — ${lvl.hint}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Season goal</Label>
        <p className="text-xs text-text-tertiary">
          Where you&apos;d like {athleteName} to be by the end of the season.
        </p>
        <Select
          value={value.seasonGoalKey}
          onValueChange={(v) => update({ seasonGoalKey: v })}
          disabled={!sportMeta}
        >
          <SelectTrigger>
            <SelectValue placeholder="Pick a target level" />
          </SelectTrigger>
          <SelectContent>
            {(sportMeta?.levels ?? SPORTS[0].levels).map((lvl) => (
              <SelectItem key={lvl.key} value={lvl.key}>
                {lvl.label}
                {lvl.hint ? ` — ${lvl.hint}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="longTermGoal">Long-term goal</Label>
        <p className="text-xs text-text-tertiary">
          The bigger picture — college team, junior tour, lifelong skill. Optional.
        </p>
        <Textarea
          id="longTermGoal"
          value={value.longTermGoal}
          onChange={(e) => update({ longTermGoal: e.target.value })}
          maxLength={2000}
          rows={4}
          placeholder="e.g. Play D1 college tennis"
        />
      </div>
    </div>
  );
}
