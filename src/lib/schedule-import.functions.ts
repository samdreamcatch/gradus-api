import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { generateText } from "ai";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";

// ---------- types ----------




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
  status: "created" | "linked" | "failed" | "skipped";
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
              emailRecipient: z.enum(["guardian", "athlete"]).default("guardian"),
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
      .select("id, first_name, last_name, organization_id, subscription_tier")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!coach.data) throw new Error("Coach profile not found");
    const coachId = coach.data.id;
    const coachName = `${coach.data.first_name} ${coach.data.last_name}`.trim();

    const normName = (first: string, last: string) =>
      `${first} ${last}`.trim().toLowerCase().replace(/\s+/g, " ");

    // Athletes already on this coach's roster, keyed by normalized name, so a
    // repeat import attaches lessons instead of creating a duplicate.
    const rosterByName = new Map<string, string>();
    let rosterCount = 0;
    {
      const links = await supabaseAdmin
        .from("coach_athletes")
        .select("athlete_id")
        .eq("coach_id", coachId);
      const ids = (links.data ?? []).map((r) => r.athlete_id as string);
      rosterCount = ids.length;
      if (ids.length > 0) {
        const rows = await supabaseAdmin
          .from("athletes")
          .select("id, first_name, last_name")
          .in("id", ids);
        for (const a of rows.data ?? []) {
          const k = normName(a.first_name as string, a.last_name as string);
          if (!rosterByName.has(k)) rosterByName.set(k, a.id as string);
        }
      }
    }

    // Plan cap: the DB trigger is the backstop, but we stop short of it so the
    // coach gets "skipped — roster full" instead of a raw database error.
    const tier: "coach" | "coach_pro" | "club" = coach.data.organization_id
      ? "club"
      : coach.data.subscription_tier === "coach_pro"
        ? "coach_pro"
        : "coach";
    const athleteLimit = tier === "club" ? null : tier === "coach_pro" ? 50 : 5;
    let room = athleteLimit === null ? Number.POSITIVE_INFINITY : Math.max(0, athleteLimit - rosterCount);

    const outcomes: ImportOutcome[] = [];


    for (const g of data.groups) {
      const name = `${g.firstName} ${g.lastName}`.trim();
      // One address either way; the toggle only decides which voice the email uses.
      const inviteEmail =
        (g.emailRecipient === "athlete" ? g.athleteEmail || g.guardianEmail : g.guardianEmail || g.athleteEmail) ||
        null;

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

      // Resolve silently, server-side: only athletes already on THIS coach's
      // roster can be reused. Nothing about anyone else's account is consulted.
      let athleteId = rosterByName.get(normName(g.firstName, g.lastName)) ?? null;
      let created = false;
      let invited: string | null = null;

      if (!athleteId) {
        if (room <= 0) {
          outcomes.push({
            key: g.key,
            name,
            status: "skipped",
            slotsAdded: 0,
            invited: null,
            message:
              athleteLimit === null
                ? "Roster limit reached."
                : `Roster limit reached (${athleteLimit} athletes on your plan).`,
          });
          continue;
        }
        room -= 1;
      }


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
              invite_recipient: g.emailRecipient,
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
              recipient: g.emailRecipient,
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
