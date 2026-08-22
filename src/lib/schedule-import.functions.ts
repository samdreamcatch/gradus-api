import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { generateText } from "ai";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";

// ---------- types ----------

export type MatchCandidate = {
  athleteId: string;
  name: string;
  maskedEmail: string | null;
  reason: "email" | "name";
  /** True when the existing athlete's name also matches the imported row. */
  nameAlsoMatches: boolean;

  onRoster: boolean;
  /** True when name/guardian name are shown as "First L." because there's no connection yet. */
  redacted: boolean;
  /** Parent / guardian on the existing account, when there is one. */
  guardianName: string | null;
  /** Sport + level keys from the athlete's existing goals, when set. */
  sport: string | null;
  levelKey: string | null;
};


export type MatchResult = {
  key: string;
  /** "exact" = confident email match, "possible" = name-only, "new" = nothing found. */
  status: "exact" | "possible" | "new";
  suggestedAthleteId: string | null;
  candidates: MatchCandidate[];
};

export type ParsedLesson = {
  firstName: string;
  lastName: string;
  day: string;
  startTime: string;
  lengthMinutes: number | null;
  frequency: string;
  guardianEmail: string | null;
  athleteEmail: string | null;
};

export type ImportOutcome = {
  key: string;
  name: string;
  status: "created" | "linked" | "failed";
  slotsAdded: number;
  invited: string | null;
  message: string | null;
};

// ---------- image parsing ----------

const IMAGE_SYSTEM = `You transcribe coaching lesson schedules from photos or screenshots into structured rows.
Report only what is visibly written. Never invent names, emails, times or days.
If a field is not visible, leave it empty (or null). One row per lesson per athlete per week.`;

const str = z.union([z.string(), z.number()]).nullish();

// The model sometimes answers with snake_case keys, so accept both spellings
// and normalize below.
const rawLesson = z
  .object({
    firstName: str,
    first_name: str,
    lastName: str,
    last_name: str,
    name: str,
    athlete_name: str,
    athleteName: str,
    day: str,
    day_of_week: str,
    dayOfWeek: str,
    startTime: str,
    start_time: str,
    lengthMinutes: str,
    length_minutes: str,
    lesson_length_minutes: str,
    frequency: str,
    repeats: str,
    guardianEmail: str,
    guardian_email: str,
    athleteEmail: str,
    athlete_email: str,
    email: str,
  })
  .partial();

type RawLesson = z.infer<typeof rawLesson>;

const text = (v: unknown): string => (v == null ? "" : String(v).trim());

function normalize(raw: RawLesson): ParsedLesson {
  const full = text(raw.name ?? raw.athlete_name ?? raw.athleteName);
  let firstName = text(raw.firstName ?? raw.first_name);
  let lastName = text(raw.lastName ?? raw.last_name);
  if (!firstName && !lastName && full) {
    const parts = full.split(/\s+/);
    firstName = parts.shift() ?? "";
    lastName = parts.join(" ");
  }
  const lenRaw = raw.lengthMinutes ?? raw.length_minutes ?? raw.lesson_length_minutes;
  const len = lenRaw == null || lenRaw === "" ? null : Number(lenRaw);
  const email = text(raw.email);
  return {
    firstName,
    lastName,
    day: text(raw.day ?? raw.day_of_week ?? raw.dayOfWeek),
    startTime: text(raw.startTime ?? raw.start_time),
    lengthMinutes: Number.isFinite(len as number) ? (len as number) : null,
    frequency: text(raw.frequency ?? raw.repeats),
    guardianEmail: text(raw.guardianEmail ?? raw.guardian_email) || email || null,
    athleteEmail: text(raw.athleteEmail ?? raw.athlete_email) || null,
  };
}

export const parseScheduleImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        imageDataUrl: z
          .string()
          .min(32)
          .max(8_000_000)
          .refine((v) => v.startsWith("data:image/"), "Upload an image file"),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<{ lessons: ParsedLesson[] }> => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("Photo import isn't available right now.");
    const gateway = createLovableAiGatewayProvider(apiKey);

    try {
      const { text: out } = await generateText({
        model: gateway("google/gemini-2.5-flash"),
        system: IMAGE_SYSTEM,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: 'Transcribe every lesson in this schedule. Reply with ONLY a JSON array (no markdown fences, no commentary). Each element: {"firstName": string, "lastName": string, "day": string, "startTime": string, "lengthMinutes": number|null, "frequency": "weekly"|"biweekly"|"twice_monthly"|"monthly", "guardianEmail": string|null, "athleteEmail": string|null}.',
              },
              { type: "image", image: data.imageDataUrl },
            ],
          },
        ],
      });

      const cleaned = out.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
      const start = cleaned.indexOf("[");
      const end = cleaned.lastIndexOf("]");
      const slice = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
      let parsed: unknown;
      try {
        parsed = JSON.parse(slice);
      } catch {
        throw new Error("Model did not return JSON");
      }
      const arr = Array.isArray(parsed)
        ? parsed
        : Array.isArray((parsed as { elements?: unknown[] })?.elements)
          ? (parsed as { elements: unknown[] }).elements
          : Array.isArray((parsed as { lessons?: unknown[] })?.lessons)
            ? (parsed as { lessons: unknown[] }).lessons
            : [];
      const rows = arr
        .map((r) => rawLesson.safeParse(r))
        .filter((r) => r.success)
        .map((r) => (r as { data: RawLesson }).data);
      const lessons = rows.map(normalize).filter((l) => l.firstName || l.lastName);
      return { lessons };

    } catch (err) {
      console.error("[schedule-import] image parse failed", err);
      throw new Error("Couldn't read that photo. Try a clearer picture, or enter rows manually.");
    }
  });


// ---------- matching ----------

function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const [local, domain] = email.split("@");
  if (!domain) return null;
  const head = local.slice(0, 2);
  return `${head}${local.length > 2 ? "•••" : ""}@${domain}`;
}

/** "Sasha Whitfield" -> "Sasha W." — used for people the coach isn't connected to yet. */
function firstNameLastInitial(first: string | null | undefined, last: string | null | undefined) {
  const f = (first ?? "").trim();
  const l = (last ?? "").trim();
  if (!f) return l ? `${l.slice(0, 1).toUpperCase()}.` : "";
  return l ? `${f} ${l.slice(0, 1).toUpperCase()}.` : f;
}

/** Redact a full name string we only have as one blob (e.g. a guardian name). */
function redactFullName(name: string | null | undefined): string | null {
  if (!name) return null;
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return firstNameLastInitial(parts[0], parts[parts.length - 1]);
}


export const matchScheduleRows = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        athletes: z
          .array(
            z.object({
              key: z.string().min(1).max(300),
              firstName: z.string().trim().min(1).max(80),
              lastName: z.string().trim().min(1).max(80),
              guardianEmail: z.string().trim().toLowerCase().max(255).default(""),
              athleteEmail: z.string().trim().toLowerCase().max(255).default(""),
            }),
          )
          .min(1)
          .max(200),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ results: MatchResult[] }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const coach = await supabaseAdmin
      .from("coach_profiles")
      .select("id")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!coach.data) throw new Error("Coach profile not found");
    const coachId = coach.data.id;

    const rosterRes = await supabaseAdmin
      .from("coach_athletes")
      .select("athlete_id")
      .eq("coach_id", coachId);
    const rosterIds = new Set((rosterRes.data ?? []).map((r) => r.athlete_id as string));

    const emails = new Set<string>();
    for (const a of data.athletes) {
      if (a.guardianEmail) emails.add(a.guardianEmail);
      if (a.athleteEmail) emails.add(a.athleteEmail);
    }

    // 1) Athletes carrying one of these emails as their guardian email.
    type AthleteRow = {
      id: string;
      first_name: string;
      last_name: string;
      guardian_email: string | null;
      parent_id: string | null;
      user_id: string | null;
    };
    const byGuardianEmail: AthleteRow[] = [];
    if (emails.size > 0) {
      const res = await supabaseAdmin
        .from("athletes")
        .select("id, first_name, last_name, guardian_email, parent_id, user_id")
        .in("guardian_email", [...emails]);
      byGuardianEmail.push(...((res.data ?? []) as AthleteRow[]));
    }

    // 2) Accounts (parent or athlete) whose sign-in email matches.
    const userIdByEmail = new Map<string, string>();
    if (emails.size > 0) {
      for (let page = 1; page <= 5; page += 1) {
        const list = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
        const users = list.data?.users ?? [];
        for (const u of users) {
          const e = u.email?.toLowerCase();
          if (e && emails.has(e)) userIdByEmail.set(e, u.id);
        }
        if (users.length < 1000) break;
      }
    }

    // Every athlete an email can legitimately point at — scoped per email, so one
    // row's email can never surface another row's athletes.
    const athleteIdsByEmail = new Map<string, Set<string>>();
    const addForEmail = (email: string, athleteId: string) => {
      const set = athleteIdsByEmail.get(email) ?? new Set<string>();
      set.add(athleteId);
      athleteIdsByEmail.set(email, set);
    };
    for (const a of byGuardianEmail) {
      const e = a.guardian_email?.toLowerCase();
      if (e) addForEmail(e, a.id);
    }

    const athletesOfMatchedAccounts: AthleteRow[] = [];
    if (userIdByEmail.size > 0) {
      const userIds = [...userIdByEmail.values()];
      const [parents, selfAthletes] = await Promise.all([
        supabaseAdmin.from("parent_profiles").select("id, user_id").in("user_id", userIds),
        supabaseAdmin
          .from("athletes")
          .select("id, first_name, last_name, guardian_email, parent_id, user_id")
          .in("user_id", userIds),
      ]);
      athletesOfMatchedAccounts.push(...((selfAthletes.data ?? []) as AthleteRow[]));
      const parentRows = (parents.data ?? []) as { id: string; user_id: string }[];
      const parentIds = parentRows.map((p) => p.id);
      const kidRows: AthleteRow[] = [];
      if (parentIds.length > 0) {
        const kids = await supabaseAdmin
          .from("athletes")
          .select("id, first_name, last_name, guardian_email, parent_id, user_id")
          .in("parent_id", parentIds);
        kidRows.push(...((kids.data ?? []) as AthleteRow[]));
        athletesOfMatchedAccounts.push(...kidRows);
      }

      for (const [email, userId] of userIdByEmail.entries()) {
        for (const a of selfAthletes.data ?? []) {
          if ((a as AthleteRow).user_id === userId) addForEmail(email, (a as AthleteRow).id);
        }
        const parentIdsForUser = parentRows.filter((p) => p.user_id === userId).map((p) => p.id);
        for (const a of kidRows) {
          if (a.parent_id && parentIdsForUser.includes(a.parent_id)) addForEmail(email, a.id);
        }
      }
    }

    // 3) Name matches (exact, case-insensitive) — the coach already typed the name.
    const nameMatches: AthleteRow[] = [];
    {
      const lastNames = [...new Set(data.athletes.map((a) => a.lastName))];
      if (lastNames.length > 0) {
        const res = await supabaseAdmin
          .from("athletes")
          .select("id, first_name, last_name, guardian_email, parent_id, user_id")
          .in("last_name", lastNames)
          .limit(500);
        nameMatches.push(...((res.data ?? []) as AthleteRow[]));
      }
    }

    const emailPool = [...byGuardianEmail, ...athletesOfMatchedAccounts];
    const emailById = new Map<string, AthleteRow>();
    for (const a of emailPool) emailById.set(a.id, a);

    // Extra identifying detail so the coach can actually confirm a match:
    // the guardian's name and the athlete's existing sport / level.
    const possibleIds = [...new Set([...emailById.keys(), ...nameMatches.map((a) => a.id)])];
    const guardianNameByAthleteId = new Map<string, string>();
    const goalByAthleteId = new Map<string, { sport: string | null; levelKey: string | null }>();
    if (possibleIds.length > 0) {
      const parentIds = [
        ...new Set(
          [...emailById.values(), ...nameMatches].map((a) => a.parent_id).filter(Boolean),
        ),
      ] as string[];
      const [parentRes, goalRes] = await Promise.all([
        parentIds.length > 0
          ? supabaseAdmin
              .from("parent_profiles")
              .select("id, first_name, last_name")
              .in("id", parentIds)
          : Promise.resolve({ data: [] as { id: string; first_name: string; last_name: string }[] }),
        supabaseAdmin
          .from("athlete_goals")
          .select("athlete_id, sport, current_level_key")
          .in("athlete_id", possibleIds),
      ]);
      const nameByParentId = new Map<string, string>();
      for (const p of (parentRes.data ?? []) as {
        id: string;
        first_name: string | null;
        last_name: string | null;
      }[]) {
        const n = `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();
        if (n) nameByParentId.set(p.id, n);
      }
      for (const a of [...emailById.values(), ...nameMatches]) {
        const n = a.parent_id ? nameByParentId.get(a.parent_id) : undefined;
        if (n) guardianNameByAthleteId.set(a.id, n);
      }
      for (const g of (goalRes.data ?? []) as {
        athlete_id: string;
        sport: string | null;
        current_level_key: string | null;
      }[]) {
        if (!goalByAthleteId.has(g.athlete_id)) {
          goalByAthleteId.set(g.athlete_id, { sport: g.sport, levelKey: g.current_level_key });
        }
      }
    }
    const detailsFor = (id: string, connected: boolean) => ({
      guardianName: connected
        ? (guardianNameByAthleteId.get(id) ?? null)
        : redactFullName(guardianNameByAthleteId.get(id) ?? null),
      sport: goalByAthleteId.get(id)?.sport ?? null,
      levelKey: goalByAthleteId.get(id)?.levelKey ?? null,
    });

    // Coaches only see the full name of someone they're already connected to.
    const displayName = (
      first: string | null,
      last: string | null,
      connected: boolean,
    ) => (connected ? `${first ?? ""} ${last ?? ""}`.trim() : firstNameLastInitial(first, last));

    const norm = (s: string) => s.trim().toLowerCase();

    const results: MatchResult[] = data.athletes.map((input) => {
      const candidates = new Map<string, MatchCandidate>();

      const rowEmails = [input.guardianEmail, input.athleteEmail]
        .filter(Boolean)
        .map((e) => e!.toLowerCase());
      for (const a of emailById.values()) {
        const guardianHit =
          a.guardian_email != null && rowEmails.includes(a.guardian_email.toLowerCase());
        // Scoped per email: this athlete must belong to one of THIS row's emails.
        const accountHit = rowEmails.some((e) => athleteIdsByEmail.get(e)?.has(a.id));
        if (!guardianHit && !accountHit) continue;
        const connected = rosterIds.has(a.id);
        candidates.set(a.id, {
          athleteId: a.id,
          name: displayName(a.first_name, a.last_name, connected),
          maskedEmail: maskEmail(a.guardian_email),
          reason: "email",
          nameAlsoMatches:
            norm(a.first_name) === norm(input.firstName) &&
            norm(a.last_name) === norm(input.lastName),
          onRoster: connected,
          redacted: !connected,
          ...detailsFor(a.id, connected),
        });

      }

      for (const a of nameMatches) {
        if (candidates.has(a.id)) continue;
        if (
          norm(a.first_name) === norm(input.firstName) &&
          norm(a.last_name) === norm(input.lastName)
        ) {
          const connected = rosterIds.has(a.id);
          candidates.set(a.id, {
            athleteId: a.id,
            name: displayName(a.first_name, a.last_name, connected),
            maskedEmail: maskEmail(a.guardian_email),
            reason: "name",
            nameAlsoMatches: true,
            onRoster: connected,
            redacted: !connected,
            ...detailsFor(a.id, connected),
          });

        }
      }

      const list = [...candidates.values()].sort((a, b) => {
        if (a.onRoster !== b.onRoster) return a.onRoster ? -1 : 1;
        if (a.reason !== b.reason) return a.reason === "email" ? -1 : 1;
        return 0;
      });

      // Name + email both line up on one athlete: confirmed, hide the alternatives.
      const confirmed = list.find((c) => c.reason === "email" && c.nameAlsoMatches);
      if (confirmed) {
        return {
          key: input.key,
          status: "exact",
          suggestedAthleteId: confirmed.athleteId,
          candidates: [confirmed],
        };
      }

      // Only auto-suggest a name-only match when it is the single hit; email
      // matches (and anyone already on this coach's roster) always win.
      const strong = list.find((c) => c.onRoster) ?? list.find((c) => c.reason === "email");
      if (strong) {
        return {
          key: input.key,
          status: "exact",
          suggestedAthleteId: strong.athleteId,
          candidates: list,
        };
      }
      if (list.length > 0) {
        return {
          key: input.key,
          status: "possible",
          suggestedAthleteId: null,
          candidates: list,
        };
      }
      return { key: input.key, status: "new", suggestedAthleteId: null, candidates: [] };
    });

    return { results };
  });

// ---------- commit ----------

const slotSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(1).max(1440),
  frequency: z.enum(["weekly", "biweekly", "twice_monthly", "monthly"]),
});

export const commitScheduleImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        groups: z
          .array(
            z.object({
              key: z.string().min(1).max(300),
              firstName: z.string().trim().min(1).max(80),
              lastName: z.string().trim().min(1).max(80),
              guardianEmail: z.string().trim().toLowerCase().max(255).default(""),
              athleteEmail: z.string().trim().toLowerCase().max(255).default(""),
              sport: z.string().trim().max(40).default(""),
              matchedAthleteId: z.string().uuid().nullable().default(null),
              slots: z.array(slotSchema).min(1).max(20),
            }),
          )
          .min(1)
          .max(100),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ outcomes: ImportOutcome[] }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { newGuardianToken, sendGuardianInvite } = await import("./guardian.server");

    const coach = await supabaseAdmin
      .from("coach_profiles")
      .select("id, first_name, last_name")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!coach.data) throw new Error("Coach profile not found");
    const coachId = coach.data.id;
    const coachName = `${coach.data.first_name} ${coach.data.last_name}`.trim();

    const outcomes: ImportOutcome[] = [];

    for (const g of data.groups) {
      const name = `${g.firstName} ${g.lastName}`.trim();
      // Guardian email wins; an athlete-only email still gets the claim link so
      // the athlete can set their account up.
      const inviteEmail = g.guardianEmail || g.athleteEmail || null;

      for (const s of g.slots) {
        if (s.endMinute <= s.startMinute) {
          outcomes.push({
            key: g.key,
            name,
            status: "failed",
            slotsAdded: 0,
            invited: null,
            message: "Lesson ends before it starts.",
          });
        }
      }
      if (outcomes.some((o) => o.key === g.key && o.status === "failed")) continue;

      let athleteId = g.matchedAthleteId;
      let created = false;
      let invited: string | null = null;

      try {
        if (!athleteId) {
          const token = inviteEmail ? newGuardianToken() : null;
          const ins = await supabaseAdmin
            .from("athletes")
            .insert({
              first_name: g.firstName,
              last_name: g.lastName,
              parent_id: null,
              self_managed: false,
              motivation: "",
              guardian_email: inviteEmail,
              guardian_claim_token: token,
              guardian_invited_at: inviteEmail ? new Date().toISOString() : null,
              added_by_coach_id: coachId,
            })
            .select("id")
            .single();
          if (ins.error) throw new Error(ins.error.message);
          athleteId = ins.data.id;
          created = true;

          const link = await supabaseAdmin.from("coach_athletes").insert({
            coach_id: coachId,
            athlete_id: athleteId,
            coach_ack_at: new Date().toISOString(),
          });
          if (link.error) {
            await supabaseAdmin.from("athletes").delete().eq("id", athleteId);
            throw new Error(link.error.message);
          }

          if (inviteEmail && token) {
            await sendGuardianInvite({
              to: inviteEmail,
              athleteName: name,
              coachName,
              token,
            });
            invited = inviteEmail;
          }
        } else {
          const existing = await supabaseAdmin
            .from("coach_athletes")
            .select("id")
            .eq("coach_id", coachId)
            .eq("athlete_id", athleteId)
            .maybeSingle();
          if (!existing.data) {
            const link = await supabaseAdmin.from("coach_athletes").insert({
              coach_id: coachId,
              athlete_id: athleteId,
              coach_ack_at: new Date().toISOString(),
            });
            if (link.error) throw new Error(link.error.message);
          }
        }

        if (g.sport) {
          const hasSport = await supabaseAdmin
            .from("coach_athlete_sports")
            .select("id")
            .eq("coach_id", coachId)
            .eq("athlete_id", athleteId)
            .eq("sport", g.sport)
            .maybeSingle();
          if (!hasSport.data) {
            await supabaseAdmin
              .from("coach_athlete_sports")
              .insert({ coach_id: coachId, athlete_id: athleteId, sport: g.sport });
          }
        }

        const existingSlots = await supabaseAdmin
          .from("athlete_lesson_slots")
          .select("day_of_week, start_minute")
          .eq("coach_id", coachId)
          .eq("athlete_id", athleteId);
        const seen = new Set(
          (existingSlots.data ?? []).map((s) => `${s.day_of_week}:${s.start_minute}`),
        );

        const toInsert = g.slots
          .filter((s) => !seen.has(`${s.dayOfWeek}:${s.startMinute}`))
          .map((s) => ({
            athlete_id: athleteId as string,
            coach_id: coachId,
            day_of_week: s.dayOfWeek,
            start_minute: s.startMinute,
            end_minute: s.endMinute,
            frequency: s.frequency,
            weeks_of_month: s.frequency === "twice_monthly" || s.frequency === "monthly" ? [1] : [],
            starts_on: null,
          }));

        if (toInsert.length > 0) {
          const slotIns = await supabaseAdmin.from("athlete_lesson_slots").insert(toInsert);
          if (slotIns.error) throw new Error(slotIns.error.message);
        }

        outcomes.push({
          key: g.key,
          name,
          status: created ? "created" : "linked",
          slotsAdded: toInsert.length,
          invited,
          message:
            toInsert.length < g.slots.length
              ? `${g.slots.length - toInsert.length} lesson(s) already existed`
              : null,
        });
      } catch (err) {
        console.error("[schedule-import] group failed", err);
        outcomes.push({
          key: g.key,
          name,
          status: "failed",
          slotsAdded: 0,
          invited: null,
          message: err instanceof Error ? err.message : "Could not import this athlete.",
        });
      }
    }

    return { outcomes };
  });
