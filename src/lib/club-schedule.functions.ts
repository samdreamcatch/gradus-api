import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dbError } from "./db-error";
import { clubScheduleErrors, type ClubScheduleRow } from "./club-schedule";
import { buildClubLessons } from "./club-lesson-calendar";

type ImportRecord = { id: string; file_name: string; status: string; counts: Json; created_at: string; organization_id: string; uploaded_by: string };
type Table<R> = { Row: R; Insert: never; Update: never; Relationships: [] };
type ScheduleDatabase = Omit<Database, "public"> & { public: Omit<Database["public"], "Tables" | "Functions"> & {
  Tables: Database["public"]["Tables"] & {
    org_seats: Table<{ organization_id: string; coach_id: string | null; seat_no: number }>;
    org_schedule_imports: Table<ImportRecord>;
    org_schedule_import_rows: Table<{ import_id: string; organization_id: string; row_no: number; review_row: Json }>;
  };
  Functions: Database["public"]["Functions"] & { club_save_schedule_review: { Args: { p_org: string; p_user: string; p_file: string; p_rows: Json; p_ready: boolean }; Returns: string } };
} };
const orgInput = z.object({ organizationId: z.string().uuid() });
const reviewRow = z.object({
  id: z.string().min(1).max(100), firstName: z.string().max(100), lastName: z.string().max(100),
  coachName: z.string().max(200), coachId: z.string().uuid().nullable(), age: z.number().int().min(0).max(120).nullable(),
  dayOfWeek: z.number().int().min(0).max(6).nullable(), startMinute: z.number().int().min(0).max(1439).nullable(),
  lengthMinutes: z.number().int().min(1).max(1440).nullable(), frequency: z.enum(["weekly", "biweekly", "twice_monthly", "monthly"]),
  guardianEmail: z.string().max(254), athleteEmail: z.string().max(254), sport: z.string().max(100),
});

async function authorized(supabase: SupabaseClient<Database>, userId: string, organizationId: string) {
  const permission = await supabase.rpc("has_org_admin", { _user_id: userId, _org_id: organizationId });
  if (permission.error) dbError(permission.error);
  if (!permission.data) throw new Error("Not authorized for this club.");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return { base: supabaseAdmin, draft: supabaseAdmin as unknown as SupabaseClient<ScheduleDatabase> };
}

export const getClubScheduleSeats = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => orgInput.parse(input)).handler(async ({ data, context }) => {
    const { draft } = await authorized(context.supabase, context.userId, data.organizationId);
    const seats = await draft.from("org_seats").select("coach_id,seat_no").eq("organization_id", data.organizationId).not("coach_id", "is", null);
    if (seats.error) dbError(seats.error);
    return seats.data ?? [];
  });

export const getClubScheduleHistory = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => orgInput.parse(input)).handler(async ({ data, context }) => {
    const { draft } = await authorized(context.supabase, context.userId, data.organizationId);
    const result = await draft.from("org_schedule_imports").select("id,file_name,status,counts,created_at")
      .eq("organization_id", data.organizationId).order("created_at", { ascending: false }).limit(100);
    if (result.error) dbError(result.error);
    return result.data ?? [];
  });

export const getClubScheduleReview = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => orgInput.extend({ importId: z.string().uuid() }).parse(input)).handler(async ({ data, context }) => {
    const { draft } = await authorized(context.supabase, context.userId, data.organizationId);
    const result = await draft.from("org_schedule_import_rows").select("review_row")
      .eq("organization_id", data.organizationId).eq("import_id", data.importId).order("row_no");
    if (result.error) dbError(result.error);
    return z.array(reviewRow).parse((result.data ?? []).map((r) => r.review_row));
  });

export const saveClubScheduleReview = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => orgInput.extend({ fileName: z.string().min(1).max(255), rows: z.array(reviewRow).min(1).max(500) }).parse(input))
  .handler(async ({ data, context }) => {
    const { base, draft } = await authorized(context.supabase, context.userId, data.organizationId);
    const sports = await base.from("organization_sports").select("sport").eq("organization_id", data.organizationId);
    if (sports.error) dbError(sports.error);
    const allowedSports = new Set((sports.data ?? []).map((s) => s.sport));
    if (data.rows.some((r) => r.sport && !allowedSports.has(r.sport))) throw new Error("Choose a sport purchased by this club.");
    const ready = Object.values(clubScheduleErrors(data.rows as ClubScheduleRow[])).every((e) => e.length === 0);
    const result = await draft.rpc("club_save_schedule_review", { p_org: data.organizationId, p_user: context.userId,
      p_file: data.fileName, p_rows: data.rows as unknown as Json, p_ready: ready });
    if (result.error) dbError(result.error);
    return { id: result.data, ready };
  });

// Operational club schedule only; family contacts must never enter Home/Coaching rollups.
export const getClubLessonCalendar = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => orgInput.parse(input)).handler(async ({ data, context }) => {
    const { base } = await authorized(context.supabase, context.userId, data.organizationId);
    const coaches = await base.from("coach_profiles").select("id,first_name,last_name").eq("organization_id", data.organizationId);
    if (coaches.error) dbError(coaches.error);
    const ids = (coaches.data ?? []).map((c) => c.id);
    if (!ids.length) return [];
    const links = await base.from("coach_athletes").select("coach_id,athlete_id").in("coach_id", ids);
    if (links.error) dbError(links.error);
    const athleteIds = [...new Set((links.data ?? []).map((l) => l.athlete_id))];
    if (!athleteIds.length) return [];
    const [slots, students, guardians] = await Promise.all([
      base.from("athlete_lesson_slots").select("id,athlete_id,coach_id,day_of_week,start_minute,end_minute,frequency,starts_on,weeks_of_month").in("coach_id", ids).in("athlete_id", athleteIds),
      base.from("athletes").select("id,first_name,last_name,parent_id,self_managed,user_id,account_state,guardian_first_name,guardian_last_name,guardian_email,guardian_invited_at,guardian_claimed_at,invite_recipient").in("id", athleteIds),
      base.from("athlete_guardians").select("athlete_id,parent_profiles(first_name,last_name)").in("athlete_id", athleteIds),
    ]);
    if (slots.error) dbError(slots.error);
    if (students.error) dbError(students.error);
    if (guardians.error) dbError(guardians.error);
    const parentIds = [...new Set((students.data ?? []).flatMap((s) => s.parent_id ? [s.parent_id] : []))];
    const parents = parentIds.length ? await base.from("parent_profiles").select("id,first_name,last_name").in("id", parentIds) : { data: [], error: null };
    if (parents.error) dbError(parents.error);
    return buildClubLessons({ slots: slots.data ?? [], students: students.data ?? [], coaches: coaches.data ?? [], links: links.data ?? [],
      guardians: [
        ...(guardians.data ?? []).map((g) => ({ athlete_id: g.athlete_id, name: [g.parent_profiles?.first_name, g.parent_profiles?.last_name].filter(Boolean).join(" ") })),
        ...(students.data ?? []).flatMap((s) => {
          const parent = parents.data?.find((p) => p.id === s.parent_id);
          return parent ? [{ athlete_id: s.id, name: [parent.first_name, parent.last_name].filter(Boolean).join(" ") }] : [];
        }),
      ],
    });
  });
/**
 * Sends (or re-sends) the existing family claim invite for club lessons. Only students linked to
 * one of this club's coaches, still unclaimed, active, and with an email on file are emailed;
 * everything else is reported back as skipped. The recorded time marks a queued email, not delivery.
 */
export const sendClubLessonInvites = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => orgInput.extend({ athleteIds: z.array(z.string().uuid()).min(1).max(200) }).parse(input))
  .handler(async ({ data, context }) => {
    const { base } = await authorized(context.supabase, context.userId, data.organizationId);
    const { newGuardianToken, sendGuardianInvite } = await import("./guardian.server");
    const coaches = await base.from("coach_profiles").select("id,first_name,last_name").eq("organization_id", data.organizationId);
    if (coaches.error) dbError(coaches.error);
    const coachById = new Map((coaches.data ?? []).map((c) => [c.id, [c.first_name, c.last_name].filter(Boolean).join(" ")]));
    if (!coachById.size) return { sent: 0, skipped: data.athleteIds.length };
    const ids = [...new Set(data.athleteIds)];
    const links = await base.from("coach_athletes").select("coach_id,athlete_id").in("coach_id", [...coachById.keys()]).in("athlete_id", ids);
    if (links.error) dbError(links.error);
    const coachFor = new Map((links.data ?? []).map((l) => [l.athlete_id, l.coach_id]));
    const students = await base.from("athletes")
      .select("id,first_name,last_name,parent_id,guardian_email,guardian_claim_token,guardian_claimed_at,invite_recipient,account_state")
      .in("id", ids.filter((id) => coachFor.has(id)));
    if (students.error) dbError(students.error);
    let sent = 0;
    for (const s of students.data ?? []) {
      const email = s.guardian_email?.trim();
      if (!email || s.parent_id || s.guardian_claimed_at || s.account_state !== "active") continue;
      const token = s.guardian_claim_token ?? newGuardianToken();
      const upd = await base.from("athletes").update({ guardian_claim_token: token, guardian_invited_at: new Date().toISOString() }).eq("id", s.id);
      if (upd.error) dbError(upd.error);
      await sendGuardianInvite({
        to: email, athleteName: [s.first_name, s.last_name].filter(Boolean).join(" "),
        coachName: coachById.get(coachFor.get(s.id)!) || null, token,
        recipient: s.invite_recipient === "athlete" ? "athlete" : "guardian",
      });
      sent += 1;
    }
    return { sent, skipped: ids.length - sent };
  });
