/** Pure rules for club template plans: CSV grouping and which coaches receive a deploy. */

export type TemplateMoveDraft = {
  name: string;
  cue: string;
  why: string;
  targetKind: "reps" | "minutes";
  targetValue: number;
};

export type TemplateDraft = {
  title: string;
  sport: string;
  levelKeys: string[];
  notes: string;
  moves: TemplateMoveDraft[];
};

export type CsvTemplateResult = { templates: TemplateDraft[]; errors: string[] };

const splitLevels = (v: string) =>
  v
    .split(/[;|]/)
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * One CSV row per move. Columns: title, sport, levels (separated by ; or |),
 * notes, move, cue, why, target_kind (reps|minutes), target.
 * Rows with the same title + sport become one template, in file order.
 */
export function groupTemplateCsv(
  rows: Record<string, string>[],
  allowedSports: string[],
): CsvTemplateResult {
  const byKey = new Map<string, TemplateDraft>();
  const errors: string[] = [];
  rows.forEach((r, i) => {
    const line = i + 2;
    const title = (r["title"] ?? r["plan"] ?? "").trim();
    const sport = (r["sport"] ?? "").trim();
    const move = (r["move"] ?? r["move_name"] ?? "").trim();
    if (!title && !move) return;
    if (!title) return void errors.push(`Row ${line}: missing title`);
    if (!allowedSports.includes(sport))
      return void errors.push(`Row ${line}: sport "${sport}" isn't one of your club's sports`);
    const key = `${sport}::${title.toLowerCase()}`;
    let t = byKey.get(key);
    if (!t) {
      t = { title, sport, levelKeys: [], notes: "", moves: [] };
      byKey.set(key, t);
    }
    for (const l of splitLevels(r["levels"] ?? r["level"] ?? ""))
      if (!t.levelKeys.includes(l)) t.levelKeys.push(l);
    if (!t.notes && r["notes"]) t.notes = r["notes"].trim();
    if (!move) return;
    const kindRaw = (r["target_kind"] ?? "reps").trim().toLowerCase();
    const targetKind = kindRaw.startsWith("min") ? "minutes" : "reps";
    const targetValue = Number(r["target"] ?? r["target_value"] ?? "") || 10;
    if (targetValue <= 0) return void errors.push(`Row ${line}: target must be above zero`);
    t.moves.push({
      name: move,
      cue: (r["cue"] ?? "").trim(),
      why: (r["why"] ?? "").trim(),
      targetKind,
      targetValue,
    });
  });
  const templates = Array.from(byKey.values());
  for (const t of templates) if (!t.moves.length) errors.push(`"${t.title}" has no moves`);
  return { templates: templates.filter((t) => t.moves.length), errors };
}

/**
 * A coach receives a template when they coach its sport and, if the template
 * names levels, teach at least one of them. No levels = every coach of the sport.
 */
export function coachReceivesTemplate(
  coachLevels: { sport: string; levelKey: string }[],
  template: { sport: string; levelKeys: string[] },
): boolean {
  const mine = coachLevels.filter((l) => l.sport === template.sport);
  if (!mine.length) return false;
  if (!template.levelKeys.length) return true;
  return mine.some((l) => template.levelKeys.includes(l.levelKey));
}

/** Plan steps store minutes as "mins". */
export const planTargetKind = (k: "reps" | "minutes") => (k === "minutes" ? "mins" : "reps");
