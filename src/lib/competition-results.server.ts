/**
 * Server-only helpers for linking a rostered athlete to a skater in a finished
 * competition, and for pulling that skater's judged protocols.
 *
 * Everything here reads the same published USFS pages the Live Board already
 * reads. Nothing is written for a skater who has not been linked by their coach.
 *
 * The business-logic functions below (competitions/finished through
 * listCoachRosterForCompetition) are the single source of truth for
 * `competition-results.functions.ts` and the `/api/v1` "Live Board and
 * competitions" results-linking routes (PRD §7.10, Appendix A). Extracted
 * without behavior changes; the web wrapper turns `ApiError`s back into
 * their original plain messages via `rethrowPlain`.
 */

import { z } from "zod";
import { generateObject } from "ai";
import { ApiError } from "./api/errors";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";
import { PROMPT_INJECTION_GUARD, sanitizeUserContent } from "./ai-prompt-safety";
import { dbError } from "./db-error";
import { DONE_STATUSES, fetchPage, parseEvent, parseIndex } from "./ijs-scrape.server";
import { normalizeName } from "./board-types";
import { DEMO_RESULTS_HOST, demoSkaterResults } from "./demo-competition-results.server";
import type { SkaterProtocol } from "./board-types";
import { deleteProtocolEvents, replaceProtocolEvents } from "./skill-events.server";
import { loadCoachAthleteProfile, type LoadCoachAthleteProfile } from "./athlete-profile.server";
import { getSport } from "./coach-sports";
import { NAME_PLACEHOLDER_NOTE, unmaskStrings } from "./ai-names";
import { loadAthleteNameMask } from "./ai-names.server";
import type { AdminDb } from "./competitions.server";

/** One event a named skater appeared in, as published. */
interface IndexedSkaterEvent {
  file: string;
  event: string;
  segment: string;
  day: string;
  place: string;
  score: string;
}

interface IndexedSkater {
  name: string;
  club: string;
  events: IndexedSkaterEvent[];
}

interface SkaterIndex {
  builtAt: string;
  skaters: IndexedSkater[];
}

/** Cache lifetime for the per-competition skater index. */
const SKATER_INDEX_TTL_MS = 24 * 60 * 60_000;

/** Fetch pages a few at a time so one competition never floods the source. */
async function inBatches<T, R>(
  items: T[],
  size: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    const slice = items.slice(i, i + size);
    out.push(...(await Promise.all(slice.map(fn))));
  }
  return out;
}

/**
 * Walk every finished event of a competition and collect the skaters who
 * appear, with the events they skated. Protocols are not stored here — they are
 * fetched for one skater at link time.
 */
async function buildSkaterIndex(base: string, year: number): Promise<SkaterIndex> {
  const { events } = parseIndex(await fetchPage(`${base}/index.asp`), year);
  const done = events.filter((e) => DONE_STATUSES.includes(e.status.toLowerCase())).slice(0, 200);

  const byName = new Map<string, IndexedSkater>();

  await inBatches(done, 5, async (e) => {
    let page: ReturnType<typeof parseEvent>;
    try {
      page = parseEvent(await fetchPage(`${base}/${e.file}`));
    } catch {
      return; // a single unreadable event must not sink the index
    }
    for (const s of page.skaters) {
      if (!s.name) continue;
      const key = normalizeName(s.name);
      const entry = byName.get(key) ?? { name: s.name, club: s.club, events: [] };
      if (!entry.club && s.club) entry.club = s.club;
      entry.events.push({
        file: e.file,
        event: page.event || e.name,
        segment: page.segment,
        day: e.day,
        place: s.place || s.segPlace,
        score: s.total || s.segScore,
      });
      byName.set(key, entry);
    }
  });

  return { builtAt: new Date().toISOString(), skaters: [...byName.values()] };
}

/** 0–1 similarity between two names, tolerant of nicknames and middle names. */
function nameScore(athlete: string, skater: string): number {
  const a = normalizeName(athlete).split(" ").filter(Boolean);
  const b = normalizeName(skater).split(" ").filter(Boolean);
  if (!a.length || !b.length) return 0;
  if (a.join(" ") === b.join(" ")) return 1;

  const aLast = a[a.length - 1]!;
  const bLast = b[b.length - 1]!;
  const aFirst = a[0]!;
  const bFirst = b[0]!;

  let score = 0;
  if (aLast === bLast) score += 0.6;
  if (aFirst === bFirst) score += 0.4;
  else if (aFirst.startsWith(bFirst) || bFirst.startsWith(aFirst)) score += 0.25;
  return Math.min(score, 0.99);
}

interface FetchedResult {
  eventName: string;
  segment: string;
  rink: string;
  eventFile: string;
  startOrder: number | null;
  placement: string;
  segmentScore: string;
  totalScore: string;
  protocol: SkaterProtocol | null;
}

/**
 * Re-read the events a linked skater appeared in and return their published
 * result and judged protocol for each one.
 */
async function fetchSkaterResults(
  base: string,
  files: string[],
  skaterName: string,
): Promise<FetchedResult[]> {
  const key = normalizeName(skaterName);
  const out: FetchedResult[] = [];

  if (base.includes(DEMO_RESULTS_HOST)) {
    return demoSkaterResults(skaterName, files);
  }

  await inBatches([...new Set(files)].slice(0, 12), 3, async (file) => {
    let page: ReturnType<typeof parseEvent>;
    try {
      page = parseEvent(await fetchPage(`${base}/${file}`));
    } catch {
      return;
    }
    const s = page.skaters.find((x) => normalizeName(x.name) === key);
    if (!s) return;
    out.push({
      eventName: page.event || file,
      segment: page.segment,
      rink: page.venue,
      eventFile: file,
      startOrder: Number.isFinite(s.start) ? s.start : null,
      placement: s.place || s.segPlace,
      segmentScore: s.segScore,
      totalScore: s.total,
      protocol: s.protocol,
    });
  });

  return out;
}

/* ============================================================
 * Business logic: results linking, drafting, and the coach's
 * post-event flow. Everything below reaches the competition
 * tables through the loose `AdminDb` accessor (see
 * competitions.server.ts) because they come from a staged
 * migration and are not in the generated Supabase types yet.
 * ============================================================ */

const notFound = (message: string) => new ApiError({ code: "not_found", status: 404, message });
const wrongRole = (message: string) => new ApiError({ code: "wrong_role", status: 403, message });
const forbidden = (message: string) => new ApiError({ code: "forbidden", status: 403, message });
const aiUnavailable = (message: string) =>
  new ApiError({ code: "ai_unavailable", status: 503, message });

/* ------------------------------------------------------------------ types */

export interface FinishedCompetitionDTO {
  id: string;
  name: string;
  datesLabel: string;
  location: string;
}

export interface SkaterMatchDTO {
  name: string;
  club: string;
  score: number;
  events: { file: string; event: string; segment: string; place: string; score: string }[];
}

export interface AthleteResultDTO {
  id: string;
  competitionId: string;
  competitionName: string;
  eventName: string;
  segment: string;
  rink: string;
  placement: string;
  segmentScore: string;
  totalScore: string;
  protocol: SkaterProtocol | null;
}

export interface AthleteCompetitionLinkDTO {
  competitionId: string;
  competitionName: string;
  datesLabel: string;
  skaterName: string;
  club: string;
  results: AthleteResultDTO[];
  /** Newest plan this coach already generated from this competition, if any. */
  existingPlan: { id: string; title: string; status: string } | null;
}

export interface CoachPostEventAthleteDTO {
  athleteId: string;
  name: string;
  /** e.g. "Short program 4th · Free skate 2nd" */
  summary: string;
  hasRecap: boolean;
}

export interface CoachPostEventItemDTO {
  competitionId: string;
  competitionName: string;
  datesLabel: string;
  /** Rostered athletes already linked to this competition. */
  linked: CoachPostEventAthleteDTO[];
}

export interface CoachRosterCandidateDTO {
  athleteId: string;
  name: string;
  /** Already linked to this competition. */
  linked: boolean;
}

export interface GeneratedPlanResultDTO {
  planId: string;
  title: string;
  moveCount: number;
}

/* ------------------------------------------------------------- guard rails */

/**
 * The only gate that matters: the caller must be a coach with this athlete on
 * their roster. The athlete id is always re-checked here, never trusted.
 */
async function assertRosteredCoach(
  admin: AdminDb,
  userId: string,
  athleteId: string,
): Promise<string> {
  const coach = await admin.from("coach_profiles").select("id").eq("user_id", userId).maybeSingle();
  if (coach.error) dbError(coach.error);
  if (!coach.data) throw wrongRole("Only coaches can link competition results");

  const link = await admin
    .from("coach_athletes")
    .select("athlete_id")
    .eq("coach_id", coach.data.id)
    .eq("athlete_id", athleteId)
    .maybeSingle();
  if (link.error) dbError(link.error);
  if (!link.data) throw forbidden("Athlete is not on your roster");

  return coach.data.id as string;
}

type CompetitionRow = {
  id: string;
  name: string;
  dates_label: string;
  location: string;
  ijs_base_url: string;
  year: number;
  ends_on: string | null;
};

async function loadCompetition(admin: AdminDb, id: string): Promise<CompetitionRow> {
  const { data, error } = await admin
    .from("competitions")
    .select("id, name, dates_label, location, ijs_base_url, year, ends_on")
    .eq("id", id)
    .maybeSingle();
  if (error) dbError(error);
  if (!data) throw notFound("Competition not found");
  return data as CompetitionRow;
}

async function requireCoachId(admin: AdminDb, userId: string): Promise<string> {
  const coach = await admin.from("coach_profiles").select("id").eq("user_id", userId).maybeSingle();
  if (coach.error) dbError(coach.error);
  if (!coach.data) throw wrongRole("Only coaches can do this");
  return coach.data.id as string;
}

async function coachAthleteIds(admin: AdminDb, coachId: string): Promise<string[]> {
  const rows = await admin.from("coach_athletes").select("athlete_id").eq("coach_id", coachId);
  if (rows.error) dbError(rows.error);
  return [...new Set<string>((rows.data ?? []).map((r: any) => r.athlete_id as string))];
}

/* ------------------------------------------------------ finished comp list */

export const athleteIdInput = z.object({ athleteId: z.string().uuid() });

/** Competitions whose results are final — live events cannot be linked. */
export async function listFinishedCompetitions(
  admin: AdminDb,
  userId: string,
  input: z.infer<typeof athleteIdInput>,
): Promise<FinishedCompetitionDTO[]> {
  await assertRosteredCoach(admin, userId, input.athleteId);
  const today = new Date().toISOString().slice(0, 10);
  const { data: rows, error } = await admin
    .from("competitions")
    .select("id, name, dates_label, location, ends_on")
    .lt("ends_on", today)
    .order("ends_on", { ascending: false })
    .limit(25);
  if (error) dbError(error);
  return (rows ?? []).map((c: any) => ({
    id: c.id,
    name: c.name,
    datesLabel: c.dates_label,
    location: c.location,
  }));
}

/* ----------------------------------------------------------- name matching */

export const listSkaterMatchesInput = z.object({
  athleteId: z.string().uuid(),
  competitionId: z.string().uuid(),
});

/**
 * Likely skater matches for one athlete in one finished competition. The
 * athlete is validated against the roster first, so matching can only rank
 * names — never widen who the coach may reach.
 */
export async function listSkaterMatches(
  admin: AdminDb,
  userId: string,
  input: z.infer<typeof listSkaterMatchesInput>,
): Promise<SkaterMatchDTO[]> {
  await assertRosteredCoach(admin, userId, input.athleteId);

  const athlete = await admin
    .from("athletes")
    .select("first_name, last_name")
    .eq("id", input.athleteId)
    .maybeSingle();
  if (athlete.error) dbError(athlete.error);
  if (!athlete.data) throw notFound("Athlete not found");
  const fullName = `${athlete.data.first_name} ${athlete.data.last_name}`.trim();

  const comp = await loadCompetition(admin, input.competitionId);

  const snap = await admin
    .from("competition_snapshots")
    .select("skater_index")
    .eq("competition_id", comp.id)
    .maybeSingle();
  if (snap.error) dbError(snap.error);

  let index = (snap.data?.skater_index ?? null) as SkaterIndex | null;
  const fresh =
    index?.builtAt && Date.now() - new Date(index.builtAt).getTime() < SKATER_INDEX_TTL_MS;

  if (!index?.skaters?.length || !fresh) {
    index = await buildSkaterIndex(comp.ijs_base_url, comp.year);
    const up = await admin
      .from("competition_snapshots")
      .upsert({ competition_id: comp.id, skater_index: index }, { onConflict: "competition_id" });
    if (up.error) dbError(up.error);
  }

  return index.skaters
    .map((s) => ({
      name: s.name,
      club: s.club,
      score: nameScore(fullName, s.name),
      events: s.events.map((e) => ({
        file: e.file,
        event: e.event,
        segment: e.segment,
        place: e.place,
        score: e.score,
      })),
    }))
    .filter((s) => s.score >= 0.4)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, 12);
}

/* -------------------------------------------------------------- the link */

export const linkAthleteToSkaterInput = z.object({
  athleteId: z.string().uuid(),
  competitionId: z.string().uuid(),
  skaterName: z.string().trim().min(1).max(120),
  club: z.string().trim().max(160).default(""),
  files: z
    .array(z.string().regex(/^[A-Za-z0-9_]+\.html$/))
    .min(1)
    .max(12),
});

/** Link the athlete to a skater and store that skater's results and protocols. */
export async function linkAthleteToSkater(
  admin: AdminDb,
  userId: string,
  input: z.infer<typeof linkAthleteToSkaterInput>,
): Promise<{ linked: number }> {
  const coachId = await assertRosteredCoach(admin, userId, input.athleteId);
  const comp = await loadCompetition(admin, input.competitionId);

  const link = await admin
    .from("athlete_competition_skaters")
    .upsert(
      {
        athlete_id: input.athleteId,
        competition_id: comp.id,
        skater_name: input.skaterName,
        club: input.club,
        linked_by: userId,
      },
      { onConflict: "athlete_id,competition_id" },
    )
    .select("id, created_at")
    .single();
  if (link.error) dbError(link.error);

  const results = await fetchSkaterResults(comp.ijs_base_url, input.files, input.skaterName);

  if (results.length) {
    const rows = results.map((r) => ({
      athlete_id: input.athleteId,
      competition_id: comp.id,
      event_name: r.eventName,
      segment: r.segment,
      rink: r.rink,
      event_file: r.eventFile,
      start_order: r.startOrder,
      placement: r.placement,
      segment_score: r.segmentScore,
      total_score: r.totalScore,
      protocol: r.protocol,
      updated_at: new Date().toISOString(),
    }));
    const up = await admin
      .from("athlete_competition_results")
      .upsert(rows, { onConflict: "athlete_id,competition_id,event_name,segment" });
    if (up.error) dbError(up.error);
  }

  // Protocol-derived skill events (PRD §6.7 item 4). Best effort: the link and
  // results above are what the coach asked for. Built from every result
  // stored for this competition, not just this call's fetch, because stored
  // rows are never pruned and a re-link whose page fetch failed must not
  // erase events for results that are still on file. The demo competition
  // is fabricated data and never feeds an athlete's history.
  if (!comp.ijs_base_url.includes(DEMO_RESULTS_HOST)) {
    try {
      const stored = await admin
        .from("athlete_competition_results")
        .select("event_name, segment, protocol")
        .eq("athlete_id", input.athleteId)
        .eq("competition_id", comp.id);
      if (stored.error) throw stored.error;
      await replaceProtocolEvents(admin, {
        athleteId: input.athleteId,
        coachId,
        userId,
        competitionId: comp.id,
        // The competition's last day; failing that, when it was first linked
        // (stable across re-links, unlike "now").
        occurredAt: comp.ends_on
          ? `${comp.ends_on}T12:00:00Z`
          : ((link.data?.created_at as string | undefined) ?? new Date().toISOString()),
        results: ((stored.data ?? []) as any[]).map((r) => ({
          eventName: r.event_name as string,
          segment: r.segment as string,
          protocol: (r.protocol ?? null) as SkaterProtocol | null,
        })),
      });
    } catch (e) {
      console.error("[competition-results] protocol skill events failed", e);
    }
  }

  return { linked: results.length };
}

/**
 * Unlink an athlete from a competition. The API addresses the link by
 * competition id (there is no separate surrogate "link id" in the schema —
 * the link is keyed by (athlete_id, competition_id) — same "id vs slug"
 * accommodation as `recordAttendance` in competitions.server.ts).
 */
export const unlinkAthleteCompetitionInput = z.object({
  athleteId: z.string().uuid(),
  competitionId: z.string().uuid(),
});

export async function unlinkAthleteCompetition(
  admin: AdminDb,
  userId: string,
  input: z.infer<typeof unlinkAthleteCompetitionInput>,
): Promise<{ ok: true }> {
  await assertRosteredCoach(admin, userId, input.athleteId);

  const delResults = await admin
    .from("athlete_competition_results")
    .delete()
    .eq("athlete_id", input.athleteId)
    .eq("competition_id", input.competitionId);
  if (delResults.error) dbError(delResults.error);

  const delLink = await admin
    .from("athlete_competition_skaters")
    .delete()
    .eq("athlete_id", input.athleteId)
    .eq("competition_id", input.competitionId);
  if (delLink.error) dbError(delLink.error);

  // The protocol events describe the results just removed; deleted last so a
  // failed results delete never leaves results without their events. Best
  // effort, so unlinking still works before the skill-events migration is applied.
  try {
    await deleteProtocolEvents(admin, input.athleteId, input.competitionId);
  } catch (e) {
    console.error("[competition-results] protocol skill events delete failed", e);
  }

  return { ok: true };
}

/* ------------------------------------------------------- stored results */

/** `GET /athletes/{id}/competition-results` (Appendix A). */
export async function getAthleteCompetitionResults(
  admin: AdminDb,
  userId: string,
  input: z.infer<typeof athleteIdInput>,
): Promise<AthleteCompetitionLinkDTO[]> {
  const coachId = await assertRosteredCoach(admin, userId, input.athleteId);

  const links = await admin
    .from("athlete_competition_skaters")
    .select("competition_id, skater_name, club, created_at")
    .eq("athlete_id", input.athleteId)
    .order("created_at", { ascending: false });
  if (links.error) dbError(links.error);
  const linkRows = (links.data ?? []) as {
    competition_id: string;
    skater_name: string;
    club: string;
  }[];
  if (!linkRows.length) return [];

  const compIds = linkRows.map((l) => l.competition_id);
  const comps = await admin.from("competitions").select("id, name, dates_label").in("id", compIds);
  if (comps.error) dbError(comps.error);
  const byComp = new Map(
    ((comps.data ?? []) as { id: string; name: string; dates_label: string }[]).map((c) => [
      c.id,
      c,
    ]),
  );

  const res = await admin
    .from("athlete_competition_results")
    .select(
      "id, competition_id, event_name, segment, rink, placement, segment_score, total_score, protocol",
    )
    .eq("athlete_id", input.athleteId)
    .in("competition_id", compIds);
  if (res.error) dbError(res.error);
  const resultRows = (res.data ?? []) as any[];

  // Plans this coach already drafted from these competitions, newest first.
  const planRows = await admin
    .from("plans")
    .select("id, title, status, source_competition_id, created_at")
    .eq("coach_id", coachId)
    .eq("athlete_id", input.athleteId)
    .in("source_competition_id", compIds)
    .order("created_at", { ascending: false });
  if (planRows.error) dbError(planRows.error);
  const planByComp = new Map<string, { id: string; title: string; status: string }>();
  for (const p of (planRows.data ?? []) as any[]) {
    const cid = p.source_competition_id as string;
    if (!planByComp.has(cid)) {
      planByComp.set(cid, {
        id: p.id as string,
        title: (p.title as string) ?? "Practice plan",
        status: (p.status as string) ?? "draft",
      });
    }
  }

  return linkRows.map((l) => {
    const c = byComp.get(l.competition_id);
    return {
      competitionId: l.competition_id,
      competitionName: c?.name ?? "Competition",
      datesLabel: c?.dates_label ?? "",
      skaterName: l.skater_name,
      club: l.club,
      results: resultRows
        .filter((r) => r.competition_id === l.competition_id)
        .map((r) => ({
          id: r.id,
          competitionId: r.competition_id,
          competitionName: c?.name ?? "Competition",
          eventName: r.event_name,
          segment: r.segment,
          rink: r.rink,
          placement: r.placement,
          segmentScore: r.segment_score,
          totalScore: r.total_score,
          protocol: (r.protocol ?? null) as SkaterProtocol | null,
        })),
      existingPlan: planByComp.get(l.competition_id) ?? null,
    };
  });
}

/* ------------------------------------------------- draft plan generation */

const moveSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(600).default(""),
  cue: z.string().max(300).default(""),
  why: z.string().max(300).default(""),
  targetKind: z.enum(["reps", "mins"]),
  targetValue: z.number().min(1).max(600),
});

/** Compact, prompt-sized description of what the judges actually wrote down. */
function describeProtocol(r: AthleteResultDTO): string {
  const p = r.protocol;
  const head = `${r.eventName}${r.segment ? ` — ${r.segment}` : ""} · placed ${r.placement || "—"} · score ${r.totalScore || r.segmentScore || "—"}`;
  if (!p) return head;

  const weak = p.elements
    .filter((e) => parseFloat(e.goe) < 0 || /</.test(e.executed) || /\*/.test(e.executed))
    .slice(0, 10)
    .map((e) => `${e.executed || e.planned} (GOE ${e.goe}, ${e.score})`);
  const components = [...p.components]
    .sort((a, b) => parseFloat(a.unfactored) - parseFloat(b.unfactored))
    .slice(0, 3)
    .map((c) => `${c.name} ${c.unfactored}`);
  const deductions = p.deductions.map((d) => `${d.name} ${d.value}`);

  return [
    head,
    `Elements ${p.elementsScore} · Components ${p.componentsScore} · Deductions ${p.deductionsScore}`,
    weak.length ? `Elements that lost value: ${weak.join("; ")}` : "No negative-GOE elements.",
    components.length ? `Lowest components: ${components.join("; ")}` : "",
    deductions.length ? `Deductions: ${deductions.join("; ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * `POST /athletes/{id}/competition-results/{resultId}/generate-plan` (Appendix
 * A). `resultId` in the path is the competition id — a coach drafts a plan
 * from an athlete's whole "stacked folder" of results for one competition,
 * never a single event row (same id-naming accommodation as `unlinkAthleteCompetition`).
 */
export const generatePlanFromResultsInput = z.object({
  athleteId: z.string().uuid(),
  competitionId: z.string().uuid(),
});

/** The sport of the results this module stores (IJS judged protocols). */
const RESULTS_SPORT = "figure_skating";

type DraftPlan = { title: string; notes: string; moves: z.infer<typeof moveSchema>[] };

const draftPlanSchema = z.object({
  title: z.string().min(1).max(120).describe("Plan title, max 8 words, no emoji"),
  notes: z.string().max(800).describe("1-2 sentence competition takeaway"),
  moves: z.array(moveSchema).min(1).max(8).describe("The practice moves"),
});

/** Seams for tests: the model call and the athlete profile (L3). */
export interface PlanFromResultsDeps {
  generate?: (args: { prompt: string; apiKey: string }) => Promise<DraftPlan>;
  loadProfile?: LoadCoachAthleteProfile;
  /** The names kept out of the prompt (`loadAthleteNameMask` by default). */
  loadMask?: typeof loadAthleteNameMask;
}

const defaultDraftGenerate: NonNullable<PlanFromResultsDeps["generate"]> = async ({
  prompt,
  apiKey,
}) => {
  const gateway = createLovableAiGatewayProvider(apiKey);
  const generated = await generateObject({
    model: gateway("google/gemini-2.5-flash"),
    schema: draftPlanSchema,
    prompt,
  });
  return generated.object;
};

/**
 * Draft a practice plan from the athlete's stored protocol. The result is a
 * draft the coach edits before sharing — never auto-assigned.
 *
 * L3 (PRD §6.7 item 6): the prompt also carries the athlete profile, which
 * includes every linked competition's scores (the whole results history, not
 * just this one) and the athlete's pace and level changes; the persona comes
 * from the results' sport (`RESULTS_SPORT`), not a string in the prompt.
 */
export async function generatePlanFromResults(
  admin: AdminDb,
  userId: string,
  input: z.infer<typeof generatePlanFromResultsInput>,
  deps: PlanFromResultsDeps = {},
): Promise<GeneratedPlanResultDTO> {
  const coachId = await assertRosteredCoach(admin, userId, input.athleteId);

  const res = await admin
    .from("athlete_competition_results")
    .select(
      "id, competition_id, event_name, segment, rink, placement, segment_score, total_score, protocol",
    )
    .eq("athlete_id", input.athleteId)
    .eq("competition_id", input.competitionId);
  if (res.error) dbError(res.error);
  const rows = (res.data ?? []) as any[];
  if (!rows.length) throw notFound("No stored results for this competition yet");

  const comp = await loadCompetition(admin, input.competitionId);
  const athlete = await admin
    .from("athletes")
    .select("first_name")
    .eq("id", input.athleteId)
    .maybeSingle();
  if (athlete.error) dbError(athlete.error);

  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) throw aiUnavailable("AI service is unavailable. Please try again later.");

  // Results are judged IJS protocols, which exist only for figure skating
  // today, so the persona and the profile are that sport's; a sport with its
  // own structured results would pass its key here.
  const sport = RESULTS_SPORT;
  const persona = (getSport(sport)?.label ?? "figure skating").toLowerCase();
  const profile = await (deps.loadProfile ?? loadCoachAthleteProfile)(
    admin,
    coachId,
    input.athleteId,
    new Date(),
    [sport],
  );

  const detail = rows
    .map((r) =>
      describeProtocol({
        id: r.id,
        competitionId: r.competition_id,
        competitionName: comp.name,
        eventName: r.event_name,
        segment: r.segment,
        rink: r.rink,
        placement: r.placement,
        segmentScore: r.segment_score,
        totalScore: r.total_score,
        protocol: r.protocol,
      }),
    )
    .join("\n\n");

  const firstName = sanitizeUserContent(athlete.data?.first_name ?? "the skater", 40);
  const prompt = `${PROMPT_INJECTION_GUARD}

You are a ${persona} coach writing an off-ice and on-ice practice plan for ${firstName}, based only on the judged protocol below from ${sanitizeUserContent(comp.name, 100)}.

${sanitizeUserContent(detail, 6000)}
${
  profile.text
    ? `
${profile.text}
Use the profile only to size the plan and to notice a problem that repeats across competitions (the score history above); the moves must still target what this protocol shows.
`
    : ""
}
Write 3 to 6 practice moves that target exactly what the protocol shows lost value — underrotations, negative GOE elements, falls, and the lowest program components. Do not invent problems the protocol does not show. For each move give:
- name: short and specific (max 6 words)
- description: 1-2 sentences on how to practise it
- cue: one short cue the skater can repeat
- why: one sentence tying it to the protocol (name the element or component)
- targetKind: "reps" or "mins"
- targetValue: a realistic number

Return an object with exactly these keys: "title" (the plan title, max 8 words, no emoji), "notes" (1-2 sentence summary of the competition takeaway), and "moves" (the array of practice moves).`;

  // No names reach the model, including the skater's name on the protocol
  // (src/lib/ai-names.ts).
  const names = await (deps.loadMask ?? loadAthleteNameMask)(admin, input.athleteId);

  let object: DraftPlan;
  try {
    const masked = await (deps.generate ?? defaultDraftGenerate)({
      prompt: `${names.mask(prompt)}\n\n${NAME_PLACEHOLDER_NOTE}`,
      apiKey,
    });
    object = unmaskStrings(masked, names.unmask);
  } catch (err) {
    console.error("[competition plan draft]", err);
    throw aiUnavailable("Could not draft the plan. Please try again.");
  }

  const ins = await admin
    .from("plans")
    .insert({
      coach_id: coachId,
      athlete_id: input.athleteId,
      kind: "plan",
      status: "draft",
      source: "competition",
      source_competition_id: input.competitionId,
      title: object.title.trim(),
      notes: object.notes.trim(),
    })
    .select("id")
    .single();
  if (ins.error) dbError(ins.error);
  const planId = ins.data!.id as string;

  // Reuse the coach's own library where a move already exists by name.
  const lib = await admin
    .from("moves")
    .select("id, name")
    .eq("coach_id", coachId)
    .is("archived_at", null);
  if (lib.error) dbError(lib.error);
  const byName = new Map(
    ((lib.data ?? []) as { id: string; name: string }[]).map((m) => [m.name.toLowerCase(), m.id]),
  );

  const moveRows = object.moves.map((m, i) => ({
    plan_id: planId,
    position: i + 1,
    move_id: byName.get(m.name.toLowerCase()) ?? null,
    name: m.name,
    description: m.description,
    cue: m.cue,
    why: m.why,
    target_kind: m.targetKind,
    target_value: m.targetValue,
  }));
  const pm = await admin.from("plan_moves").insert(moveRows);
  if (pm.error) dbError(pm.error);

  return { planId, title: object.title.trim(), moveCount: moveRows.length };
}

/* ------------------------------------------------- coach post-event flow */

/** How long after an event ends we keep asking the coach about it. */
const COACH_ASK_WINDOW_DAYS = 7;

/**
 * Competitions this coach watched on a live board that have since finished,
 * with whatever they've already linked. Drives the roster action item.
 */
export async function getCoachPostEventItems(
  admin: AdminDb,
  userId: string,
): Promise<CoachPostEventItemDTO[]> {
  const coach = await admin.from("coach_profiles").select("id").eq("user_id", userId).maybeSingle();
  if (coach.error) dbError(coach.error);
  if (!coach.data) return [];
  const coachId = coach.data.id as string;

  const attend = await admin
    .from("competition_attendance")
    .select("competition_id, first_seen_at")
    .eq("user_id", userId)
    .eq("viewer_role", "coach")
    .is("dismissed_at", null)
    .order("first_seen_at", { ascending: false })
    .limit(10);
  if (attend.error) dbError(attend.error);
  const compIds = (attend.data ?? []).map((r: any) => r.competition_id as string);
  if (!compIds.length) return [];

  const comps = await admin
    .from("competitions")
    .select("id, name, dates_label, ends_on")
    .in("id", compIds);
  if (comps.error) dbError(comps.error);

  const now = new Date();
  const windowStart = new Date(now.getTime() - COACH_ASK_WINDOW_DAYS * 86_400_000);
  const finished = (comps.data ?? []).filter((c: any) => {
    if (!c.ends_on) return false;
    const ended = new Date(`${c.ends_on}T23:59:59Z`);
    return ended <= now && ended >= windowStart;
  });
  if (!finished.length) return [];

  const rosterIds = await coachAthleteIds(admin, coachId);
  const finishedIds = finished.map((c: any) => c.id as string);

  let linkRows: any[] = [];
  let resultRows: any[] = [];
  let recapRows: any[] = [];
  if (rosterIds.length) {
    const [links, results, recaps] = await Promise.all([
      admin
        .from("athlete_competition_skaters")
        .select("athlete_id, competition_id")
        .in("athlete_id", rosterIds)
        .in("competition_id", finishedIds),
      admin
        .from("athlete_competition_results")
        .select("athlete_id, competition_id, segment, event_name, placement")
        .in("athlete_id", rosterIds)
        .in("competition_id", finishedIds),
      admin
        .from("competition_recaps")
        .select("athlete_id, competition_id")
        .in("athlete_id", rosterIds)
        .in("competition_id", finishedIds),
    ]);
    if (links.error) dbError(links.error);
    if (results.error) dbError(results.error);
    if (recaps.error) dbError(recaps.error);
    linkRows = links.data ?? [];
    resultRows = results.data ?? [];
    recapRows = recaps.data ?? [];
  }

  const linkedAthleteIds = [...new Set(linkRows.map((l) => l.athlete_id as string))];
  let names = new Map<string, string>();
  let handledPlans: any[] = [];
  if (linkedAthleteIds.length) {
    const [ath, plans] = await Promise.all([
      admin.from("athletes").select("id, first_name, last_name").in("id", linkedAthleteIds),
      admin
        .from("plans")
        .select("athlete_id, source_competition_id, status")
        .eq("coach_id", coachId)
        .eq("source", "competition")
        .neq("status", "draft")
        .in("athlete_id", linkedAthleteIds)
        .in("source_competition_id", finishedIds),
    ]);
    if (ath.error) dbError(ath.error);
    if (plans.error) dbError(plans.error);
    names = new Map(
      (ath.data ?? []).map((a: any) => [
        a.id as string,
        `${a.first_name ?? ""} ${a.last_name ?? ""}`.trim() || "Athlete",
      ]),
    );
    handledPlans = plans.data ?? [];
  }

  /** An athlete is done once the coach activated a plan drafted from that event. */
  const isHandled = (athleteId: string, competitionId: string) =>
    handledPlans.some(
      (p) => p.athlete_id === athleteId && p.source_competition_id === competitionId,
    );

  return finished
    .map((c: any) => {
      const compLinks = linkRows.filter((l) => l.competition_id === c.id);
      const linked = compLinks
        .filter((l) => !isHandled(l.athlete_id as string, c.id as string))
        .map((l) => {
          const aid = l.athlete_id as string;
          const summary = resultRows
            .filter((r) => r.competition_id === c.id && r.athlete_id === aid)
            .map((r) =>
              [r.segment || r.event_name, r.placement ? `${r.placement}` : ""]
                .filter(Boolean)
                .join(" "),
            )
            .join(" · ");
          return {
            athleteId: aid,
            name: names.get(aid) ?? "Athlete",
            summary,
            hasRecap: recapRows.some((r) => r.competition_id === c.id && r.athlete_id === aid),
          };
        });
      // Every linked athlete has an activated plan — nothing left to do here.
      if (compLinks.length && !linked.length) return null;
      return {
        competitionId: c.id as string,
        competitionName: (c.name as string) || "the competition",
        datesLabel: (c.dates_label as string) ?? "",
        linked,
      };
    })
    .filter((x: CoachPostEventItemDTO | null): x is CoachPostEventItemDTO => x !== null);
}

/** "No one competed here" — stop asking this coach about this event. */
export const dismissCoachPostEventInput = z.object({ competitionId: z.string().uuid() });

export async function dismissCoachPostEvent(
  admin: AdminDb,
  userId: string,
  input: z.infer<typeof dismissCoachPostEventInput>,
): Promise<{ ok: true }> {
  await requireCoachId(admin, userId);
  const { error } = await admin
    .from("competition_attendance")
    .update({ dismissed_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("competition_id", input.competitionId);
  if (error) dbError(error);
  return { ok: true };
}

export const rosterForCompetitionInput = z.object({ competitionId: z.string().uuid() });

/** Rostered figure-skating athletes the coach can link at this competition. */
export async function listCoachRosterForCompetition(
  admin: AdminDb,
  userId: string,
  input: z.infer<typeof rosterForCompetitionInput>,
): Promise<CoachRosterCandidateDTO[]> {
  const coachId = await requireCoachId(admin, userId);
  const ids = await coachAthleteIds(admin, coachId);
  if (!ids.length) return [];

  const [ath, sports, links] = await Promise.all([
    admin.from("athletes").select("id, first_name, last_name").in("id", ids),
    admin
      .from("coach_athlete_sports")
      .select("athlete_id")
      .in("athlete_id", ids)
      .eq("sport", "figure_skating"),
    admin
      .from("athlete_competition_skaters")
      .select("athlete_id")
      .in("athlete_id", ids)
      .eq("competition_id", input.competitionId),
  ]);
  if (ath.error) dbError(ath.error);
  if (sports.error) dbError(sports.error);
  if (links.error) dbError(links.error);

  const inSport = new Set((sports.data ?? []).map((r: any) => r.athlete_id as string));
  const linked = new Set((links.data ?? []).map((r: any) => r.athlete_id as string));
  // Boards are figure skating only; if nobody has sport rows yet, don't hide everyone.
  const keep = (ath.data ?? []).filter((a: any) => inSport.size === 0 || inSport.has(a.id));
  const out: CoachRosterCandidateDTO[] = keep.map((a: any) => ({
    athleteId: a.id as string,
    name: `${a.first_name ?? ""} ${a.last_name ?? ""}`.trim() || "Athlete",
    linked: linked.has(a.id as string),
  }));
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
