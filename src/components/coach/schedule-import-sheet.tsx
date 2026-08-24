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
import { getSport, getSportLevel, type SportKey } from "@/lib/coach-sports";
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
  validateRows,
  type ImportFrequency,
  type ImportRow,
} from "@/lib/schedule-import";

import {
  commitScheduleImport,
  parseScheduleImage,
  type ImportOutcome,
} from "@/lib/schedule-import.functions";

type Step = "source" | "review" | "done";

const LABEL = "mb-1 block text-[11px] font-bold uppercase tracking-widest text-text-tertiary";

export function ScheduleImportSheet({
  open,
  onOpenChange,
  coachSports,
  athleteLimit = null,
  rosterCount = 0,
  rosterNames = [],
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  coachSports: string[];
  /** Athletes allowed on the coach's plan; null = unlimited. */
  athleteLimit?: number | null;
  rosterCount?: number;
  /** Full names already on the roster, so repeats don't count against the cap. */
  rosterNames?: string[];
}) {
  const qc = useQueryClient();
  const defaultSport = coachSports.length === 1 ? coachSports[0] : "";
  const [step, setStep] = useState<Step>("source");
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [outcomes, setOutcomes] = useState<ImportOutcome[]>([]);
  // Errors stay hidden until the coach tries to continue — typing shouldn't feel accusatory.
  const [showErrors, setShowErrors] = useState(false);
  // Student name-keys the coach chose to leave out of this import.
  const [skipped, setSkipped] = useState<string[]>([]);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const rosterSet = useMemo(
    () => new Set(rosterNames.map((n) => n.trim().toLowerCase().replace(/\s+/g, " "))),
    [rosterNames],
  );
  const room = athleteLimit === null ? Infinity : Math.max(0, athleteLimit - rosterCount);

  const groups = useMemo(() => groupRowsByAthlete(rows), [rows]);

  // Which students are new (count against the cap) and which spill past it.
  const nameKey = (first: string, last: string) =>
    `${first} ${last}`.trim().toLowerCase().replace(/\s+/g, " ");
  const overCapKeys = useMemo(() => {
    if (room === Infinity) return new Set<string>();
    const over = new Set<string>();
    let left = room;
    for (const g of groups) {
      const key = nameKey(g.firstName, g.lastName);
      if (!key || rosterSet.has(key) || skipped.includes(key)) continue;
      if (left > 0) left -= 1;
      else over.add(key);
    }
    return over;
  }, [groups, room, rosterSet, skipped]);

  const newCount = groups.filter((g) => {
    const key = nameKey(g.firstName, g.lastName);
    return key && !rosterSet.has(key) && !skipped.includes(key);
  }).length;

  const invalidCount = useMemo(() => {
    const all = validateRows(rows);
    return rows.filter((r) => Object.keys(all[r.id] ?? {}).length > 0).length;
  }, [rows]);

  const reset = () => {
    setStep("source");
    setRows([]);
    setOutcomes([]);
    setShowErrors(false);
    setSkipped([]);
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

  const commit = useMutation({
    mutationFn: () =>
      commitScheduleImport({
        data: {
          groups: groups
            .filter((g) => !skipped.includes(nameKey(g.firstName, g.lastName)))
            .map((g) => ({
            key: g.key,
            firstName: g.firstName,
            lastName: g.lastName,
            guardianEmail: g.guardianEmail,
            athleteEmail: g.athleteEmail,
            sport: g.sport || defaultSport,
            emailRecipient:
              g.athleteEmail && !g.guardianEmail ? ("athlete" as const) : ("guardian" as const),
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
        : "Import complete";

  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent side="bottom" className="paper-surface max-h-[92dvh] overflow-y-auto">
        <SheetHeader className="text-left">
          <div className="flex items-center gap-2">
            {step === "review" ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Back"
                className="-ml-2 shrink-0"
                onClick={() => setStep("source")}
              >
                <ChevronLeft className="size-5" aria-hidden />
              </Button>
            ) : null}
            <SheetTitle className="min-w-0 flex-1">{title}</SheetTitle>
          </div>
          <SheetDescription
            className={step === "source" || step === "review" ? "sr-only" : undefined}
          >
            {step === "source"
              ? "Import your lesson schedule."
              : step === "review"
                ? "Fix anything flagged, then continue. One row per weekly lesson."
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
            showErrors={showErrors}
            rosterSet={rosterSet}
            skipped={skipped}
            overCapKeys={overCapKeys}
            room={room}
            athleteLimit={athleteLimit}
            newCount={newCount}
            onToggleSkip={(key) =>
              setSkipped((prev) =>
                prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
              )
            }
            onChange={updateRow}
            onRemove={(id) => setRows((prev) => prev.filter((r) => r.id !== id))}
            onAdd={() => {
              const r = blankRow(defaultSport);
              setRows((prev) => [...prev, r]);
              return r.id;
            }}
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
                onClick={() => {
                  if (invalidCount > 0) {
                    setShowErrors(true);
                    return;
                  }
                  commit.mutate();
                }}
                disabled={rows.length === 0 || commit.isPending}
              >
                {commit.isPending
                  ? "Importing…"
                  : showErrors && invalidCount > 0
                    ? `${invalidCount} row${invalidCount === 1 ? "" : "s"} to fix`
                    : "Continue"}
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
      title: "Upload a spreadsheet",
      description: "A .csv from Excel, Numbers or Google Sheets",
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

      <p className="mt-3 text-xs text-text-secondary">
        You'll see every row and can fix anything before a single athlete is created.
      </p>

      <button
        type="button"
        onClick={downloadTemplate}
        className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-text-secondary"
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
  showErrors,
  rosterSet,
  skipped,
  overCapKeys,
  room,
  athleteLimit,
  newCount,
  onToggleSkip,
  onChange,
  onRemove,
  onAdd,
}: {
  rows: ImportRow[];
  coachSports: string[];
  showErrors: boolean;
  rosterSet: Set<string>;
  skipped: string[];
  overCapKeys: Set<string>;
  room: number;
  athleteLimit: number | null;
  newCount: number;
  onToggleSkip: (key: string) => void;
  onChange: (id: string, patch: Partial<ImportRow>) => void;
  onRemove: (id: string) => void;
  onAdd: () => string;
}) {
  // Manual entry starts on an empty row: open the editor, no red state yet.
  const [expandedId, setExpandedId] = useState<string | null>(() =>
    rows.length === 1 && !rows[0]?.firstName?.trim() ? (rows[0]?.id ?? null) : null,
  );

  const rawErrors = validateRows(rows);
  const allErrors: Record<string, Record<string, string>> = {};
  for (const r of rows) {
    allErrors[r.id] = showErrors ? (rawErrors[r.id] ?? {}) : {};
  }
  const handleChange = (id: string, patch: Partial<ImportRow>) => {
    onChange(id, patch);
  };
  const badRows = rows.filter((r) => Object.keys(allErrors[r.id] ?? {}).length > 0);
  const badCount = badRows.length;

  // Name each problem so the coach knows what to fix, not just that something's wrong.
  const fieldLabels: Record<string, string> = {
    firstName: "first name",
    lastName: "last name",
    dayOfWeek: "day",
    startMinute: "start time",
    lengthMinutes: "length",
    guardianEmail: "email",
    athleteEmail: "email",
  };
  const counts = new Map<string, number>();
  for (const r of badRows) {
    const seen = new Set<string>();
    for (const key of Object.keys(allErrors[r.id] ?? {})) {
      const label = fieldLabels[key] ?? key;
      if (seen.has(label)) continue;
      seen.add(label);
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }
  const problemSummary = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, n]) => `${label} (${n})`)
    .join(", ");

  return (
    <div className="mt-4 space-y-2">
      {badCount > 0 ? (
        <div className="flex w-full items-start gap-2 rounded-xl border border-destructive/50 bg-card px-3 py-2 text-left">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
          <p className="text-xs text-text-secondary">
            <span className="font-bold text-text-primary">
              {badCount} lesson{badCount === 1 ? "" : "s"} missing {problemSummary}.
            </span>
          </p>
        </div>
      ) : null}

      {athleteLimit !== null ? (
        <div
          className={cn(
            "flex w-full items-start gap-2 rounded-xl border bg-card px-3 py-2 text-left",
            overCapKeys.size > 0 ? "border-destructive/50" : "border-divider",
          )}
        >
          <TriangleAlert
            className={cn(
              "mt-0.5 size-4 shrink-0",
              overCapKeys.size > 0 ? "text-destructive" : "text-text-tertiary",
            )}
            aria-hidden
          />
          <p className="text-xs text-text-secondary">
            {overCapKeys.size > 0 ? (
              <>
                <span className="font-bold text-text-primary">
                  {room === 0
                    ? "Your roster is full."
                    : `Only ${room} seat${room === 1 ? "" : "s"} left on your plan.`}
                </span>{" "}
                {overCapKeys.size} athlete{overCapKeys.size === 1 ? "" : "s"} below won't be
                imported. Skip someone else to make room, or{" "}
                <a href="/coach/paywall" className="font-bold text-accent-ink underline">
                  upgrade your plan
                </a>
                .
              </>
            ) : (
              <>
                <span className="font-bold text-text-primary">
                  {room} seat{room === 1 ? "" : "s"} left on your plan.
                </span>{" "}
                {newCount} new athlete{newCount === 1 ? "" : "s"} in this import.
              </>
            )}
          </p>
        </div>
      ) : null}

      {groupRowsByStudent(rows, expandedId).map((group) => {
        const groupBad = group.rows.some((r) => Object.keys(allErrors[r.id] ?? {}).length > 0);
        const first = group.rows[0]!;
        const name = `${first.firstName} ${first.lastName}`.trim();
        const key = name.toLowerCase().replace(/\s+/g, " ");
        const isSkipped = skipped.includes(key);
        const isOver = overCapKeys.has(key);
        const onRoster = rosterSet.has(key);
        return (
          <div
            key={group.key}
            id={`import-row-${first.id}`}
            className={cn(
              "rounded-xl border bg-card p-3",
              groupBad || isOver ? "border-destructive/50" : "border-divider",
              isSkipped ? "opacity-60" : undefined,
            )}
          >
            {name ? (
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 flex-1 truncate text-sm font-bold text-text-primary">
                  {name}
                </p>
                {athleteLimit !== null && !onRoster ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="-mr-1 h-7 shrink-0 px-2 text-[11px] font-bold uppercase tracking-widest text-text-secondary"
                    onClick={() => onToggleSkip(key)}
                  >
                    {isSkipped ? "Include" : "Skip"}
                  </Button>
                ) : null}
              </div>
            ) : null}
            {isSkipped ? (
              <p className="text-[11px] text-text-tertiary">
                Left out of this import.
              </p>
            ) : isOver ? (
              <p className="text-[11px] text-destructive">Won't import — roster full.</p>
            ) : onRoster ? (
              <p className="text-[11px] text-text-tertiary">
                Already on your roster — lessons will be added.
              </p>
            ) : null}


            <div className="mt-0.5">
              {group.rows.map((row) => {
                const errors = allErrors[row.id] ?? {};
                const expanded = expandedId === row.id;
                const index = rows.findIndex((r) => r.id === row.id);
                return (
                  <div key={row.id} className={expanded ? "py-1" : ""}>
                    <LessonLine
                      row={row}
                      index={index}
                      expanded={expanded}
                      errors={errors}
                      coachSports={coachSports}
                      onToggle={() => setExpandedId(expanded ? null : row.id)}
                      onRemove={() => onRemove(row.id)}
                    />
                    {expanded ? (
                      <RowEditor
                        row={row}
                        errors={errors}
                        coachSports={coachSports}
                        onChange={handleChange}
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>

            <RowSummary
              row={first}
              errors={allErrors[first.id] ?? {}}
              onChange={(_id, patch) => {
                for (const r of group.rows) handleChange(r.id, patch);
              }}
            />
          </div>
        );
      })}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          const id = onAdd();
          setExpandedId(id);
        }}
        className="w-full"
      >
        <Plus className="size-4" aria-hidden />
        Add lesson row
      </Button>
    </div>
  );
}

// One card per student: rows with the same name collapse together.
// The row currently being edited is always kept in its own group, keyed by row
// id. Otherwise every keystroke in the name fields would re-key the group and
// move the row into a different card subtree, which unmounts the focused input
// and drops the caret mid-word. It re-merges with its student card on collapse.
function groupRowsByStudent(rows: ImportRow[], expandedId?: string | null) {
  const groups: { key: string; rows: ImportRow[] }[] = [];
  const index = new Map<string, { key: string; rows: ImportRow[] }>();
  for (const row of rows) {
    const name = `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim().toLowerCase();
    const isEditing = expandedId != null && row.id === expandedId;
    const key = name && !isEditing ? `name:${name}` : `row:${row.id}`;
    const existing = isEditing ? undefined : index.get(key);
    if (existing) {
      existing.rows.push(row);
    } else {
      const group = { key, rows: [row] };
      if (!isEditing) index.set(key, group);
      groups.push(group);
    }
  }
  return groups;
}

function LessonLine({
  row,
  index,
  expanded,
  errors,
  coachSports,
  onToggle,
  onRemove,
}: {
  row: ImportRow;
  index: number;
  expanded: boolean;
  errors: Record<string, string>;
  coachSports: string[];
  onToggle: () => void;
  onRemove: () => void;
}) {
  const sportLabel =
    coachSports.length > 1 && row.sport
      ? (getSport(row.sport as SportKey)?.label ?? row.sport)
      : "";
  const dayLabel = IMPORT_DAYS.find((d) => d.value === row.dayOfWeek)?.short ?? "—";
  const timeLabel =
    row.startMinute == null
      ? "No time"
      : row.lengthMinutes == null
        ? formatTimeLabel(row.startMinute)
        : `${formatTimeLabel(row.startMinute)}–${formatTimeLabel(row.startMinute + row.lengthMinutes)}`;
  const freqLabel = IMPORT_FREQUENCIES.find((f) => f.value === row.frequency)?.label ?? "";
  const meta = [dayLabel, timeLabel, freqLabel, sportLabel].filter(Boolean).join(" · ");
  const lineBad = Object.keys(errors).some((k) => k !== "guardianEmail" && k !== "athleteEmail");

  return (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        {expanded ? (
          <span className="text-[11px] font-bold uppercase tracking-widest text-text-tertiary">
            Lesson {index + 1}
          </span>
        ) : (
          <p
            className={cn("truncate text-xs", lineBad ? "text-destructive" : "text-text-secondary")}
          >
            {meta}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          aria-label={expanded ? "Done editing" : "Edit lesson"}
          onClick={onToggle}
          className="flex h-7 w-7 items-center justify-center rounded-full text-text-secondary"
        >
          {expanded ? (
            <Check className="size-4 text-accent-ink" aria-hidden />
          ) : (
            <Pencil className="size-3.5" aria-hidden />
          )}
        </button>
        <button
          type="button"
          aria-label="Remove row"
          onClick={onRemove}
          className="flex h-7 w-7 items-center justify-center rounded-full text-destructive"
        >
          <Trash2 className="size-3.5" aria-hidden />
        </button>
      </div>
    </div>
  );
}

function RowSummary({
  row,
  errors,
  onChange,
}: {
  row: ImportRow;
  errors: Record<string, string>;
  onChange: (id: string, patch: Partial<ImportRow>) => void;
}) {
  const email = row.guardianEmail || row.athleteEmail;
  const [collecting, setCollecting] = useState(!email);
  const otherErrors = Object.entries(errors)
    .filter(([k]) => k !== "guardianEmail" && k !== "athleteEmail")
    .map(([, v]) => v);
  // Which inbox this address belongs to decides the voice of the invite email.
  const [recipient, setRecipient] = useState<"guardian" | "athlete">(
    row.athleteEmail && !row.guardianEmail ? "athlete" : "guardian",
  );

  return (
    <>
      {!collecting ? (
        <p className="mt-1 truncate text-xs text-text-tertiary">{email}</p>
      ) : (
        <div className="mt-2 space-y-2">
          <div>
            <span className={LABEL}>Who should we email?</span>
            <Select
              value={recipient}
              onValueChange={(v) => {
                const next = v === "athlete" ? "athlete" : "guardian";
                setRecipient(next);
                onChange(
                  row.id,
                  next === "athlete"
                    ? { athleteEmail: email, guardianEmail: "" }
                    : { guardianEmail: email, athleteEmail: "" },
                );
              }}
            >
              <SelectTrigger className="h-9 w-full bg-card">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="guardian">A parent or guardian</SelectItem>
                <SelectItem value="athlete">The athlete (18+)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <span className={LABEL}>Email</span>
            <Input
              type="email"
              inputMode="email"
              placeholder={recipient === "athlete" ? "athlete@example.com" : "parent@example.com"}
              value={email}
              onBlur={() => {
                if (row.guardianEmail || row.athleteEmail) setCollecting(false);
              }}
              onChange={(e) => {
                const v = e.target.value.toLowerCase();
                onChange(
                  row.id,
                  recipient === "athlete"
                    ? { athleteEmail: v, guardianEmail: "" }
                    : { guardianEmail: v, athleteEmail: "" },
                );
              }}
              className="h-9 w-full"
            />
            <p className="mt-1 text-[11px] text-text-tertiary">
              {recipient === "athlete"
                ? "Adult athletes only — use a parent/guardian email for anyone under 18"
                : "Enter a parent/guardian email for athletes under 18"}
            </p>
          </div>
        </div>
      )}
      {otherErrors.length > 0 ? (
        <p className="mt-1 text-[11px] text-destructive">{otherErrors[0]}</p>
      ) : null}
    </>
  );
}

function RowEditor({
  row,
  errors,
  coachSports,
  onChange,
}: {
  row: ImportRow;
  errors: Record<string, string>;
  coachSports: string[];
  onChange: (id: string, patch: Partial<ImportRow>) => void;
}) {
  return (
    <>
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
        <Field label="Repeats">
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
    </>
  );
}

function DoneStep({ outcomes }: { outcomes: ImportOutcome[] }) {
  const created = outcomes.filter((o) => o.status === "created").length;
  const linked = outcomes.filter((o) => o.status === "linked").length;
  const failed = outcomes.filter((o) => o.status === "failed");
  const skipped = outcomes.filter((o) => o.status === "skipped");
  const imported = outcomes.filter((o) => o.status !== "skipped");
  const slots = outcomes.reduce((n, o) => n + o.slotsAdded, 0);

  const row = (o: ImportOutcome) => (
    <li
      key={`${o.key}-${o.name}`}
      className="flex items-start gap-2 rounded-lg border border-divider bg-card px-3 py-2 text-sm"
    >
      {o.status === "failed" ? (
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
      ) : o.status === "skipped" ? (
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-text-tertiary" aria-hidden />
      ) : (
        <Check className="mt-0.5 size-4 shrink-0 text-accent-ink" aria-hidden />
      )}
      <span className="min-w-0">
        <span className="block font-bold text-text-primary">{o.name}</span>
        <span className="block text-xs text-text-secondary">
          {o.status === "failed"
            ? (o.message ?? "Could not import")
            : o.status === "skipped"
              ? (o.message ?? "Skipped — roster full")
              : `${o.slotsAdded} lesson${o.slotsAdded === 1 ? "" : "s"}${
                  o.invited ? ` · invite sent to ${o.invited}` : ""
                }${o.message ? ` · ${o.message}` : ""}`}
        </span>
      </span>
    </li>
  );

  return (
    <div className="mt-4 space-y-3">
      <p className="text-sm text-text-primary">
        {created} new athlete{created === 1 ? "" : "s"}, {linked} matched, {slots} lesson
        {slots === 1 ? "" : "s"} added.
      </p>
      <ul className="space-y-1.5">{imported.map(row)}</ul>

      {skipped.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-[11px] font-bold uppercase tracking-widest text-text-tertiary">
            Skipped — roster full
          </p>
          <ul className="space-y-1.5">{skipped.map(row)}</ul>
          <Button asChild size="sm" className="w-full">
            <a href="/coach/paywall">Upgrade to add {skipped.length} more</a>
          </Button>
        </div>
      ) : null}

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
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <span className={LABEL}>{label}</span>
      {hint ? <span className="mb-1 block text-[11px] text-text-tertiary">{hint}</span> : null}
      {children}
      {error ? <p className="mt-1 text-[11px] text-destructive">{error}</p> : null}
    </div>
  );
}

function downloadTemplate() {
  // BOM so Excel opens it as UTF-8 without mangling names.
  const blob = new Blob([`\uFEFF${CSV_TEMPLATE}`], { type: "text/csv;charset=utf-8" });
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
