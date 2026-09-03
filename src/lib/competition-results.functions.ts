import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { generateObject } from "ai";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";
import { PROMPT_INJECTION_GUARD, sanitizeUserContent } from "./ai-prompt-safety";
import { dbError } from "./db-error";
import type { SkaterProtocol } from "./board-types";

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
}

/* ------------------------------------------------------------- guard rails */

/**
 * The competition tables are created by a staged migration, so they are not in
 * the generated types yet — reach them through the same loose accessor the
 * board functions use.
 */
async function getAdmin(): Promise<{ from: (t: string) => any }> {
  const m = await import("@/integrations/supabase/client.server");
  return m.supabaseAdmin as unknown as { from: (t: string) => any };
}

/**
 * The only gate that matters: the caller must be a coach with this athlete on
 * their roster. The athlete id is always re-checked here, never trusted.
 */
async function assertRosteredCoach(userId: string, athleteId: string): Promise<string> {
  const admin = await getAdmin();
  const coach = await admin
    .from("coach_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (coach.error) dbError(coach.error);
  if (!coach.data) throw new Error("Only coaches can link competition results");

  const link = await admin
    .from("coach_athletes")
    .select("athlete_id")
    .eq("coach_id", coach.data.id)
    .eq("athlete_id", athleteId)
    .maybeSingle();
  if (link.error) dbError(link.error);
  if (!link.data) throw new Error("Athlete is not on your roster");

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

async function loadCompetition(id: string): Promise<CompetitionRow> {
  const admin = await getAdmin();
  const { data, error } = await admin
    .from("competitions")
    .select("id, name, dates_label, location, ijs_base_url, year, ends_on")
    .eq("id", id)
    .maybeSingle();
  if (error) dbError(error);
  if (!data) throw new Error("Competition not found");
  return data as CompetitionRow;
}

/* ------------------------------------------------------ finished comp list */

const athleteInput = z.object({ athleteId: z.string().uuid() });

/** Competitions whose results are final — live events cannot be linked. */
export const listFinishedCompetitions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => athleteInput.parse(input))
  .handler(async ({ context, data }): Promise<FinishedCompetitionDTO[]> => {
    await assertRosteredCoach(context.userId, data.athleteId);
    const admin = await getAdmin();
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
  });

/* ----------------------------------------------------------- name matching */

/**
 * Likely skater matches for one athlete in one finished competition. The
 * athlete is validated against the roster first, so matching can only rank
 * names — never widen who the coach may reach.
 */
export const listSkaterMatches = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ athleteId: z.string().uuid(), competitionId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ context, data }): Promise<SkaterMatchDTO[]> => {
    await assertRosteredCoach(context.userId, data.athleteId);
    const admin = await getAdmin();

    const athlete = await admin
      .from("athletes")
      .select("first_name, last_name")
      .eq("id", data.athleteId)
      .maybeSingle();
    if (athlete.error) dbError(athlete.error);
    if (!athlete.data) throw new Error("Athlete not found");
    const fullName = `${athlete.data.first_name} ${athlete.data.last_name}`.trim();

    const comp = await loadCompetition(data.competitionId);
    const { SKATER_INDEX_TTL_MS, buildSkaterIndex, nameScore } = await import(
      "./competition-results.server"
    );
    type Index = Awaited<ReturnType<typeof buildSkaterIndex>>;

    const snap = await admin
      .from("competition_snapshots")
      .select("skater_index")
      .eq("competition_id", comp.id)
      .maybeSingle();
    if (snap.error) dbError(snap.error);

    let index = (snap.data?.skater_index ?? null) as Index | null;
    const fresh =
      index?.builtAt && Date.now() - new Date(index.builtAt).getTime() < SKATER_INDEX_TTL_MS;

    if (!index?.skaters?.length || !fresh) {
      index = await buildSkaterIndex(comp.ijs_base_url, comp.year);
      const up = await admin
        .from("competition_snapshots")
        .upsert(
          { competition_id: comp.id, skater_index: index },
          { onConflict: "competition_id" },
        );
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
  });

/* -------------------------------------------------------------- the link */

/** Link the athlete to a skater and store that skater's results and protocols. */
export const linkAthleteToSkater = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        athleteId: z.string().uuid(),
        competitionId: z.string().uuid(),
        skaterName: z.string().trim().min(1).max(120),
        club: z.string().trim().max(160).default(""),
        files: z.array(z.string().regex(/^[A-Za-z0-9_]+\.html$/)).min(1).max(12),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    await assertRosteredCoach(context.userId, data.athleteId);
    const admin = await getAdmin();
    const comp = await loadCompetition(data.competitionId);

    const link = await admin
      .from("athlete_competition_skaters")
      .upsert(
        {
          athlete_id: data.athleteId,
          competition_id: comp.id,
          skater_name: data.skaterName,
          club: data.club,
          linked_by: context.userId,
        },
        { onConflict: "athlete_id,competition_id" },
      )
      .select("id")
      .single();
    if (link.error) dbError(link.error);

    const { fetchSkaterResults } = await import("./competition-results.server");
    const results = await fetchSkaterResults(comp.ijs_base_url, data.files, data.skaterName);

    if (results.length) {
      const rows = results.map((r) => ({
        athlete_id: data.athleteId,
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

    return { linked: results.length };
  });

export const unlinkAthleteCompetition = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ athleteId: z.string().uuid(), competitionId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    await assertRosteredCoach(context.userId, data.athleteId);
    const admin = await getAdmin();

    const delResults = await admin
      .from("athlete_competition_results")
      .delete()
      .eq("athlete_id", data.athleteId)
      .eq("competition_id", data.competitionId);
    if (delResults.error) dbError(delResults.error);

    const delLink = await admin
      .from("athlete_competition_skaters")
      .delete()
      .eq("athlete_id", data.athleteId)
      .eq("competition_id", data.competitionId);
    if (delLink.error) dbError(delLink.error);

    return { ok: true };
  });

/* ------------------------------------------------------- stored results */

export const getAthleteCompetitionResults = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => athleteInput.parse(input))
  .handler(async ({ context, data }): Promise<AthleteCompetitionLinkDTO[]> => {
    await assertRosteredCoach(context.userId, data.athleteId);
    const admin = await getAdmin();

    const links = await admin
      .from("athlete_competition_skaters")
      .select("competition_id, skater_name, club, created_at")
      .eq("athlete_id", data.athleteId)
      .order("created_at", { ascending: false });
    if (links.error) dbError(links.error);
    const linkRows = (links.data ?? []) as {
      competition_id: string;
      skater_name: string;
      club: string;
    }[];
    if (!linkRows.length) return [];

    const compIds = linkRows.map((l) => l.competition_id);
    const comps = await admin
      .from("competitions")
      .select("id, name, dates_label")
      .in("id", compIds);
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
      .eq("athlete_id", data.athleteId)
      .in("competition_id", compIds);
    if (res.error) dbError(res.error);
    const resultRows = (res.data ?? []) as any[];

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
      };
    });
  });

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
 * Draft a practice plan from the athlete's stored protocol. The result is a
 * draft the coach edits before sharing — never auto-assigned.
 */
export const generatePlanFromResults = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ athleteId: z.string().uuid(), competitionId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const coachId = await assertRosteredCoach(context.userId, data.athleteId);
    const admin = await getAdmin();

    const res = await admin
      .from("athlete_competition_results")
      .select("id, competition_id, event_name, segment, rink, placement, segment_score, total_score, protocol")
      .eq("athlete_id", data.athleteId)
      .eq("competition_id", data.competitionId);
    if (res.error) dbError(res.error);
    const rows = (res.data ?? []) as any[];
    if (!rows.length) throw new Error("No stored results for this competition yet");

    const comp = await loadCompetition(data.competitionId);
    const athlete = await admin
      .from("athletes")
      .select("first_name")
      .eq("id", data.athleteId)
      .maybeSingle();
    if (athlete.error) dbError(athlete.error);

    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) throw new Error("AI service is unavailable. Please try again later.");
    const gateway = createLovableAiGatewayProvider(apiKey);

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

You are a figure skating coach writing an off-ice and on-ice practice plan for ${firstName}, based only on the judged protocol below from ${sanitizeUserContent(comp.name, 100)}.

${sanitizeUserContent(detail, 6000)}

Write 3 to 6 practice moves that target exactly what the protocol shows lost value — underrotations, negative GOE elements, falls, and the lowest program components. Do not invent problems the protocol does not show. For each move give:
- name: short and specific (max 6 words)
- description: 1-2 sentences on how to practise it
- cue: one short cue the skater can repeat
- why: one sentence tying it to the protocol (name the element or component)
- targetKind: "reps" or "mins"
- targetValue: a realistic number

Also write a plan title (max 8 words, no emoji) and a 1-2 sentence note summarising the competition takeaway.`;

    let object: { title: string; notes: string; moves: z.infer<typeof moveSchema>[] };
    try {
      const generated = await generateObject({
        model: gateway("google/gemini-2.5-flash"),
        schema: z.object({
          title: z.string().min(1).max(120),
          notes: z.string().max(800),
          moves: z.array(moveSchema).min(1).max(8),
        }),
        prompt,
      });
      object = generated.object;
    } catch (err) {
      console.error("[competition plan draft]", err);
      throw new Error("Could not draft the plan. Please try again.");
    }

    const ins = await admin
      .from("plans")
      .insert({
        coach_id: coachId,
        athlete_id: data.athleteId,
        kind: "plan",
        status: "draft",
        source: "competition",
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
  });

/* ------------------------------------------------- coach post-event flow */

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

/** How long after an event ends we keep asking the coach about it. */
const COACH_ASK_WINDOW_DAYS = 7;

async function requireCoachId(userId: string): Promise<string> {
  const admin = await getAdmin();
  const coach = await admin
    .from("coach_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (coach.error) dbError(coach.error);
  if (!coach.data) throw new Error("Only coaches can do this");
  return coach.data.id as string;
}

async function coachAthleteIds(coachId: string): Promise<string[]> {
  const admin = await getAdmin();
  const rows = await admin.from("coach_athletes").select("athlete_id").eq("coach_id", coachId);
  if (rows.error) dbError(rows.error);
  return [...new Set((rows.data ?? []).map((r: any) => r.athlete_id as string))];
}

/**
 * Competitions this coach watched on a live board that have since finished,
 * with whatever they've already linked. Drives the roster action item.
 */
export const getCoachPostEventItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CoachPostEventItemDTO[]> => {
    const admin = await getAdmin();
    const coach = await admin
      .from("coach_profiles")
      .select("id")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (coach.error) dbError(coach.error);
    if (!coach.data) return [];
    const coachId = coach.data.id as string;

    const attend = await admin
      .from("competition_attendance")
      .select("competition_id, first_seen_at")
      .eq("user_id", context.userId)
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

    const rosterIds = await coachAthleteIds(coachId);
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
    if (linkedAthleteIds.length) {
      const ath = await admin
        .from("athletes")
        .select("id, first_name, last_name")
        .in("id", linkedAthleteIds);
      if (ath.error) dbError(ath.error);
      names = new Map(
        (ath.data ?? []).map((a: any) => [
          a.id as string,
          `${a.first_name ?? ""} ${a.last_name ?? ""}`.trim() || "Athlete",
        ]),
      );
    }

    return finished.map((c: any) => ({
      competitionId: c.id as string,
      competitionName: (c.name as string) || "the competition",
      datesLabel: (c.dates_label as string) ?? "",
      linked: linkRows
        .filter((l) => l.competition_id === c.id)
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
        }),
    }));
  });

/** "No one competed here" — stop asking this coach about this event. */
export const dismissCoachPostEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ competitionId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    await requireCoachId(context.userId);
    const admin = await getAdmin();
    const { error } = await admin
      .from("competition_attendance")
      .update({ dismissed_at: new Date().toISOString() })
      .eq("user_id", context.userId)
      .eq("competition_id", data.competitionId);
    if (error) dbError(error);
    return { ok: true as const };
  });

export interface CoachRosterCandidateDTO {
  athleteId: string;
  name: string;
  /** Already linked to this competition. */
  linked: boolean;
}

/** Rostered figure-skating athletes the coach can link at this competition. */
export const listCoachRosterForCompetition = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ competitionId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ context, data }): Promise<CoachRosterCandidateDTO[]> => {
    const coachId = await requireCoachId(context.userId);
    const admin = await getAdmin();
    const ids = await coachAthleteIds(coachId);
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
        .eq("competition_id", data.competitionId),
    ]);
    if (ath.error) dbError(ath.error);
    if (sports.error) dbError(sports.error);
    if (links.error) dbError(links.error);

    const inSport = new Set((sports.data ?? []).map((r: any) => r.athlete_id as string));
    const linked = new Set((links.data ?? []).map((r: any) => r.athlete_id as string));
    // Boards are figure skating only; if nobody has sport rows yet, don't hide everyone.
    const keep = (ath.data ?? []).filter((a: any) => inSport.size === 0 || inSport.has(a.id));
    return keep
      .map((a: any) => ({
        athleteId: a.id as string,
        name: `${a.first_name ?? ""} ${a.last_name ?? ""}`.trim() || "Athlete",
        linked: linked.has(a.id as string),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });
