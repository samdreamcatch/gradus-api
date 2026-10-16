/**
 * Club (organization) content: the sports a club has, club edits of the
 * Gradus resource library and move curriculum, club levels, and required
 * acknowledgements of club documents.
 *
 * Every table here is service-role only. Callers authorize first (org admin
 * via `has_org_admin`, Gradus admin via `has_role`, or membership resolved
 * below from the caller's own profile rows), then pass the admin client.
 *
 * Merge rule for coaches, parents and athletes: club override, then club
 * item, then Gradus default. Anything the club archived is left out.
 */
import type { supabaseAdmin } from "@/integrations/supabase/client.server";
import { SPORTS } from "./coach-sports";
import { dbError } from "./db-error";

export type Admin = typeof supabaseAdmin;
export type AckAudience = "coach" | "parent" | "athlete";
export const ACK_AUDIENCES: AckAudience[] = ["coach", "parent", "athlete"];

/* ============================ Shared ============================ */

export async function bumpContentVersion(admin: Admin, orgId: string): Promise<void> {
  const { data, error } = await admin
    .from("organizations")
    .select("content_version")
    .eq("id", orgId)
    .maybeSingle();
  if (error) dbError(error);
  const next = ((data?.content_version as number | null) ?? 0) + 1;
  const upd = await admin.from("organizations").update({ content_version: next }).eq("id", orgId);
  if (upd.error) dbError(upd.error);
}

export async function orgSports(admin: Admin, orgId: string): Promise<string[]> {
  const { data, error } = await admin
    .from("organization_sports")
    .select("sport")
    .eq("organization_id", orgId);
  if (error) dbError(error);
  return (data ?? []).map((r) => r.sport).sort();
}

export async function setOrgSports(admin: Admin, orgId: string, sports: string[]): Promise<void> {
  const want = Array.from(new Set(sports));
  const current = await orgSports(admin, orgId);
  const remove = current.filter((s) => !want.includes(s));
  const add = want.filter((s) => !current.includes(s));
  if (remove.length) {
    const del = await admin
      .from("organization_sports")
      .delete()
      .eq("organization_id", orgId)
      .in("sport", remove);
    if (del.error) dbError(del.error);
  }
  if (add.length) {
    const ins = await admin
      .from("organization_sports")
      .insert(add.map((sport) => ({ organization_id: orgId, sport })));
    if (ins.error) dbError(ins.error);
  }
  if (remove.length || add.length) await bumpContentVersion(admin, orgId);
}

/* ============================ Membership ============================ */

export type Membership = {
  role: AckAudience;
  userId: string;
  name: string;
  orgIds: string[];
  /** Athletes this caller acknowledges for (a parent's minor athletes). */
  minorAthletes: { id: string; name: string; orgIds: string[] }[];
  /** For an athlete caller: their own athlete id. */
  athleteId?: string;
  isMinor?: boolean;
};

export function isMinor(birthdate: string | null | undefined, now = new Date()): boolean {
  if (!birthdate) return true;
  const b = new Date(birthdate + "T00:00:00Z");
  const eighteen = new Date(Date.UTC(b.getUTCFullYear() + 18, b.getUTCMonth(), b.getUTCDate()));
  return now < eighteen;
}

async function orgsForAthletes(admin: Admin, athleteIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!athleteIds.length) return out;
  const { data, error } = await admin
    .from("coach_athletes")
    .select("athlete_id, coach_profiles!inner(organization_id)")
    .in("athlete_id", athleteIds);
  if (error) dbError(error);
  for (const r of data ?? []) {
    const org = (r.coach_profiles as { organization_id: string | null } | null)?.organization_id;
    if (!org) continue;
    const list = out.get(r.athlete_id) ?? [];
    if (!list.includes(org)) list.push(org);
    out.set(r.athlete_id, list);
  }
  return out;
}

/** Which clubs the signed-in user belongs to, and in which role. */
export async function resolveMembership(admin: Admin, userId: string): Promise<Membership | null> {
  const coach = await admin
    .from("coach_profiles")
    .select("first_name, last_name, organization_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (coach.error) dbError(coach.error);
  if (coach.data) {
    return {
      role: "coach",
      userId,
      name: `${coach.data.first_name ?? ""} ${coach.data.last_name ?? ""}`.trim(),
      orgIds: coach.data.organization_id ? [coach.data.organization_id] : [],
      minorAthletes: [],
    };
  }

  const parent = await admin
    .from("parent_profiles")
    .select("id, first_name, last_name")
    .eq("user_id", userId)
    .maybeSingle();
  if (parent.error) dbError(parent.error);
  if (parent.data) {
    const [own, co] = await Promise.all([
      admin.from("athletes").select("id").eq("parent_id", parent.data.id),
      admin.from("athlete_guardians").select("athlete_id").eq("parent_id", parent.data.id),
    ]);
    if (own.error) dbError(own.error);
    if (co.error) dbError(co.error);
    const ids = Array.from(
      new Set([...(own.data ?? []).map((a) => a.id), ...(co.data ?? []).map((a) => a.athlete_id)]),
    );
    const byAthlete = await orgsForAthletes(admin, ids);
    const athletes = ids.length
      ? await admin.from("athletes").select("id, first_name, last_name, birthdate").in("id", ids)
      : { data: [], error: null };
    if (athletes.error) dbError(athletes.error);
    const orgIds = new Set<string>();
    byAthlete.forEach((orgs) => orgs.forEach((o) => orgIds.add(o)));
    return {
      role: "parent",
      userId,
      name: `${parent.data.first_name ?? ""} ${parent.data.last_name ?? ""}`.trim(),
      orgIds: Array.from(orgIds),
      minorAthletes: (athletes.data ?? [])
        .filter((a) => isMinor(a.birthdate as string | null))
        .map((a) => ({
          id: a.id,
          name: `${a.first_name ?? ""} ${a.last_name ?? ""}`.trim(),
          orgIds: byAthlete.get(a.id) ?? [],
        }))
        .filter((a) => a.orgIds.length > 0),
    };
  }

  const athlete = await admin
    .from("athletes")
    .select("id, first_name, last_name, birthdate")
    .eq("user_id", userId)
    .maybeSingle();
  if (athlete.error) dbError(athlete.error);
  if (athlete.data) {
    const byAthlete = await orgsForAthletes(admin, [athlete.data.id]);
    return {
      role: "athlete",
      userId,
      name: `${athlete.data.first_name ?? ""} ${athlete.data.last_name ?? ""}`.trim(),
      orgIds: byAthlete.get(athlete.data.id) ?? [],
      minorAthletes: [],
      athleteId: athlete.data.id,
      isMinor: isMinor(athlete.data.birthdate as string | null),
    };
  }
  return null;
}

/* ============================ Resource merge ============================ */

export type MergeableResource = {
  id: string;
  sport: string;
  title: string;
  description: string;
  kind: "pdf" | "image" | "link";
  externalUrl: string | null;
};

/**
 * Applies club overrides to Gradus library rows and appends club resources
 * for the given sports. `orgIds` empty returns the input unchanged.
 */
export async function mergeClubLibrary<T extends MergeableResource>(
  admin: Admin,
  orgIds: string[],
  sports: string[],
  library: T[],
  make: (r: MergeableResource) => T,
): Promise<T[]> {
  if (!orgIds.length) return library;
  const [overrides, clubRows] = await Promise.all([
    admin
      .from("org_resource_overrides")
      .select("resource_id, title, description, archived_at")
      .in("organization_id", orgIds),
    sports.length
      ? admin
          .from("resources")
          .select("id, sport, title, description, kind, external_url")
          .in("organization_id", orgIds)
          .eq("is_org_template", true)
          .is("coach_id", null)
          .eq("review_state", "released")
          .in("sport", sports)
          .order("display_order", { ascending: true })
          .order("title", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (overrides.error) dbError(overrides.error);
  if (clubRows.error) dbError(clubRows.error);
  const byId = new Map((overrides.data ?? []).map((o) => [o.resource_id, o]));

  const merged: T[] = [];
  for (const r of library) {
    const o = byId.get(r.id);
    if (o?.archived_at) continue;
    merged.push(
      o
        ? { ...r, title: o.title ?? r.title, description: o.description ?? r.description }
        : r,
    );
  }
  const club = (clubRows.data ?? [])
    .filter((r) => !byId.get(r.id)?.archived_at)
    .map((r) =>
      make({
        id: r.id,
        sport: r.sport,
        title: r.title,
        description: r.description ?? "",
        kind: (r.kind as MergeableResource["kind"]) ?? "pdf",
        externalUrl: r.external_url,
      }),
    );
  return [...club, ...merged];
}

/** True when `resourceId` is a live club resource of one of the caller's clubs. */
export async function callerCanOpenClubResource(
  admin: Admin,
  userId: string,
  resourceId: string,
): Promise<boolean> {
  const m = await resolveMembership(admin, userId);
  const orgIds = new Set([...(m?.orgIds ?? []), ...(await adminOrgIds(admin, userId))]);
  if (!orgIds.size) return false;
  const { data, error } = await admin
    .from("resources")
    .select("organization_id, is_org_template, coach_id")
    .eq("id", resourceId)
    .maybeSingle();
  if (error) dbError(error);
  return !!(
    data &&
    data.is_org_template &&
    !data.coach_id &&
    data.organization_id &&
    orgIds.has(data.organization_id)
  );
}

async function adminOrgIds(admin: Admin, userId: string): Promise<string[]> {
  const { data, error } = await admin
    .from("org_admins")
    .select("organization_id")
    .eq("user_id", userId);
  if (error) dbError(error);
  return (data ?? []).map((r) => r.organization_id);
}

/* ============================ Coach sync ============================ */

/**
 * Brings a club coach's move library and level hours up to the club's
 * current content. Runs when the club's content version moved past the
 * coach's cursor. Club version replaces the coach's copy.
 */
export async function syncCoachClubContent(admin: Admin, coachId: string): Promise<void> {
  const { data: coach, error } = await admin
    .from("coach_profiles")
    .select("organization_id, last_synced_content_version")
    .eq("id", coachId)
    .maybeSingle();
  if (error) dbError(error);
  const orgId = coach?.organization_id;
  if (!orgId) return;
  const { data: org, error: oErr } = await admin
    .from("organizations")
    .select("content_version")
    .eq("id", orgId)
    .maybeSingle();
  if (oErr) dbError(oErr);
  const version = (org?.content_version as number | null) ?? 0;
  if ((coach.last_synced_content_version ?? -1) >= version) return;

  await syncMoves(admin, coachId, orgId);
  await syncLevels(admin, coachId, orgId);

  const upd = await admin
    .from("coach_profiles")
    .update({ last_synced_content_version: version })
    .eq("id", coachId);
  if (upd.error) dbError(upd.error);
}

const norm = (s: string) => s.trim().toLowerCase();

async function syncMoves(admin: Admin, coachId: string, orgId: string) {
  const [mine, overrides, clubMoves] = await Promise.all([
    admin.from("moves").select("id, sport, name, archived_at").eq("coach_id", coachId),
    admin
      .from("org_move_overrides")
      .select(
        "seed_move_id, name, category, description, cue, why, default_target_kind, default_target_value, archived_at, seed_moves!inner(sport, name, category, description, cue, why, default_target_kind, default_target_value)",
      )
      .eq("organization_id", orgId),
    admin
      .from("moves")
      .select(
        "sport, category, name, description, cue, why, default_target_kind, default_target_value, archived_at",
      )
      .eq("organization_id", orgId)
      .eq("is_org_template", true)
      .is("coach_id", null),
  ]);
  if (mine.error) dbError(mine.error);
  if (overrides.error) dbError(overrides.error);
  if (clubMoves.error) dbError(clubMoves.error);
  const rows = mine.data ?? [];
  const find = (sport: string, name: string) =>
    rows.find((r) => r.sport === sport && norm(r.name) === norm(name));
  const now = new Date().toISOString();

  type Fields = {
    sport: string;
    category: string;
    name: string;
    description: string;
    cue: string;
    why: string;
    default_target_kind: string;
    default_target_value: number;
  };
  const apply = async (target: Fields, archived: boolean, originalName?: string) => {
    if (originalName && norm(originalName) !== norm(target.name)) {
      const orig = find(target.sport, originalName);
      if (orig && !orig.archived_at) {
        const r = await admin.from("moves").update({ archived_at: now }).eq("id", orig.id);
        if (r.error) dbError(r.error);
      }
    }
    const existing = find(target.sport, target.name);
    if (archived) {
      if (existing && !existing.archived_at) {
        const r = await admin.from("moves").update({ archived_at: now }).eq("id", existing.id);
        if (r.error) dbError(r.error);
      }
      return;
    }
    if (existing) {
      const r = await admin
        .from("moves")
        .update({ ...target, archived_at: null })
        .eq("id", existing.id);
      if (r.error) dbError(r.error);
    } else {
      const r = await admin.from("moves").insert({ ...target, coach_id: coachId });
      if (r.error) dbError(r.error);
    }
  };

  for (const o of overrides.data ?? []) {
    const s = o.seed_moves as unknown as Fields;
    await apply(
      {
        sport: s.sport,
        category: o.category ?? s.category,
        name: o.name ?? s.name,
        description: o.description ?? s.description,
        cue: o.cue ?? s.cue,
        why: o.why ?? s.why,
        default_target_kind: o.default_target_kind ?? s.default_target_kind,
        default_target_value: Number(o.default_target_value ?? s.default_target_value),
      },
      !!o.archived_at,
      s.name,
    );
  }
  for (const m of clubMoves.data ?? []) {
    await apply(
      {
        sport: m.sport,
        category: m.category,
        name: m.name,
        description: m.description,
        cue: m.cue,
        why: m.why,
        default_target_kind: m.default_target_kind,
        default_target_value: Number(m.default_target_value),
      },
      !!m.archived_at,
    );
  }
}

async function syncLevels(admin: Admin, coachId: string, orgId: string) {
  const [mine, club] = await Promise.all([
    admin
      .from("coach_levels")
      .select("id, sport, level_key, practice_hours_per_week")
      .eq("coach_id", coachId),
    admin
      .from("org_levels")
      .select("sport, level_key, practice_hours_per_week, archived_at")
      .eq("organization_id", orgId),
  ]);
  if (mine.error) dbError(mine.error);
  if (club.error) dbError(club.error);
  for (const l of mine.data ?? []) {
    const c = (club.data ?? []).find(
      (x) => x.sport === l.sport && x.level_key === l.level_key && !x.archived_at,
    );
    if (!c) continue;
    const catalog = SPORTS.find((s) => s.key === l.sport)?.levels.find(
      (x) => x.key === l.level_key,
    );
    const current = Number(l.practice_hours_per_week);
    // Only fill hours the coach hasn't set themselves.
    const untouched = current === 0 || (catalog && current === catalog.suggestedHours);
    if (!untouched) continue;
    const r = await admin
      .from("coach_levels")
      .update({ practice_hours_per_week: c.practice_hours_per_week })
      .eq("id", l.id);
    if (r.error) dbError(r.error);
  }
}

/* ============================ Acknowledgements ============================ */

export type AckSigner = {
  key: string;
  role: AckAudience;
  userId: string | null;
  name: string;
  /** Set when a guardian signs for a minor athlete. */
  forAthleteId: string | null;
  forAthleteName: string | null;
  acknowledgedAt: string | null;
  signedBy: string | null;
};

/** Everyone a club document's requirement covers, with their status at `version`. */
export async function ackRoster(
  admin: Admin,
  orgId: string,
  resourceId: string,
  audiences: AckAudience[],
  version: number,
): Promise<AckSigner[]> {
  const coaches = await admin
    .from("coach_profiles")
    .select("id, user_id, first_name, last_name")
    .eq("organization_id", orgId);
  if (coaches.error) dbError(coaches.error);
  const coachIds = (coaches.data ?? []).map((c) => c.id);
  const links = coachIds.length
    ? await admin.from("coach_athletes").select("athlete_id").in("coach_id", coachIds)
    : { data: [], error: null };
  if (links.error) dbError(links.error);
  const athleteIds = Array.from(new Set((links.data ?? []).map((l) => l.athlete_id)));
  const athletes = athleteIds.length
    ? await admin
        .from("athletes")
        .select("id, user_id, first_name, last_name, birthdate, parent_id")
        .in("id", athleteIds)
    : { data: [], error: null };
  if (athletes.error) dbError(athletes.error);
  const guardians = athleteIds.length
    ? await admin.from("athlete_guardians").select("athlete_id, parent_id").in("athlete_id", athleteIds)
    : { data: [], error: null };
  if (guardians.error) dbError(guardians.error);
  const parentIds = Array.from(
    new Set([
      ...(athletes.data ?? []).map((a) => a.parent_id).filter((x): x is string => !!x),
      ...(guardians.data ?? []).map((g) => g.parent_id),
    ]),
  );
  const parents = parentIds.length
    ? await admin
        .from("parent_profiles")
        .select("id, user_id, first_name, last_name")
        .in("id", parentIds)
    : { data: [], error: null };
  if (parents.error) dbError(parents.error);

  const acks = await admin
    .from("resource_acknowledgements")
    .select("user_id, acted_for_athlete_id, acknowledged_at, signer_name")
    .eq("resource_id", resourceId)
    .eq("version", version);
  if (acks.error) dbError(acks.error);
  const ackFor = (userId: string | null, athleteId: string | null) =>
    (acks.data ?? []).find((a) =>
      athleteId ? a.acted_for_athlete_id === athleteId : a.user_id === userId && !a.acted_for_athlete_id,
    );
  const full = (p: { first_name: string | null; last_name: string | null }) =>
    `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();

  const out: AckSigner[] = [];
  if (audiences.includes("coach")) {
    for (const c of coaches.data ?? []) {
      const a = ackFor(c.user_id, null);
      out.push({
        key: `coach:${c.id}`,
        role: "coach",
        userId: c.user_id,
        name: full(c),
        forAthleteId: null,
        forAthleteName: null,
        acknowledgedAt: a?.acknowledged_at ?? null,
        signedBy: a?.signer_name ?? null,
      });
    }
  }
  if (audiences.includes("parent")) {
    for (const p of parents.data ?? []) {
      const a = ackFor(p.user_id, null);
      out.push({
        key: `parent:${p.id}`,
        role: "parent",
        userId: p.user_id,
        name: full(p),
        forAthleteId: null,
        forAthleteName: null,
        acknowledgedAt: a?.acknowledged_at ?? null,
        signedBy: a?.signer_name ?? null,
      });
    }
  }
  if (audiences.includes("athlete")) {
    for (const a of athletes.data ?? []) {
      if (isMinor(a.birthdate as string | null)) {
        const ack = ackFor(null, a.id);
        out.push({
          key: `athlete:${a.id}`,
          role: "athlete",
          userId: null,
          name: full(a),
          forAthleteId: a.id,
          forAthleteName: full(a),
          acknowledgedAt: ack?.acknowledged_at ?? null,
          signedBy: ack?.signer_name ?? null,
        });
      } else {
        const ack = a.user_id ? ackFor(a.user_id, null) : undefined;
        out.push({
          key: `athlete:${a.id}`,
          role: "athlete",
          userId: a.user_id,
          name: full(a),
          forAthleteId: null,
          forAthleteName: null,
          acknowledgedAt: ack?.acknowledged_at ?? null,
          signedBy: ack?.signer_name ?? null,
        });
      }
    }
  }
  return out;
}

/** User ids to notify for the outstanding signers (guardians for minors). */
export async function outstandingUserIds(admin: Admin, signers: AckSigner[]): Promise<string[]> {
  const ids = new Set<string>();
  const minorIds: string[] = [];
  for (const s of signers) {
    if (s.acknowledgedAt) continue;
    if (s.userId) ids.add(s.userId);
    else if (s.forAthleteId) minorIds.push(s.forAthleteId);
  }
  if (minorIds.length) {
    const [own, co] = await Promise.all([
      admin.from("athletes").select("parent_id").in("id", minorIds),
      admin.from("athlete_guardians").select("parent_id").in("athlete_id", minorIds),
    ]);
    if (own.error) dbError(own.error);
    if (co.error) dbError(co.error);
    const pids = Array.from(
      new Set([
        ...(own.data ?? []).map((r) => r.parent_id).filter((x): x is string => !!x),
        ...(co.data ?? []).map((r) => r.parent_id),
      ]),
    );
    if (pids.length) {
      const p = await admin.from("parent_profiles").select("user_id").in("id", pids);
      if (p.error) dbError(p.error);
      for (const r of p.data ?? []) if (r.user_id) ids.add(r.user_id);
    }
  }
  return Array.from(ids);
}

export type PendingAck = {
  resourceId: string;
  version: number;
  title: string;
  description: string;
  orgName: string;
  /** Null: the caller signs for themself. */
  forAthleteId: string | null;
  forAthleteName: string | null;
};

/** Club documents the caller still needs to acknowledge. */
export async function pendingAcksFor(admin: Admin, m: Membership): Promise<PendingAck[]> {
  const orgIds = Array.from(new Set([...m.orgIds, ...m.minorAthletes.flatMap((a) => a.orgIds)]));
  if (!orgIds.length) return [];
  const reqs = await admin
    .from("resource_ack_requirements")
    .select("resource_id, organization_id, audiences, version, resources!inner(title, description, review_state), organizations!inner(name)")
    .in("organization_id", orgIds);
  if (reqs.error) dbError(reqs.error);
  const archived = await admin
    .from("org_resource_overrides")
    .select("resource_id")
    .in("organization_id", orgIds)
    .not("archived_at", "is", null);
  if (archived.error) dbError(archived.error);
  const archivedIds = new Set((archived.data ?? []).map((r) => r.resource_id));
  const ids = (reqs.data ?? []).map((r) => r.resource_id);
  const acks = ids.length
    ? await admin
        .from("resource_acknowledgements")
        .select("resource_id, version, user_id, acted_for_athlete_id")
        .in("resource_id", ids)
    : { data: [], error: null };
  if (acks.error) dbError(acks.error);

  const out: PendingAck[] = [];
  for (const r of reqs.data ?? []) {
    if (archivedIds.has(r.resource_id)) continue;
    const res = r.resources as unknown as { title: string; description: string | null; review_state: string };
    if (res.review_state !== "released") continue;
    const org = r.organizations as unknown as { name: string };
    const aud = (r.audiences ?? []) as AckAudience[];
    const base = {
      resourceId: r.resource_id,
      version: r.version,
      title: res.title,
      description: res.description ?? "",
      orgName: org.name,
    };
    const done = (athleteId: string | null) =>
      (acks.data ?? []).some(
        (a) =>
          a.resource_id === r.resource_id &&
          a.version === r.version &&
          (athleteId ? a.acted_for_athlete_id === athleteId : a.user_id === m.userId && !a.acted_for_athlete_id),
      );
    const selfApplies =
      m.orgIds.includes(r.organization_id) &&
      aud.includes(m.role) &&
      !(m.role === "athlete" && m.isMinor);
    if (selfApplies && !done(null)) out.push({ ...base, forAthleteId: null, forAthleteName: null });
    if (m.role === "parent" && aud.includes("athlete")) {
      for (const a of m.minorAthletes) {
        if (a.orgIds.includes(r.organization_id) && !done(a.id)) {
          out.push({ ...base, forAthleteId: a.id, forAthleteName: a.name });
        }
      }
    }
  }
  return out;
}
