import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dbError } from "./db-error";

/**
 * End-of-competition recap. A signed-in parent or athlete who opens a live
 * board at a competition is asked, once it finishes, how it went. The answer
 * is stored on the athlete's record and sent to their coach as a message.
 */

/** Live boards are figure skating only, so attendance resolves in that sport. */
const BOARD_SPORT = "figure_skating";

/** How long we keep asking after a competition wraps. */
const ASK_WINDOW_DAYS = 7;

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

/**
 * The competition tables come from a staged migration, so they are not in the
 * generated types yet — reach them through the same loose accessor the board
 * and results functions use.
 */
async function getAdmin(): Promise<{ from: (t: string) => any }> {
  const m = await import("@/integrations/supabase/client.server");
  return m.supabaseAdmin as unknown as { from: (t: string) => any };
}

type Viewer =
  | { role: "parent"; parentId: string; name: string }
  | { role: "athlete"; athleteId: string; name: string }
  | null;

/** Which kind of account is asking, and under which profile row. */
async function loadViewer(userId: string): Promise<Viewer> {
  const admin = await getAdmin();
  const [parent, athlete] = await Promise.all([
    admin.from("parent_profiles").select("id, first_name, last_name").eq("user_id", userId).maybeSingle(),
    admin.from("athletes").select("id, first_name, last_name").eq("user_id", userId).maybeSingle(),
  ]);
  if (parent.error) dbError(parent.error);
  if (athlete.error) dbError(athlete.error);
  if (parent.data) {
    return {
      role: "parent",
      parentId: parent.data.id as string,
      name: `${parent.data.first_name ?? ""} ${parent.data.last_name ?? ""}`.trim() || "Parent",
    };
  }
  if (athlete.data) {
    return {
      role: "athlete",
      athleteId: athlete.data.id as string,
      name: `${athlete.data.first_name ?? ""} ${athlete.data.last_name ?? ""}`.trim() || "Athlete",
    };
  }
  return null;
}

/** Athletes the viewer may write about, narrowed to the board's sport. */
async function athletesInBoardSport(
  viewer: NonNullable<Viewer>,
): Promise<{ id: string; name: string }[]> {
  const admin = await getAdmin();

  let ids: string[] = [];
  if (viewer.role === "athlete") {
    ids = [viewer.athleteId];
  } else {
    const [owned, guarded] = await Promise.all([
      admin.from("athletes").select("id").eq("parent_id", viewer.parentId),
      admin.from("athlete_guardians").select("athlete_id").eq("parent_id", viewer.parentId),
    ]);
    if (owned.error) dbError(owned.error);
    if (guarded.error) dbError(guarded.error);
    ids = [
      ...new Set([
        ...(owned.data ?? []).map((r: any) => r.id as string),
        ...(guarded.data ?? []).map((r: any) => r.athlete_id as string),
      ]),
    ];
  }
  if (ids.length === 0) return [];

  const [rows, sports] = await Promise.all([
    admin.from("athletes").select("id, first_name, last_name").in("id", ids),
    admin.from("coach_athlete_sports").select("athlete_id").in("athlete_id", ids).eq("sport", BOARD_SPORT),
  ]);
  if (rows.error) dbError(rows.error);
  if (sports.error) dbError(sports.error);

  const inSport = new Set((sports.data ?? []).map((r: any) => r.athlete_id as string));
  // A single athlete with no sport rows yet is still the obvious subject.
  const keep = (rows.data ?? []).filter((r: any) => inSport.has(r.id) || inSport.size === 0);
  return keep.map((r: any) => ({
    id: r.id as string,
    name: `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim(),
  }));
}

/** The viewer must be able to write about this athlete before anything lands. */
async function assertCanWriteAthlete(viewer: NonNullable<Viewer>, athleteId: string) {
  const allowed = await athletesInBoardSport(viewer);
  if (!allowed.some((a) => a.id === athleteId)) {
    // Fall back to the full list — a parent may follow across sports.
    const admin = await getAdmin();
    if (viewer.role === "athlete") {
      if (viewer.athleteId !== athleteId) throw new Error("That athlete isn't yours");
      return;
    }
    const [owned, guarded] = await Promise.all([
      admin.from("athletes").select("id").eq("parent_id", viewer.parentId).eq("id", athleteId).maybeSingle(),
      admin
        .from("athlete_guardians")
        .select("athlete_id")
        .eq("parent_id", viewer.parentId)
        .eq("athlete_id", athleteId)
        .maybeSingle(),
    ]);
    if (owned.error) dbError(owned.error);
    if (guarded.error) dbError(guarded.error);
    if (!owned.data && !guarded.data) throw new Error("That athlete isn't yours");
  }
}

/* ----------------------------------------------------------- attendance */

export const recordCompetitionAttendance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ slug: z.string().min(1).max(120) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const viewer = await loadViewer(context.userId);

    const admin = await getAdmin();

    // A coach at the board isn't asked for a recap, but their attendance is
    // the trigger for the post-event "did any of your athletes compete?" flow.
    let isCoach = false;
    if (!viewer) {
      const coach = await admin
        .from("coach_profiles")
        .select("id")
        .eq("user_id", context.userId)
        .maybeSingle();
      if (coach.error) dbError(coach.error);
      if (!coach.data) return { ok: false as const };
      isCoach = true;
    }

    const comp = await admin
      .from("competitions")
      .select("id")
      .eq("slug", data.slug)
      .maybeSingle();
    if (comp.error) dbError(comp.error);
    if (!comp.data) return { ok: false as const };

    const existing = await admin
      .from("competition_attendance")
      .select("id, athlete_id")
      .eq("user_id", context.userId)
      .eq("competition_id", comp.data.id)
      .maybeSingle();
    if (existing.error) dbError(existing.error);
    if (existing.data) return { ok: true as const };

    const candidates = viewer ? await athletesInBoardSport(viewer) : [];
    const { error } = await admin.from("competition_attendance").insert({
      user_id: context.userId,
      competition_id: comp.data.id,
      athlete_id: candidates.length === 1 ? candidates[0].id : null,
      viewer_role: isCoach ? "coach" : viewer!.role,
    });
    if (error) dbError(error);
    return { ok: true as const };
  });


/* -------------------------------------------------------- pending prompt */

export const getPendingCompetitionRecap = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PendingRecapDTO | null> => {
    const viewer = await loadViewer(context.userId);
    if (!viewer) return null;

    const admin = await getAdmin();
    const rows = await admin
      .from("competition_attendance")
      .select("competition_id, athlete_id, first_seen_at")
      .eq("user_id", context.userId)
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

      const candidates = await athletesInBoardSport(viewer);
      const athleteId = (row.athlete_id as string | null) ?? (candidates.length === 1 ? candidates[0].id : null);
      return {
        competitionId: comp.id as string,
        competitionName: (comp.name as string) || "the competition",
        datesLabel: (comp.dates_label as string) ?? "",
        athleteId,
        athleteChoices: athleteId ? [] : candidates,
      };
    }
    return null;
  });

export const dismissCompetitionRecap = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ competitionId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const admin = await getAdmin();
    const { error } = await admin
      .from("competition_attendance")
      .update({ dismissed_at: new Date().toISOString() })
      .eq("user_id", context.userId)
      .eq("competition_id", data.competitionId);
    if (error) dbError(error);
    return { ok: true as const };
  });

/* ------------------------------------------------------- coach recipients */

/** The rostered coaches a recap can be sent to for this athlete. */
export const getRecapCoaches = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ athleteId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ id: string; name: string }[]> => {
    const viewer = await loadViewer(context.userId);
    if (!viewer) return [];
    await assertCanWriteAthlete(viewer, data.athleteId);

    const admin = await getAdmin();
    const links = await admin.from("coach_athletes").select("coach_id").eq("athlete_id", data.athleteId);
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
  });

/* ------------------------------------------------------------- the recap */



export const submitCompetitionRecap = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        competitionId: z.string().uuid(),
        athleteId: z.string().uuid(),
        body: z.string().trim().min(1).max(2000),
        /** Omitted means every rostered coach. */
        coachIds: z.array(z.string().uuid()).optional(),

      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const viewer = await loadViewer(context.userId);
    if (!viewer) throw new Error("Only parents and athletes can write a recap");
    await assertCanWriteAthlete(viewer, data.athleteId);

    const admin = await getAdmin();
    const comp = await admin
      .from("competitions")
      .select("id, name")
      .eq("id", data.competitionId)
      .maybeSingle();
    if (comp.error) dbError(comp.error);
    if (!comp.data) throw new Error("Competition not found");

    const { error } = await admin.from("competition_recaps").upsert(
      {
        competition_id: data.competitionId,
        athlete_id: data.athleteId,
        author_user_id: context.userId,
        author_role: viewer.role,
        body: data.body,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "competition_id,athlete_id,author_user_id" },
    );
    if (error) dbError(error);

    await admin
      .from("competition_attendance")
      .update({ recap_done_at: new Date().toISOString(), athlete_id: data.athleteId })
      .eq("user_id", context.userId)
      .eq("competition_id", data.competitionId);

    await messageCoaches(
      data.athleteId,
      context.userId,
      viewer.role,
      `Competition recap — ${comp.data.name || "competition"}\n\n${data.body}`,
      data.coachIds,
    );

    return { ok: true as const };
  });

/** Post the recap into the selected coach conversations (default: all). */
async function messageCoaches(
  athleteId: string,
  senderUserId: string,
  senderRole: "parent" | "athlete",
  body: string,
  onlyCoachIds?: string[],
) {
  const admin = await getAdmin();
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
  }
}

/* -------------------------------------------------------------- reading */

export const getAthleteCompetitionRecaps = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ athleteId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<CompetitionRecapDTO[]> => {
    const admin = await getAdmin();

    // The athlete's circle only: rostered coach, guardian, or the athlete.
    const [coach, parentOwned, guarded, self] = await Promise.all([
      admin.from("coach_profiles").select("id").eq("user_id", context.userId).maybeSingle(),
      admin
        .from("parent_profiles")
        .select("id, athletes:athletes!athletes_parent_id_fkey(id)")
        .eq("user_id", context.userId)
        .maybeSingle(),
      admin.from("athlete_guardians").select("athlete_id, parent_id").eq("athlete_id", data.athleteId),
      admin.from("athletes").select("id").eq("id", data.athleteId).eq("user_id", context.userId).maybeSingle(),
    ]);
    if (coach.error) dbError(coach.error);
    if (parentOwned.error) dbError(parentOwned.error);
    if (guarded.error) dbError(guarded.error);
    if (self.error) dbError(self.error);

    let allowed = !!self.data;
    if (!allowed && coach.data) {
      const link = await admin
        .from("coach_athletes")
        .select("athlete_id")
        .eq("coach_id", coach.data.id)
        .eq("athlete_id", data.athleteId)
        .maybeSingle();
      if (link.error) dbError(link.error);
      allowed = !!link.data;
    }
    if (!allowed && parentOwned.data) {
      const parentId = parentOwned.data.id as string;
      const owned = ((parentOwned.data.athletes ?? []) as any[]).some(
        (a) => a.id === data.athleteId,
      );
      allowed = owned || (guarded.data ?? []).some((g: any) => g.parent_id === parentId);
    }
    if (!allowed) return [];

    const rows = await admin
      .from("competition_recaps")
      .select("id, competition_id, body, author_role, author_user_id, created_at")
      .eq("athlete_id", data.athleteId)
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
  });
