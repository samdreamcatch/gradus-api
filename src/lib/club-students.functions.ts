import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dbError } from "./db-error";
import {
  clubInviteStatus,
  nameKey,
  parseStartMinute,
  studentRowProblems,
  type ClubInviteStatus,
  type StudentRow,
} from "./club-add-students";

type SeatDb = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables"> & {
    Tables: Database["public"]["Tables"] & {
      org_seats: {
        Row: { organization_id: string; coach_id: string | null };
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
  };
};

const orgInput = z.object({ organizationId: z.string().uuid() });

async function authorized(supabase: SupabaseClient<Database>, userId: string, orgId: string) {
  const permission = await supabase.rpc("has_org_admin", { _user_id: userId, _org_id: orgId });
  if (permission.error) dbError(permission.error);
  if (!permission.data) throw new Error("Not authorized for this club.");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Club coaches, which of them hold a seat, and their current students. */
async function clubRoster(admin: Awaited<ReturnType<typeof authorized>>, orgId: string) {
  const [coaches, seats] = await Promise.all([
    admin
      .from("coach_profiles")
      .select("id,user_id,first_name,last_name")
      .eq("organization_id", orgId),
    (admin as unknown as SupabaseClient<SeatDb>)
      .from("org_seats")
      .select("coach_id")
      .eq("organization_id", orgId)
      .not("coach_id", "is", null),
  ]);
  if (coaches.error) dbError(coaches.error);
  if (seats.error) dbError(seats.error);
  const coachList = coaches.data ?? [];
  const ids = coachList.map((c) => c.id);
  const links = ids.length
    ? await admin.from("coach_athletes").select("coach_id,athlete_id").in("coach_id", ids)
    : { data: [], error: null };
  if (links.error) dbError(links.error);
  return {
    coaches: coachList,
    seated: new Set((seats.data ?? []).flatMap((s) => (s.coach_id ? [s.coach_id] : []))),
    links: links.data ?? [],
  };
}

export type ClubStudent = {
  athleteId: string;
  name: string;
  adult: boolean;
  guardian: string | null;
  email: string | null;
  coaches: string[];
  lessons: number;
  status: ClubInviteStatus;
};

export const getClubStudents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => orgInput.parse(input))
  .handler(async ({ data, context }): Promise<ClubStudent[]> => {
    const admin = await authorized(context.supabase, context.userId, data.organizationId);
    const { coaches, links } = await clubRoster(admin, data.organizationId);
    const athleteIds = [...new Set(links.map((l) => l.athlete_id))];
    if (!athleteIds.length) return [];
    const [students, slots, parents] = await Promise.all([
      admin
        .from("athletes")
        .select(
          "id,first_name,last_name,parent_id,user_id,self_managed,account_state,guardian_first_name,guardian_last_name,guardian_email,guardian_invited_at,guardian_claimed_at,invite_recipient",
        )
        .in("id", athleteIds),
      admin
        .from("athlete_lesson_slots")
        .select("athlete_id,coach_id")
        .in("athlete_id", athleteIds)
        .in("coach_id", coaches.map((c) => c.id)),
      admin
        .from("athlete_guardians")
        .select("athlete_id,parent_profiles(first_name,last_name)")
        .in("athlete_id", athleteIds),
    ]);
    if (students.error) dbError(students.error);
    if (slots.error) dbError(slots.error);
    if (parents.error) dbError(parents.error);
    const coachName = new Map(
      coaches.map((c) => [c.id, [c.first_name, c.last_name].filter(Boolean).join(" ")]),
    );
    return (students.data ?? [])
      .filter((s) => s.account_state === "active")
      .map((s) => {
        const linked = parents.data?.find((g) => g.athlete_id === s.id)?.parent_profiles;
        const guardian = linked
          ? [linked.first_name, linked.last_name].filter(Boolean).join(" ")
          : [s.guardian_first_name, s.guardian_last_name].filter(Boolean).join(" ") || null;
        const adult = s.self_managed || s.invite_recipient === "athlete";
        return {
          athleteId: s.id,
          name: [s.first_name, s.last_name].filter(Boolean).join(" "),
          adult,
          guardian: adult ? null : guardian,
          email: s.guardian_email,
          coaches: links
            .filter((l) => l.athlete_id === s.id)
            .map((l) => coachName.get(l.coach_id) ?? "")
            .filter(Boolean),
          lessons: (slots.data ?? []).filter((l) => l.athlete_id === s.id).length,
          status: clubInviteStatus({
            joined: Boolean(s.parent_id || s.user_id || s.guardian_claimed_at),
            email: s.guardian_email,
            invitedAt: s.guardian_invited_at,
          }),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  });

const rowInput = z.object({
  id: z.string().min(1).max(100),
  coachId: z.string().uuid().or(z.literal("")),
  firstName: z.string().trim().max(80),
  lastName: z.string().trim().max(80),
  adult: z.boolean(),
  guardianFirstName: z.string().trim().max(80),
  guardianLastName: z.string().trim().max(80),
  email: z.string().trim().toLowerCase().max(255),
  dayOfWeek: z.number().int().min(0).max(6).nullable(),
  start: z.string().max(5),
  lengthMinutes: z.number().int().min(1).max(1440),
  frequency: z.enum(["weekly", "biweekly", "twice_monthly", "monthly"]),
  currentLevelKey: z.string().max(64),
  seasonGoalKey: z.string().max(64),
  sport: z.string().max(40).optional(),
});

export type ClubAddStudentResult = {
  id: string;
  name: string;
  ok: boolean;
  message: string;
};

/**
 * Adds students to seated coaches' rosters for a club admin, using the same path coaches use
 * (roster limits, under-18 guardian rule, starting levels). Each row reports its own outcome;
 * a retry skips students already on that coach's roster, so nothing is added twice.
 */
export const clubAddStudents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    orgInput
      .extend({ rows: z.array(rowInput).min(1).max(100), sendInvites: z.boolean() })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<ClubAddStudentResult[]> => {
    const admin = await authorized(context.supabase, context.userId, data.organizationId);
    const { addAthleteWithGuardian } = await import("./coach-roster.server");
    const roster = await clubRoster(admin, data.organizationId);
    const athleteIds = [...new Set(roster.links.map((l) => l.athlete_id))];
    const names = athleteIds.length
      ? await admin.from("athletes").select("id,first_name,last_name").in("id", athleteIds)
      : { data: [], error: null };
    if (names.error) dbError(names.error);
    const existing = new Set(
      roster.links.flatMap((l) => {
        const a = names.data?.find((n) => n.id === l.athlete_id);
        return a ? [`${l.coach_id}|${nameKey(a.first_name, a.last_name)}`] : [];
      }),
    );
    const coachUser = new Map(roster.coaches.map((c) => [c.id, c.user_id]));
    const rows = data.rows as (StudentRow & { sport?: string })[];
    const results: ClubAddStudentResult[] = [];
    for (const row of rows) {
      const name = `${row.firstName} ${row.lastName}`.trim();
      const problems = studentRowProblems(row, {
        seated: roster.seated,
        existing,
        others: rows,
      });
      const userId = coachUser.get(row.coachId);
      if (problems.length || !userId) {
        results.push({ id: row.id, name, ok: false, message: problems[0] ?? "Coach not found" });
        continue;
      }
      try {
        const added = await addAthleteWithGuardian(
          { userId, admin },
          {
            firstName: row.firstName,
            lastName: row.lastName,
            guardianEmail: row.email,
            sport: row.sport || undefined,
            emailRecipient: row.adult ? "athlete" : "guardian",
            adultConfirmed: row.adult,
            guardianFirstName: row.adult ? "" : row.guardianFirstName,
            guardianLastName: row.adult ? "" : row.guardianLastName,
            currentLevelKey: row.sport ? row.currentLevelKey || undefined : undefined,
            seasonGoalKey: row.sport ? row.seasonGoalKey || undefined : undefined,
          },
          new Date(),
          { sendInvite: data.sendInvites },
        );
        existing.add(`${row.coachId}|${nameKey(row.firstName, row.lastName)}`);
        let lesson = "";
        const startMinute = parseStartMinute(row.start);
        if (row.dayOfWeek !== null && startMinute !== null) {
          const slot = await admin.from("athlete_lesson_slots").insert({
            athlete_id: added.athleteId,
            coach_id: row.coachId,
            day_of_week: row.dayOfWeek,
            start_minute: startMinute,
            end_minute: Math.min(1440, startMinute + row.lengthMinutes),
            frequency: row.frequency,
            weeks_of_month:
              row.frequency === "monthly" ? [1] : row.frequency === "twice_monthly" ? [1, 3] : [],
          });
          lesson = slot.error ? " · lesson not saved" : " · 1 lesson";
          if (slot.error) console.error("[club-students] slot insert failed", slot.error);
        }
        await admin.from("org_admin_actions").insert({
          organization_id: data.organizationId,
          actor_user_id: context.userId,
          action: "student_added",
          target_coach_id: row.coachId,
          payload: { athlete_id: added.athleteId, invite_sent: data.sendInvites },
        });
        results.push({
          id: row.id,
          name,
          ok: true,
          message: `Added${lesson} · ${data.sendInvites ? `invite sent to ${row.email}` : "invite not sent yet"}`,
        });
      } catch (err) {
        results.push({
          id: row.id,
          name,
          ok: false,
          message: err instanceof Error ? err.message : "Couldn't add this student",
        });
      }
    }
    return results;
  });
