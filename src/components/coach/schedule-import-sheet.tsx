import { useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Camera,
  Check,
  ChevronLeft,
  Download,
  FileSpreadsheet,
  Pencil,
  Plus,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { getSport, type SportKey } from "@/lib/coach-sports";
import {
  blankRow,
  CSV_TEMPLATE,
  formatTimeLabel,
  groupRowsByAthlete,
  hhmmToMinutes,
  IMPORT_DAYS,
  IMPORT_FREQUENCIES,
  minutesToHHMM,
  parseScheduleCsv,
  rowsFromParsedLessons,
  validateRow,
  type ImportFrequency,
  type ImportRow,
} from "@/lib/schedule-import";
import {
  commitScheduleImport,
  matchScheduleRows,
  parseScheduleImage,
  type ImportOutcome,
  type MatchResult,
} from "@/lib/schedule-import.functions";

type Step = "source" | "review" | "match" | "done";

/** Per-athlete decision made on the match step. */
type Decision = { athleteId: string | null };

const LABEL = "mb-1 block text-[11px] font-bold uppercase tracking-widest text-text-tertiary";

export function ScheduleImportSheet({
  open,
  onOpenChange,
  coachSports,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  coachSports: string[];
}) {
  const qc = useQueryClient();
  const defaultSport = coachSports.length === 1 ? coachSports[0] : "";
  const [step, setStep] = useState<Step>("source");
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [matches, setMatches] = useState<MatchResult[]>([]);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [outcomes, setOutcomes] = useState<ImportOutcome[]>([]);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const groups = useMemo(() => groupRowsByAthlete(rows), [rows]);
  const invalidCount = useMemo(
    () => rows.filter((r) => Object.keys(validateRow(r)).length > 0).length,
    [rows],
  );

  const reset = () => {
    setStep("source");
    setRows([]);
    setMatches([]);
    setDecisions({});
    setOutcomes([]);
  };

  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) reset();
  };

  const parseImage = useMutation({
    mutationFn: async (file: File) => {
      const dataUrl = await fileToDataUrl(file);
      return parseScheduleImage({ data: { imageDataUrl: dataUrl } });
    },
    onSuccess: (res) => {
      const parsed = rowsFromParsedLessons(res.lessons, defaultSport);
      if (parsed.length === 0) {
        toast.error("No lessons found in that photo.");
        return;
      }
      setRows(parsed);
      setStep("review");
      toast.success(`Found ${parsed.length} lesson${parsed.length === 1 ? "" : "s"}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const runMatch = useMutation({
    mutationFn: () =>
      matchScheduleRows({
        data: {
          athletes: groups.map((g) => ({
            key: g.key,
            firstName: g.firstName,
            lastName: g.lastName,
            guardianEmail: g.guardianEmail,
            athleteEmail: g.athleteEmail,
          })),
        },
      }),
    onSuccess: (res) => {
      setMatches(res.results);
      const next: Record<string, Decision> = {};
      for (const m of res.results) next[m.key] = { athleteId: m.suggestedAthleteId };
      setDecisions(next);
      setStep("match");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const commit = useMutation({
    mutationFn: () =>
      commitScheduleImport({
        data: {
          groups: groups.map((g) => ({
            key: g.key,
            firstName: g.firstName,
            lastName: g.lastName,
            guardianEmail: g.guardianEmail,
            athleteEmail: g.athleteEmail,
            sport: g.sport || defaultSport,
            matchedAthleteId: decisions[g.key]?.athleteId ?? null,
            slots: g.rows.map((r) => ({
              dayOfWeek: r.dayOfWeek as number,
              startMinute: r.startMinute as number,
              endMinute: (r.startMinute as number) + (r.lengthMinutes as number),
              frequency: r.frequency,
            })),
          })),
        },
      }),
    onSuccess: (res) => {
      setOutcomes(res.outcomes);
      setStep("done");
      qc.invalidateQueries({ queryKey: ["coach", "roster"] });
      qc.invalidateQueries({ queryKey: ["coach", "roster", "practice-summaries"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleCsv = async (file: File) => {
    const text = await file.text();
    const { rows: parsed, error } = parseScheduleCsv(text, defaultSport);
    if (error) {
      toast.error(error);
      return;
    }
    setRows(parsed);
    setStep("review");
  };

  const updateRow = (id: string, patch: Partial<ImportRow>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const title =
    step === "source"
      ? "Import your schedule"
      : step === "review"
        ? "Review lessons"
        : step === "match"
          ? "Check for existing accounts"
          : "Import complete";

  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent side="bottom" className="paper-surface max-h-[92dvh] overflow-y-auto">
        <SheetHeader className="text-left">
          <div className="flex items-center gap-2">
            {step === "review" || step === "match" ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Back"
                className="-ml-2 shrink-0"
                onClick={() => setStep(step === "match" ? "review" : "source")}
              >
                <ChevronLeft className="size-5" aria-hidden />
              </Button>
            ) : null}
            <SheetTitle className="min-w-0 flex-1">{title}</SheetTitle>
          </div>
          <SheetDescription>
            {step === "source"
              ? "Upload a spreadsheet, snap a photo of your schedule, or type it in."
              : step === "review"
                ? "Fix anything flagged, then continue. One row per weekly lesson."
                : step === "match"
                  ? "Some of these people may already be on Gradus."
                  : "Here's what happened."}
          </SheetDescription>
        </SheetHeader>

        {step === "source" ? (
          <SourceStep
            busy={parseImage.isPending}
            onPickCsv={() => csvInputRef.current?.click()}
            onPickPhoto={() => photoInputRef.current?.click()}
            onManual={() => {
              setRows([blankRow(defaultSport)]);
              setStep("review");
            }}
          />
        ) : null}

        {step === "review" ? (
          <ReviewStep
            rows={rows}
            coachSports={coachSports}
            onChange={updateRow}
            onRemove={(id) => setRows((prev) => prev.filter((r) => r.id !== id))}
            onAdd={() => setRows((prev) => [...prev, blankRow(defaultSport)])}
          />
        ) : null}

        {step === "match" ? (
          <MatchStep
            groups={groups.map((g) => ({
              key: g.key,
              name: `${g.firstName} ${g.lastName}`.trim(),
              lessons: g.rows.length,
            }))}
            matches={matches}
            decisions={decisions}
            onDecide={(key, athleteId) =>
              setDecisions((prev) => ({ ...prev, [key]: { athleteId } }))
            }
          />
        ) : null}

        {step === "done" ? <DoneStep outcomes={outcomes} /> : null}

        <SheetFooter className="mt-6 flex-row justify-end gap-2">
          {step === "review" ? (
            <>
              <Button variant="ghost" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => runMatch.mutate()}
                disabled={rows.length === 0 || invalidCount > 0 || runMatch.isPending}
              >
                {runMatch.isPending
                  ? "Checking…"
                  : invalidCount > 0
                    ? `${invalidCount} row${invalidCount === 1 ? "" : "s"} to fix`
                    : "Continue"}
              </Button>
            </>
          ) : null}
          {step === "match" ? (
            <>
              <Button variant="ghost" onClick={() => setStep("review")}>
                Back
              </Button>
              <Button onClick={() => commit.mutate()} disabled={commit.isPending}>
                {commit.isPending
                  ? "Importing…"
                  : `Import ${groups.length} athlete${groups.length === 1 ? "" : "s"}`}
              </Button>
            </>
          ) : null}
          {step === "done" ? <Button onClick={() => close(false)}>Done</Button> : null}
        </SheetFooter>

        <input
          ref={csvInputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void handleCsv(f);
          }}
        />
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) parseImage.mutate(f);
          }}
        />
      </SheetContent>
    </Sheet>
  );
}

// ---------- steps ----------

function SourceStep({
  busy,
  onPickCsv,
  onPickPhoto,
  onManual,
}: {
  busy: boolean;
  onPickCsv: () => void;
  onPickPhoto: () => void;
  onManual: () => void;
}) {
  const options = [
    {
      key: "csv",
      icon: FileSpreadsheet,
      title: "Upload a CSV",
      description: "One row per weekly lesson",
      onClick: onPickCsv,
    },
    {
      key: "photo",
      icon: Camera,
      title: busy ? "Reading your photo…" : "Take a photo",
      description: "Snap your paper or on-screen schedule",
      onClick: onPickPhoto,
    },
    {
      key: "manual",
      icon: Pencil,
      title: "Enter it manually",
      description: "Type lessons in one at a time",
      onClick: onManual,
    },
  ];

  return (
    <div className="mt-4">
      <div className="overflow-hidden rounded-xl border border-divider bg-elevated">
        {options.map((o, i) => {
          const Icon = o.icon;
          return (
            <button
              key={o.key}
              type="button"
              disabled={busy}
              onClick={o.onClick}
              className={cn(
                "press flex w-full items-center gap-3 px-4 py-4 text-left disabled:opacity-60",
                i > 0 && "border-t border-divider",
              )}
            >
              <Icon className="size-5 shrink-0 text-accent-ink" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-text-primary">{o.title}</span>
                <span className="mt-0.5 block text-xs text-text-secondary">{o.description}</span>
              </span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={downloadTemplate}
        className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-text-secondary"
      >
        <Download className="size-3.5" aria-hidden />
        Download CSV template
      </button>
    </div>
  );
}

const LENGTH_PRESETS = [30, 45, 60, 90];

function ReviewStep({
  rows,
  coachSports,
  onChange,
  onRemove,
  onAdd,
}: {
  rows: ImportRow[];
  coachSports: string[];
  onChange: (id: string, patch: Partial<ImportRow>) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
}) {
  const allErrors = validateRows(rows);
  const badCount = rows.filter((r) => Object.keys(allErrors[r.id] ?? {}).length > 0).length;

  return (
    <div className="mt-4 space-y-3">
      <p className="rounded-xl border border-divider bg-elevated px-3 py-2 text-xs text-text-secondary">
        Check these rows and fix anything highlighted. Nothing is saved until you import — then
        guardians (or adult athletes) get their invite email right away.
      </p>

      {badCount > 0 ? (
        <div className="flex items-start gap-2 rounded-xl border border-destructive/50 bg-card px-3 py-2">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
          <p className="text-xs text-text-secondary">
            <span className="font-bold text-text-primary">
              {badCount} row{badCount === 1 ? "" : "s"} need{badCount === 1 ? "s" : ""} a fix.
            </span>{" "}
            Each one is outlined in red below.
          </p>
        </div>
      ) : null}

      {rows.map((row, index) => {
        const errors = allErrors[row.id] ?? {};
        const bad = Object.keys(errors).length > 0;
        return (
          <div
            key={row.id}
            className={cn(
              "rounded-xl border bg-card p-3",
              bad ? "border-destructive/50" : "border-divider",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold uppercase tracking-widest text-text-tertiary">
                Lesson {index + 1}
              </span>
              <button
                type="button"
                aria-label="Remove row"
                onClick={() => onRemove(row.id)}
                className="flex h-7 w-7 items-center justify-center rounded-full text-destructive"
              >
                <Trash2 className="size-3.5" aria-hidden />
              </button>
            </div>

            <div className="mt-2 grid grid-cols-2 gap-2">
              <Field label="First name" error={errors.firstName}>
                <Input
                  value={row.firstName}
                  onChange={(e) => onChange(row.id, { firstName: e.target.value })}
                />
              </Field>
              <Field label="Last name" error={errors.lastName}>
                <Input
                  value={row.lastName}
                  onChange={(e) => onChange(row.id, { lastName: e.target.value })}
                />
              </Field>
            </div>

            <div className="mt-2">
              <span className={LABEL}>Day of the week</span>
              <div className="grid grid-cols-7 gap-1">
                {IMPORT_DAYS.map((d) => (
                  <button
                    key={d.value}
                    type="button"
                    aria-label={d.long}
                    onClick={() => onChange(row.id, { dayOfWeek: d.value })}
                    className={cn(
                      "press-soft rounded-md border px-1 py-2 text-[11px] font-bold uppercase tracking-wider",
                      row.dayOfWeek === d.value
                        ? "border-accent bg-accent text-accent-foreground"
                        : "border-divider bg-card text-text-secondary",
                    )}
                  >
                    {d.short}
                  </button>
                ))}
              </div>
              {errors.dayOfWeek ? (
                <p className="mt-1 text-[11px] text-destructive">{errors.dayOfWeek}</p>
              ) : null}
            </div>

            <div className="mt-2">
              <Field label="Start time" hint="e.g. 4:00 PM" error={errors.startMinute}>
                <input
                  type="time"
                  value={row.startMinute == null ? "" : minutesToHHMM(row.startMinute)}
                  onChange={(e) =>
                    onChange(row.id, { startMinute: hhmmToMinutes(e.target.value) ?? null })
                  }
                  className="h-9 w-full rounded-md border border-divider bg-card px-3 text-sm text-text-primary"
                />
              </Field>
            </div>

            <div className="mt-2">
              <span className={LABEL}>How long (minutes)</span>
              <div className="flex flex-wrap gap-1.5">
                {LENGTH_PRESETS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => onChange(row.id, { lengthMinutes: n })}
                    className={cn(
                      "press-soft rounded-full border px-3 py-1.5 text-xs font-bold",
                      row.lengthMinutes === n
                        ? "border-accent bg-accent text-accent-foreground"
                        : "border-divider bg-card text-text-secondary",
                    )}
                  >
                    {n} min
                  </button>
                ))}
                <Input
                  inputMode="numeric"
                  aria-label="Custom length in minutes"
                  placeholder="Other"
                  className="h-8 w-20"
                  value={
                    row.lengthMinutes != null && !LENGTH_PRESETS.includes(row.lengthMinutes)
                      ? String(row.lengthMinutes)
                      : ""
                  }
                  onChange={(e) => {
                    const n = Number(e.target.value.replace(/\D/g, ""));
                    onChange(row.id, { lengthMinutes: Number.isFinite(n) && n > 0 ? n : null });
                  }}
                />
              </div>
              {errors.lengthMinutes ? (
                <p className="mt-1 text-[11px] text-destructive">{errors.lengthMinutes}</p>
              ) : null}
            </div>

            <div className="mt-2 grid grid-cols-2 gap-2">
              <Field label="Repeats" hint="How often it happens">
                <Select
                  value={row.frequency}
                  onValueChange={(v) => onChange(row.id, { frequency: v as ImportFrequency })}
                >
                  <SelectTrigger className="w-full bg-card">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {IMPORT_FREQUENCIES.map((f) => (
                      <SelectItem key={f.value} value={f.value}>
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              {coachSports.length > 1 ? (
                <Field label="Sport">
                  <Select
                    value={row.sport || "__none"}
                    onValueChange={(v) => onChange(row.id, { sport: v === "__none" ? "" : v })}
                  >
                    <SelectTrigger className="w-full bg-card">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">No sport</SelectItem>
                      {coachSports.map((s) => (
                        <SelectItem key={s} value={s}>
                          {getSport(s as SportKey)?.label ?? s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              ) : null}
            </div>

            <div className="mt-2 grid grid-cols-1 gap-2">
              <Field
                label="Parent / guardian email"
                hint="Required for anyone under 18"
                error={errors.guardianEmail}
              >
                <Input
                  type="email"
                  inputMode="email"
                  placeholder="parent@example.com"
                  value={row.guardianEmail}
                  onChange={(e) =>
                    onChange(row.id, { guardianEmail: e.target.value.toLowerCase() })
                  }
                />
              </Field>
              <Field
                label="Athlete email"
                hint="Use this instead for adults (18+)"
                error={errors.athleteEmail}
              >
                <Input
                  type="email"
                  inputMode="email"
                  placeholder="athlete@example.com"
                  value={row.athleteEmail}
                  onChange={(e) => onChange(row.id, { athleteEmail: e.target.value.toLowerCase() })}
                />
              </Field>
            </div>
          </div>
        );
      })}

      <Button type="button" variant="outline" size="sm" onClick={onAdd} className="w-full">
        <Plus className="size-4" aria-hidden />
        Add lesson row
      </Button>
    </div>
  );
}


function MatchStep({
  groups,
  matches,
  decisions,
  onDecide,
}: {
  groups: { key: string; name: string; lessons: number }[];
  matches: MatchResult[];
  decisions: Record<string, Decision>;
  onDecide: (key: string, athleteId: string | null) => void;
}) {
  return (
    <ul className="mt-4 space-y-3">
      {groups.map((g) => {
        const match = matches.find((m) => m.key === g.key);
        const chosen = decisions[g.key]?.athleteId ?? null;
        return (
          <li key={g.key} className="rounded-xl border border-divider bg-card p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-display text-base font-black text-text-primary">
                  {g.name}
                </p>
                <p className="mt-0.5 text-[11px] font-bold uppercase tracking-widest text-text-tertiary">
                  {g.lessons} lesson{g.lessons === 1 ? "" : "s"}
                </p>
              </div>
              <span
                className={cn(
                  "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest",
                  chosen
                    ? "border-accent/50 text-accent-ink"
                    : "border-divider text-text-secondary",
                )}
              >
                {chosen ? "Matched" : "New athlete"}
              </span>
            </div>

            {match && match.candidates.length > 0 ? (
              <div className="mt-3 space-y-1.5">
                {match.candidates.map((c) => {
                  const selected = chosen === c.athleteId;
                  return (
                    <button
                      key={c.athleteId}
                      type="button"
                      onClick={() => onDecide(g.key, selected ? null : c.athleteId)}
                      className={cn(
                        "press-soft flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm",
                        selected ? "border-accent bg-accent/10" : "border-divider bg-elevated",
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-bold text-text-primary">{c.name}</span>
                        <span className="mt-0.5 block text-xs text-text-secondary">
                          {c.onRoster
                            ? "Already on your roster"
                            : c.reason === "email"
                              ? `Email match${c.maskedEmail ? ` · ${c.maskedEmail}` : ""}`
                              : "Same name — confirm this is them"}
                        </span>
                      </span>
                      {selected ? (
                        <Check className="size-4 shrink-0 text-accent-ink" aria-hidden />
                      ) : null}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => onDecide(g.key, null)}
                  className={cn(
                    "press-soft flex w-full items-center rounded-lg border px-3 py-2 text-left text-sm",
                    chosen == null ? "border-accent bg-accent/10" : "border-divider bg-elevated",
                  )}
                >
                  <span className="font-bold text-text-primary">None of these — add as new</span>
                </button>
              </div>
            ) : (
              <p className="mt-2 text-xs text-text-secondary">
                No existing account found. We'll create the athlete and email an invite.
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function DoneStep({ outcomes }: { outcomes: ImportOutcome[] }) {
  const created = outcomes.filter((o) => o.status === "created").length;
  const linked = outcomes.filter((o) => o.status === "linked").length;
  const failed = outcomes.filter((o) => o.status === "failed");
  const slots = outcomes.reduce((n, o) => n + o.slotsAdded, 0);

  return (
    <div className="mt-4 space-y-3">
      <p className="text-sm text-text-primary">
        {created} new athlete{created === 1 ? "" : "s"}, {linked} matched, {slots} lesson
        {slots === 1 ? "" : "s"} added.
      </p>
      <ul className="space-y-1.5">
        {outcomes.map((o) => (
          <li
            key={`${o.key}-${o.name}`}
            className="flex items-start gap-2 rounded-lg border border-divider bg-card px-3 py-2 text-sm"
          >
            {o.status === "failed" ? (
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
            ) : (
              <Check className="mt-0.5 size-4 shrink-0 text-accent-ink" aria-hidden />
            )}
            <span className="min-w-0">
              <span className="block font-bold text-text-primary">{o.name}</span>
              <span className="block text-xs text-text-secondary">
                {o.status === "failed"
                  ? (o.message ?? "Could not import")
                  : `${o.slotsAdded} lesson${o.slotsAdded === 1 ? "" : "s"}${
                      o.invited ? ` · invite sent to ${o.invited}` : ""
                    }${o.message ? ` · ${o.message}` : ""}`}
              </span>
            </span>
          </li>
        ))}
      </ul>
      {failed.length > 0 ? (
        <p className="text-xs text-text-secondary">
          Failed rows were skipped — successful ones are already on your roster.
        </p>
      ) : null}
    </div>
  );
}

// ---------- bits ----------

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <span className={LABEL}>{label}</span>
      {children}
      {error ? <p className="mt-1 text-[11px] text-destructive">{error}</p> : null}
    </div>
  );
}

function downloadTemplate() {
  const blob = new Blob([CSV_TEMPLATE], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "gradus-schedule-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read that file"));
    reader.readAsDataURL(file);
  });
}

export { formatTimeLabel };
