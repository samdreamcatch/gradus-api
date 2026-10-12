/**
 * End-of-competition recap. A signed-in parent or athlete who opens a live
 * board at a competition is asked, once it finishes, how it went. The answer
 * is stored on the athlete's record and sent to their coach as a message.
 *
 * Single source of truth for `competition-recap.functions.ts` and the
 * `/api/v1` "recaps" routes (PRD §7.10, Appendix A). Extracted without
 * behavior changes; the web wrapper turns `ApiError`s back into their
 * original plain messages via `rethrowPlain`.
 */
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { ApiError } from "./api/errors";
import { inBackground } from "./background";
import { dbError } from "./db-error";
import { coachUserId, notifyUsers, roomMessagePush, withoutBlocked } from "./push-notify.server";
import {
  athletesInBoardSport as athletesInBoardSportFor,
  loadBoardViewer,
  type AdminDb,
  type BoardViewer,
} from "./competitions.server";

/** How long we keep asking after a competition wraps. */
export const ASK_WINDOW_DAYS = 7;

const wrongRole = (message: string) => new ApiError({ code: "wrong_role", status: 403, message });
const forbidden = (message: string) => new ApiError({ code: "forbidden", status: 403, message });
const notFound = (message: string) => new ApiError({ code: "not_found", status: 404, message });

export interface PendingRecapDTO {
  competitionId: string;
  competitionName: string;
  datesLabel: string;
  athleteId: string | null;
  /** Only populated when we can't tell which athlete this is about. */
  athleteChoices: { id: string; name: string }[];
}

export interface CompetitionRecapDTO {
  id: string;
  competitionId: string;
  competitionName: string;
  body: string;
  authorRole: "parent" | "athlete";
  authorName: string;
  createdAt: string;
}

type Viewer = BoardViewer;

/** Athletes the viewer may write about, narrowed to the board's sport. */
async function athletesInBoardSport(
  admin: AdminDb,
  viewer: NonNullable<Viewer>,
): Promise<{ id: string; name: string }[]> {
  return athletesInBoardSportFor(admin, viewer);
}

/** The viewer must be able to write about this athlete before anything lands. */
async function assertCanWriteAthlete(
  admin: AdminDb,
  viewer: NonNullable<Viewer>,
  athleteId: string,
) {
  const allowed = await athletesInBoardSport(admin, viewer);
  if (!allowed.some((a) => a.id === athleteId)) {
    // Fall back to the full list — a parent may follow across sports.
    if (viewer.role === "athlete") {
      if (viewer.athleteId !== athleteId) throw forbidden("That athlete isn't yours");
      return;
    }
    const [owned, guarded] = await Promise.all([
      admin
        .from("athletes")
        .select("id")
        .eq("parent_id", viewer.parentId)
        .eq("id", athleteId)
        .maybeSingle(),
      admin
        .from("athlete_guardians")
        .select("athlete_id")
        .eq("parent_id", viewer.parentId)
        .eq("athlete_id", athleteId)
        .maybeSingle(),
    ]);
    if (owned.error) dbError(owned.error);
    if (guarded.error) dbError(guarded.error);
    if (!owned.data && !guarded.data) throw forbidden("That athlete isn't yours");
  }
}

/* -------------------------------------------------------- pending prompt */

/** `GET /recaps/pending` (Appendix A). */
export async function getPendingCompetitionRecap(
  admin: AdminDb,
  userId: string,
): Promise<PendingRecapDTO | null> {
  const viewer = await loadBoardViewer(admin, userId);
  if (!viewer) return null;

  const rows = await admin
    .from("competition_attendance")
    .select("competition_id, athlete_id, first_seen_at")
    .eq("user_id", userId)
    .is("dismissed_at", null)
    .is("recap_done_at", null)
    .order("first_seen_at", { ascending: false })
    .limit(10);
  if (rows.error) dbError(rows.error);
  if (!rows.data?.length) return null;

  const comps = await admin
    .from("competitions")
    .select("id, name, dates_label, ends_on")
    .in(
      "id",
      rows.data.map((r: any) => r.competition_id),
    );
  if (comps.error) dbError(comps.error);

  const today = new Date();
  const windowStart = new Date(today.getTime() - ASK_WINDOW_DAYS * 86_400_000);

  for (const row of rows.data as any[]) {
    const comp = (comps.data ?? []).find((c: any) => c.id === row.competition_id);
    if (!comp?.ends_on) continue;
    const ended = new Date(`${comp.ends_on}T23:59:59Z`);
    if (ended > today) continue; // still running
    if (ended < windowStart) continue; // too long ago to ask

    const candidates = await athletesInBoardSport(admin, viewer);
    const athleteId =
      (row.athlete_id as string | null) ?? (candidates.length === 1 ? candidates[0].id : null);
    return {
      competitionId: comp.id as string,
      competitionName: (comp.name as string) || "the competition",
      datesLabel: (comp.dates_label as string) ?? "",
      athleteId,
      athleteChoices: athleteId ? [] : candidates,
    };
  }
  return null;
}

export const dismissCompetitionRecapInput = z.object({ competitionId: z.string().uuid() });

export async function dismissCompetitionRecap(
  admin: AdminDb,
  userId: string,
  input: z.infer<typeof dismissCompetitionRecapInput>,
): Promise<{ ok: true }> {
  const { error } = await admin
    .from("competition_attendance")
    .update({ dismissed_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("competition_id", input.competitionId);
  if (error) dbError(error);
  return { ok: true };
}

/* ------------------------------------------------------- coach recipients */

export const recapCoachesInput = z.object({ athleteId: z.string().uuid() });

/** `GET /recaps/coaches?athleteId=` (Appendix A). The rostered coaches a recap can be sent to for this athlete. */
export async function getRecapCoaches(
  admin: AdminDb,
  userId: string,
  input: z.infer<typeof recapCoachesInput>,
): Promise<{ id: string; name: string }[]> {
  const viewer = await loadBoardViewer(admin, userId);
  if (!viewer) return [];
  await assertCanWriteAthlete(admin, viewer, input.athleteId);

  const links = await admin
    .from("coach_athletes")
    .select("coach_id")
    .eq("athlete_id", input.athleteId);
  if (links.error) dbError(links.error);
  const coachIds = [...new Set((links.data ?? []).map((r: any) => r.coach_id as string))];
  if (coachIds.length === 0) return [];

  const coaches = await admin
    .from("coach_profiles")
    .select("id, first_name, last_name")
    .in("id", coachIds);
  if (coaches.error) dbError(coaches.error);
  return (coaches.data ?? []).map((c: any) => ({
    id: c.id as string,
    name: `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "Coach",
  }));
}

/* ------------------------------------------------------------- the recap */

export const submitCompetitionRecapInput = z.object({
  competitionId: z.string().uuid(),
  athleteId: z.string().uuid(),
  body: z.string().trim().min(1).max(2000),
  /** Omitted means every rostered coach. */
  coachIds: z.array(z.string().uuid()).optional(),
});

/** `POST /recaps` `[idem]` (Appendix A). Posts into the athlete's coach message threads. */
export async function submitCompetitionRecap(
  admin: AdminDb,
  userId: string,
  input: z.infer<typeof submitCompetitionRecapInput>,
): Promise<{ ok: true }> {
  const viewer = await loadBoardViewer(admin, userId);
  if (!viewer) throw wrongRole("Only parents and athletes can write a recap");
  await assertCanWriteAthlete(admin, viewer, input.athleteId);

  const comp = await admin
    .from("competitions")
    .select("id, name")
    .eq("id", input.competitionId)
    .maybeSingle();
  if (comp.error) dbError(comp.error);
  if (!comp.data) throw notFound("Competition not found");

  const { error } = await admin.from("competition_recaps").upsert(
    {
      competition_id: input.competitionId,
      athlete_id: input.athleteId,
      author_user_id: userId,
      author_role: viewer.role,
      body: input.body,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "competition_id,athlete_id,author_user_id" },
  );
  if (error) dbError(error);

  await admin
    .from("competition_attendance")
    .update({ recap_done_at: new Date().toISOString(), athlete_id: input.athleteId })
    .eq("user_id", userId)
    .eq("competition_id", input.competitionId);

  await messageCoaches(
    admin,
    input.athleteId,
    userId,
    viewer.role,
    `Competition recap — ${comp.data.name || "competition"}\n\n${input.body}`,
    input.coachIds,
  );

  return { ok: true };
}

/** Post the recap into the selected coach conversations (default: all). */
async function messageCoaches(
  admin: AdminDb,
  athleteId: string,
  senderUserId: string,
  senderRole: "parent" | "athlete",
  body: string,
  onlyCoachIds?: string[],
) {
  const links = await admin.from("coach_athletes").select("coach_id").eq("athlete_id", athleteId);
  if (links.error) dbError(links.error);
  let coachIds: string[] = [
    ...new Set<string>((links.data ?? []).map((r: any) => r.coach_id as string)),
  ];

  if (onlyCoachIds?.length) coachIds = coachIds.filter((id) => onlyCoachIds.includes(id));
  if (coachIds.length === 0) return;

  const rooms = await admin
    .from("message_rooms")
    .select("id, coach_id")
    .eq("athlete_id", athleteId)
    .in("coach_id", coachIds);
  if (rooms.error) dbError(rooms.error);

  const byCoach = new Map<string, string>();
  for (const r of rooms.data ?? []) byCoach.set(r.coach_id as string, r.id as string);

  for (const coachId of coachIds) {
    let roomId = byCoach.get(coachId);
    if (!roomId) {
      const created = await admin
        .from("message_rooms")
        .insert({ coach_id: coachId, athlete_id: athleteId })
        .select("id")
        .single();
      if (created.error) dbError(created.error);
      roomId = created.data.id as string;
    }
    const sent = await admin.from("messages").insert({
      room_id: roomId,
      sender_user_id: senderUserId,
      sender_role: senderRole,
      kind: "text",
      body,
    });
    if (sent.error) dbError(sent.error);
    await admin
      .from("message_rooms")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", roomId);

    // These inserts bypass `sendMessage`, so push the coach here (PRD §6.6).
    const pushRoomId = roomId;
    await inBackground("push:recap-message", async () => {
      const typed = admin as unknown as SupabaseClient<Database>;
      const coachUser = await coachUserId(typed, coachId);
      if (!coachUser) return;
      const recipients = await withoutBlocked(typed, senderUserId, [coachUser]);
      if (recipients.length === 0) return;
      // A real message in the coach's room with the athlete, so the coach can reply from it.
      await notifyUsers(typed, recipients, roomMessagePush(pushRoomId, "Competition recap", body));
    });
  }
}

/* -------------------------------------------------------------- reading */

export const athleteRecapsInput = z.object({ athleteId: z.string().uuid() });

/** `GET /athletes/{id}/recaps` (Appendix A). The athlete's circle only: rostered coach, guardian, or the athlete. */
export async function getAthleteCompetitionRecaps(
  admin: AdminDb,
  userId: string,
  input: z.infer<typeof athleteRecapsInput>,
): Promise<CompetitionRecapDTO[]> {
  const [coach, parentOwned, self] = await Promise.all([
    admin.from("coach_profiles").select("id").eq("user_id", userId).maybeSingle(),
    admin
      .from("parent_profiles")
      .select("id, athletes:athletes!athletes_parent_id_fkey(id)")
      .eq("user_id", userId)
      .maybeSingle(),
    admin
      .from("athletes")
      .select("id")
      .eq("id", input.athleteId)
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  if (coach.error) dbError(coach.error);
  if (parentOwned.error) dbError(parentOwned.error);
  if (self.error) dbError(self.error);

  let allowed = !!self.data;
  if (!allowed && coach.data) {
    const link = await admin
      .from("coach_athletes")
      .select("athlete_id")
      .eq("coach_id", coach.data.id)
      .eq("athlete_id", input.athleteId)
      .maybeSingle();
    if (link.error) dbError(link.error);
    allowed = !!link.data;
  }
  if (!allowed && parentOwned.data) {
    const parentId = parentOwned.data.id as string;
    const owned = ((parentOwned.data.athletes ?? []) as any[]).some(
      (a) => a.id === input.athleteId,
    );
    if (owned) {
      allowed = true;
    } else {
      // A co-guardian only keeps read access while the primary parent's
      // Team plan is active — same rule as every other parent-facing read.
      const { resolveGuardianAthleteAccess } = await import("./team.server");
      const access = await resolveGuardianAthleteAccess(admin as any, parentId, input.athleteId);
      allowed = !!access && !access.locked;
    }
  }
  if (!allowed) return [];

  const rows = await admin
    .from("competition_recaps")
    .select("id, competition_id, body, author_role, author_user_id, created_at")
    .eq("athlete_id", input.athleteId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (rows.error) dbError(rows.error);
  if (!rows.data?.length) return [];

  const [comps, parents, athletes] = await Promise.all([
    admin
      .from("competitions")
      .select("id, name")
      .in("id", [...new Set(rows.data.map((r: any) => r.competition_id))]),
    admin
      .from("parent_profiles")
      .select("user_id, first_name, last_name")
      .in("user_id", [...new Set(rows.data.map((r: any) => r.author_user_id))]),
    admin
      .from("athletes")
      .select("user_id, first_name, last_name")
      .in("user_id", [...new Set(rows.data.map((r: any) => r.author_user_id))]),
  ]);
  if (comps.error) dbError(comps.error);

  const nameFor = (uid: string, role: string) => {
    const list = role === "parent" ? (parents.data ?? []) : (athletes.data ?? []);
    const hit = list.find((p: any) => p.user_id === uid);
    return hit
      ? `${hit.first_name ?? ""} ${hit.last_name ?? ""}`.trim()
      : role === "parent"
        ? "Parent"
        : "Athlete";
  };

  return (rows.data as any[]).map((r) => ({
    id: r.id as string,
    competitionId: r.competition_id as string,
    competitionName:
      ((comps.data ?? []).find((c: any) => c.id === r.competition_id)?.name as string) ?? "",
    body: r.body as string,
    authorRole: r.author_role as "parent" | "athlete",
    authorName: nameFor(r.author_user_id as string, r.author_role as string),
    createdAt: r.created_at as string,
  }));
}
