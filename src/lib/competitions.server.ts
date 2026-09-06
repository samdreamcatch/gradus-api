/**
 * Shared competition attendance logic — the single source of truth for the
 * web server function (`recordCompetitionAttendance` in
 * src/lib/competition-recap.functions.ts) and the /api/v1 route
 * (src/routes/api/v1/competitions/$id/attendance.ts), per docs/ios/PRD.md
 * §6.2 and §9.4: business logic lives here and each transport is a thin
 * wrapper. Extracted from the server function without behavior changes; the
 * only differences are that the admin client is passed in and the
 * competition may be addressed by id (the API) as well as by slug (the web).
 *
 * The competition tables come from a staged migration, so they are not in
 * the generated Supabase types yet — access is through the same loose
 * accessor the board code uses.
 */
import { dbError } from "./db-error";

/** Live boards are figure skating only, so attendance resolves in that sport. */
export const BOARD_SPORT = "figure_skating";

/** Service-role client, cast loosely for the un-typed competition tables. */
export type AdminDb = { from: (table: string) => any };

export type BoardViewer =
  | { role: "parent"; parentId: string; name: string }
  | { role: "athlete"; athleteId: string; name: string }
  | null;

/** Which kind of account is asking, and under which profile row. */
export async function loadBoardViewer(admin: AdminDb, userId: string): Promise<BoardViewer> {
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
export async function athletesInBoardSport(
  admin: AdminDb,
  viewer: NonNullable<BoardViewer>,
): Promise<{ id: string; name: string }[]> {
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

/** The competition to record against: the web addresses it by slug, the API by id. */
export type CompetitionRef = { id: string } | { slug: string };

/**
 * Opening a board at a competition (the QR scan) is what marks a signed-in
 * parent or athlete as "there" — that's what earns the recap prompt later.
 * A coach at the board isn't asked for a recap, but their attendance is the
 * trigger for the post-event "did any of your athletes compete?" flow.
 * Returns `{ ok: false }` when the caller has no profile or the competition
 * does not exist; recording twice is a no-op.
 */
export async function recordAttendance(
  admin: AdminDb,
  userId: string,
  competition: CompetitionRef,
): Promise<{ ok: boolean }> {
  const viewer = await loadBoardViewer(admin, userId);

  let isCoach = false;
  if (!viewer) {
    const coach = await admin.from("coach_profiles").select("id").eq("user_id", userId).maybeSingle();
    if (coach.error) dbError(coach.error);
    if (!coach.data) return { ok: false };
    isCoach = true;
  }

  const comp = await ("id" in competition
    ? admin.from("competitions").select("id").eq("id", competition.id).maybeSingle()
    : admin.from("competitions").select("id").eq("slug", competition.slug).maybeSingle());
  if (comp.error) dbError(comp.error);
  if (!comp.data) return { ok: false };

  const existing = await admin
    .from("competition_attendance")
    .select("id, athlete_id")
    .eq("user_id", userId)
    .eq("competition_id", comp.data.id)
    .maybeSingle();
  if (existing.error) dbError(existing.error);
  if (existing.data) return { ok: true };

  const candidates = viewer ? await athletesInBoardSport(admin, viewer) : [];
  const { error } = await admin.from("competition_attendance").insert({
    user_id: userId,
    competition_id: comp.data.id,
    athlete_id: candidates.length === 1 ? candidates[0].id : null,
    viewer_role: isCoach ? "coach" : viewer!.role,
  });
  if (error) dbError(error);
  return { ok: true };
}
