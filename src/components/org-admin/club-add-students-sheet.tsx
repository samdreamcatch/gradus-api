import { useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Copy, FileUp, Plus, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import type { RosterCoach } from "@/lib/org-admin.functions";
import {
  clubAddStudents,
  type ClubAddStudentResult,
  type ClubStudent,
} from "@/lib/club-students.functions";
import {
  LENGTH_PRESETS,
  blankStudentRow,
  isBlankRow,
  nameKey,
  parsePastedStudents,
  studentRowProblems,
  type StudentFrequency,
  type StudentRow,
} from "@/lib/club-add-students";
import { getSport } from "@/lib/coach-sports";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const FREQUENCIES: { value: StudentFrequency; label: string }[] = [
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Every 2 weeks" },
  { value: "twice_monthly", label: "Twice a month" },
  { value: "monthly", label: "Monthly" },
];
const NONE = "none";

function coachName(c: RosterCoach) {
  return `${c.firstName} ${c.lastName}`.trim();
}
function coachSport(c: RosterCoach | undefined) {
  return c?.levels[0]?.sport;
}

export function ClubAddStudentsSheet({
  open,
  onOpenChange,
  orgId,
  coaches,
  seatedCoachIds,
  students,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  coaches: RosterCoach[];
  seatedCoachIds: string[];
  students: ClubStudent[];
}) {
  const mobile = useIsMobile();
  const qc = useQueryClient();
  const add = useServerFn(clubAddStudents);
  const seated = useMemo(() => new Set(seatedCoachIds), [seatedCoachIds]);
  const seatedCoaches = coaches.filter((c) => seated.has(c.coachId));
  const [defaultCoach, setDefaultCoach] = useState(seatedCoaches[0]?.coachId ?? "");
  const [rows, setRows] = useState<StudentRow[]>(() => [blankStudentRow(defaultCoach)]);
  const [levelsOpen, setLevelsOpen] = useState<Set<string>>(new Set());
  const [sendInvites, setSendInvites] = useState(true);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<ClubAddStudentResult[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const existing = useMemo(() => {
    const byName = new Map(coaches.map((c) => [coachName(c), c.coachId]));
    return new Set(
      students.flatMap((s) =>
        s.coaches.flatMap((n) => {
          const id = byName.get(n);
          const [first = "", ...rest] = s.name.split(" ");
          return id ? [`${id}|${nameKey(first, rest.join(" "))}`] : [];
        }),
      ),
    );
  }, [students, coaches]);

  const filled = rows.filter((r) => !isBlankRow(r));
  const problems = new Map(
    filled.map((r) => [r.id, studentRowProblems(r, { seated, existing, others: filled })]),
  );
  const ready = filled.filter((r) => !problems.get(r.id)?.length);

  function update(id: string, patch: Partial<StudentRow>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }
  function addRow(after?: StudentRow) {
    const next = blankStudentRow(after?.coachId || defaultCoach);
    if (after) {
      next.lengthMinutes = after.lengthMinutes;
      next.frequency = after.frequency;
    }
    setRows((rs) => [...rs, next]);
  }
  function applyToAll(field: "coachId" | "lengthMinutes" | "frequency", from: StudentRow) {
    setRows((rs) => rs.map((r) => ({ ...r, [field]: from[field] })));
    toast.success("Applied to every row");
  }
  function replaceWith(parsed: StudentRow[]) {
    if (!parsed.length) return toast.error("No students found in that text.");
    setRows((rs) => [...rs.filter((r) => !isBlankRow(r)), ...parsed]);
    toast.success(
      `${parsed.length} ${parsed.length === 1 ? "row" : "rows"} added — check them below`,
    );
  }
  function onPaste(e: ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text");
    if (!/[\t\n]/.test(text)) return;
    e.preventDefault();
    replaceWith(parsePastedStudents(text, defaultCoach));
  }
  function onKey(e: KeyboardEvent<HTMLInputElement>, row: StudentRow) {
    if (e.key === "Enter" && rows[rows.length - 1]?.id === row.id) {
      e.preventDefault();
      addRow(row);
    }
  }
  async function onFile(file: File) {
    replaceWith(parsePastedStudents(await file.text(), defaultCoach));
  }

  async function submit() {
    setConfirm(false);
    setBusy(true);
    try {
      const out = await add({
        data: {
          organizationId: orgId,
          sendInvites,
          rows: ready.map((r) => ({
            ...r,
            sport: coachSport(coaches.find((c) => c.coachId === r.coachId)),
          })),
        },
      });
      setResults(out);
      const okIds = new Set(out.filter((o) => o.ok).map((o) => o.id));
      setRows((rs) => {
        const left = rs.filter((r) => !okIds.has(r.id) && !isBlankRow(r));
        return left.length ? left : [blankStudentRow(defaultCoach)];
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["club-students", orgId] }),
        qc.invalidateQueries({ queryKey: ["org-people"] }),
      ]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't add students.");
    } finally {
      setBusy(false);
    }
  }

  const label = `Add ${ready.length} ${ready.length === 1 ? "student" : "students"}${
    sendInvites && ready.length
      ? ` · send ${ready.length} ${ready.length === 1 ? "invite" : "invites"}`
      : ""
  }`;

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side={mobile ? "bottom" : "right"}
          className={
            mobile
              ? "paper-surface max-h-[92dvh] overflow-y-auto p-5 font-sans"
              : "w-full overflow-y-auto p-6 font-sans sm:max-w-[min(1180px,96vw)]"
          }
        >
          <SheetHeader>
            <SheetTitle className="font-display text-h2">
              {results ? "Students added" : "Add students"}
            </SheetTitle>
            <SheetDescription>
              {results
                ? "Fix anything marked ! and add it again — finished rows won't be added twice."
                : "Type, paste rows from a spreadsheet, or import a .csv. Students under 18 join through a parent or guardian."}
            </SheetDescription>
          </SheetHeader>

          {results ? (
            <div className="mt-5 space-y-2">
              {results.map((r) => (
                <div
                  key={r.id}
                  className="flex items-start gap-3 rounded-md border border-divider bg-card px-4 py-3"
                >
                  {r.ok ? (
                    <Check className="mt-0.5 size-4 text-accent-ink" aria-label="Added" />
                  ) : (
                    <TriangleAlert
                      className="mt-0.5 size-4 text-destructive"
                      aria-label="Not added"
                    />
                  )}
                  <div>
                    <div className="font-semibold text-text-primary">{r.name || "Unnamed row"}</div>
                    <div className="text-meta text-text-secondary">{r.message}</div>
                  </div>
                </div>
              ))}
              <SheetFooter className="mt-5 gap-2">
                {results.some((r) => !r.ok) ? (
                  <Button
                    variant="outline"
                    className="min-h-11 press"
                    onClick={() => setResults(null)}
                  >
                    Fix skipped rows
                  </Button>
                ) : null}
                <Button
                  className="min-h-11 press"
                  onClick={() => {
                    setResults(null);
                    onOpenChange(false);
                  }}
                >
                  Done
                </Button>
              </SheetFooter>
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1.5">
                  <Label className="text-caption uppercase text-text-secondary">
                    Coach for new rows
                  </Label>
                  <Select
                    value={defaultCoach || NONE}
                    onValueChange={(v) => setDefaultCoach(v === NONE ? "" : v)}
                  >
                    <SelectTrigger className="min-h-11 w-64" aria-label="Coach for new rows">
                      <SelectValue placeholder="Pick a coach" />
                    </SelectTrigger>
                    <SelectContent>
                      {seatedCoaches.length ? null : (
                        <SelectItem value={NONE} disabled>
                          No coach holds a seat yet
                        </SelectItem>
                      )}
                      {seatedCoaches.map((c) => (
                        <SelectItem key={c.coachId} value={c.coachId}>
                          {coachName(c)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  variant="outline"
                  className="min-h-11 press"
                  onClick={() => fileRef.current?.click()}
                >
                  <FileUp className="size-4" /> Import a .csv
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,.tsv,.txt,text/csv"
                  className="sr-only"
                  aria-label="Import a .csv"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void onFile(f);
                    e.target.value = "";
                  }}
                />
                <p className="text-meta text-text-tertiary">
                  Paste columns: first, last, email, under/over 18, day, start, length, guardian
                  first, guardian last.
                </p>
              </div>

              <div className="space-y-3">
                {rows.map((row, i) => {
                  const coach = coaches.find((c) => c.coachId === row.coachId);
                  const sport = coachSport(coach);
                  const levels = sport ? (getSport(sport)?.levels ?? []) : [];
                  const issues = isBlankRow(row) ? [] : (problems.get(row.id) ?? []);
                  const custom = !LENGTH_PRESETS.includes(row.lengthMinutes as 30);
                  return (
                    <div
                      key={row.id}
                      className={`rounded-md border bg-card p-4 ${issues.length ? "border-destructive/50" : "border-divider"}`}
                    >
                      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_minmax(0,1.4fr)]">
                        <Field label="First name">
                          <Input
                            autoFocus={i === rows.length - 1 && isBlankRow(row)}
                            value={row.firstName}
                            onPaste={onPaste}
                            onKeyDown={(e) => onKey(e, row)}
                            onChange={(e) => update(row.id, { firstName: e.target.value })}
                          />
                        </Field>
                        <Field label="Last name">
                          <Input
                            value={row.lastName}
                            onKeyDown={(e) => onKey(e, row)}
                            onChange={(e) => update(row.id, { lastName: e.target.value })}
                          />
                        </Field>
                        <Field label="Age">
                          <div
                            className="flex h-11 rounded-md border border-divider p-0.5"
                            role="group"
                            aria-label="Age"
                          >
                            {[false, true].map((adult) => (
                              <button
                                key={String(adult)}
                                type="button"
                                aria-pressed={row.adult === adult}
                                onClick={() => update(row.id, { adult })}
                                className={`press-soft rounded-sm px-3 text-label ${row.adult === adult ? "bg-accent text-accent-foreground" : "text-text-secondary"}`}
                              >
                                {adult ? "Over 18" : "Under 18"}
                              </button>
                            ))}
                          </div>
                        </Field>
                        <Field label={row.adult ? "Athlete email" : "Parent or guardian email"}>
                          <Input
                            type="email"
                            value={row.email}
                            onKeyDown={(e) => onKey(e, row)}
                            onChange={(e) => update(row.id, { email: e.target.value })}
                          />
                        </Field>
                      </div>

                      {row.adult ? null : (
                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                          <Field label="Parent or guardian first name">
                            <Input
                              value={row.guardianFirstName}
                              onKeyDown={(e) => onKey(e, row)}
                              onChange={(e) =>
                                update(row.id, { guardianFirstName: e.target.value })
                              }
                            />
                          </Field>
                          <Field label="Parent or guardian last name">
                            <Input
                              value={row.guardianLastName}
                              onKeyDown={(e) => onKey(e, row)}
                              onChange={(e) => update(row.id, { guardianLastName: e.target.value })}
                            />
                          </Field>
                        </div>
                      )}

                      <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1.2fr)_auto_auto_auto_auto]">
                        <Field
                          label="Coach"
                          action={rows.length > 1 ? () => applyToAll("coachId", row) : undefined}
                        >
                          <Select
                            value={row.coachId || NONE}
                            onValueChange={(v) =>
                              update(row.id, {
                                coachId: v === NONE ? "" : v,
                                currentLevelKey: "",
                                seasonGoalKey: "",
                              })
                            }
                          >
                            <SelectTrigger className="min-h-11" aria-label="Coach">
                              <SelectValue placeholder="Pick a coach" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NONE} disabled>
                                Pick a coach
                              </SelectItem>
                              {seatedCoaches.map((c) => (
                                <SelectItem key={c.coachId} value={c.coachId}>
                                  {coachName(c)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </Field>
                        <Field label="Day">
                          <Select
                            value={row.dayOfWeek === null ? NONE : String(row.dayOfWeek)}
                            onValueChange={(v) =>
                              update(row.id, { dayOfWeek: v === NONE ? null : Number(v) })
                            }
                          >
                            <SelectTrigger className="min-h-11 w-28" aria-label="Day">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NONE}>No lesson</SelectItem>
                              {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                                <SelectItem key={d} value={String(d)}>
                                  {DAYS[d]}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </Field>
                        <Field label="Start">
                          <Input
                            type="time"
                            className="w-32"
                            value={row.start}
                            onChange={(e) => update(row.id, { start: e.target.value })}
                          />
                        </Field>
                        <Field
                          label="Length"
                          action={
                            rows.length > 1 ? () => applyToAll("lengthMinutes", row) : undefined
                          }
                        >
                          <div className="flex gap-2">
                            <Select
                              value={custom ? "other" : String(row.lengthMinutes)}
                              onValueChange={(v) =>
                                update(row.id, { lengthMinutes: v === "other" ? 75 : Number(v) })
                              }
                            >
                              <SelectTrigger className="min-h-11 w-28" aria-label="Length">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {LENGTH_PRESETS.map((m) => (
                                  <SelectItem key={m} value={String(m)}>
                                    {m} min
                                  </SelectItem>
                                ))}
                                <SelectItem value="other">Other…</SelectItem>
                              </SelectContent>
                            </Select>
                            {custom ? (
                              <Input
                                type="number"
                                min={5}
                                max={600}
                                aria-label="Minutes"
                                className="w-20"
                                value={row.lengthMinutes}
                                onChange={(e) =>
                                  update(row.id, { lengthMinutes: Number(e.target.value) || 0 })
                                }
                              />
                            ) : null}
                          </div>
                        </Field>
                        <Field
                          label="Frequency"
                          action={rows.length > 1 ? () => applyToAll("frequency", row) : undefined}
                        >
                          <Select
                            value={row.frequency}
                            onValueChange={(v) =>
                              update(row.id, { frequency: v as StudentFrequency })
                            }
                          >
                            <SelectTrigger className="min-h-11 w-40" aria-label="Frequency">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {FREQUENCIES.map((f) => (
                                <SelectItem key={f.value} value={f.value}>
                                  {f.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </Field>
                      </div>

                      <div className="mt-3 flex flex-wrap items-end gap-3">
                        {levelsOpen.has(row.id) && levels.length ? (
                          <>
                            {(["currentLevelKey", "seasonGoalKey"] as const).map((field) => (
                              <Field
                                key={field}
                                label={
                                  field === "currentLevelKey"
                                    ? "Current level"
                                    : "Target this season"
                                }
                              >
                                <Select
                                  value={row[field] || NONE}
                                  onValueChange={(v) =>
                                    update(row.id, { [field]: v === NONE ? "" : v })
                                  }
                                >
                                  <SelectTrigger
                                    className="min-h-11 w-52"
                                    aria-label={
                                      field === "currentLevelKey"
                                        ? "Current level"
                                        : "Target this season"
                                    }
                                  >
                                    <SelectValue placeholder="Pick a level" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value={NONE}>Not set</SelectItem>
                                    {levels.map((l) => (
                                      <SelectItem key={l.key} value={l.key}>
                                        {l.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </Field>
                            ))}
                            <p className="max-w-xs pb-1 text-meta text-text-tertiary">
                              The family sees these as the coach's suggestion and can change them.
                            </p>
                          </>
                        ) : levels.length ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="min-h-9 press"
                            onClick={() => setLevelsOpen((s) => new Set(s).add(row.id))}
                          >
                            <Plus className="size-4" /> Add starting levels
                          </Button>
                        ) : null}
                        <div className="ml-auto flex gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="min-h-9 press"
                            aria-label="Duplicate row"
                            onClick={() =>
                              setRows((rs) => {
                                const at = rs.findIndex((r) => r.id === row.id);
                                const copy = {
                                  ...row,
                                  id: blankStudentRow().id,
                                  firstName: "",
                                  lastName: "",
                                };
                                return [...rs.slice(0, at + 1), copy, ...rs.slice(at + 1)];
                              })
                            }
                          >
                            <Copy className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="min-h-9 press"
                            aria-label="Remove row"
                            onClick={() =>
                              setRows((rs) => {
                                const left = rs.filter((r) => r.id !== row.id);
                                return left.length ? left : [blankStudentRow(defaultCoach)];
                              })
                            }
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </div>
                      {issues.length ? (
                        <p className="mt-2 text-meta text-destructive">{issues.join(" · ")}</p>
                      ) : null}
                    </div>
                  );
                })}
                <Button
                  variant="outline"
                  className="min-h-11 press"
                  onClick={() => addRow(rows[rows.length - 1])}
                >
                  <Plus className="size-4" /> Add another student
                </Button>
              </div>

              <div className="sticky bottom-0 -mx-6 flex flex-wrap items-center justify-between gap-3 border-t border-divider bg-popover px-6 py-4">
                <label className="flex items-center gap-2 text-sm text-text-primary">
                  <Checkbox
                    checked={sendInvites}
                    onCheckedChange={(v) => setSendInvites(v === true)}
                  />
                  Send invites now
                </label>
                <div className="flex items-center gap-3">
                  {filled.length > ready.length ? (
                    <span className="text-meta text-text-secondary">
                      {filled.length - ready.length} need attention
                    </span>
                  ) : null}
                  <Button
                    className="min-h-11 press"
                    disabled={!ready.length || busy}
                    onClick={() => setConfirm(true)}
                  >
                    {busy ? "Adding…" : label}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{label}?</AlertDialogTitle>
            <AlertDialogDescription>
              {sendInvites
                ? "Each family (or adult athlete) gets their invitation email now. Students go on the coach's roster you picked."
                : "Students go on the coach's roster you picked. No emails are sent — invite them later from Users."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void submit()}>Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function Field({
  label,
  action,
  children,
}: {
  label: string;
  action?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-caption uppercase text-text-secondary">{label}</span>
        {action ? (
          <button
            type="button"
            onClick={action}
            className="press-soft text-micro uppercase text-accent-ink"
          >
            Apply to all
          </button>
        ) : null}
      </div>
      {children}
    </div>
  );
}
