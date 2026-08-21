/**
 * Server-only helpers for the Team plan (multiple guardians per athlete).
 *
 * A parent profile can reach an athlete two ways:
 *   1. `athletes.parent_id` — the primary parent (legacy source of truth)
 *   2. `athlete_guardians` — the join table, which holds the primary row
 *      (kept in sync by a DB trigger) plus any co-guardians
 *
 * Reads use the union of both so nothing regresses if a trigger ever misses.
 * Writes by a co-guardian additionally require an active Team plan on the
 * *primary* parent — see `canWriteAthlete`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

const NIL = "00000000-0000-0000-0000-000000000000";

type Admin = SupabaseClient<any, any, any>;

/** All athlete ids this parent profile can see (primary + co-guardian). */
export async function guardianAthleteIds(admin: Admin, parentId: string): Promise<string[]> {
  const [own, joined] = await Promise.all([
    admin.from("athletes").select("id").eq("parent_id", parentId),
    admin.from("athlete_guardians").select("athlete_id").eq("parent_id", parentId),
  ]);
  const ids = new Set<string>();
  for (const r of own.data ?? []) ids.add(r.id as string);
  for (const r of joined.data ?? []) ids.add(r.athlete_id as string);
  return Array.from(ids);
}

/** Same as `guardianAthleteIds` but never empty — safe for `.in()` filters. */
export async function guardianAthleteIdsSafe(admin: Admin, parentId: string): Promise<string[]> {
  const ids = await guardianAthleteIds(admin, parentId);
  return ids.length ? ids : [NIL];
}

export async function canAccessAthlete(
  admin: Admin,
  parentId: string,
  athleteId: string,
): Promise<boolean> {
  const ids = await guardianAthleteIds(admin, parentId);
  return ids.includes(athleteId);
}

/** True when this parent profile carries an active/trialing Team plan. */
export async function teamPlanActive(admin: Admin, parentId: string): Promise<boolean> {
  const res = await admin
    .from("parent_profiles")
    .select("subscription_status, current_period_end")
    .eq("id", parentId)
    .maybeSingle();
  const row = res.data as { subscription_status: string | null; current_period_end: string | null } | null;
  if (!row?.subscription_status) return false;
  const end = row.current_period_end ? new Date(row.current_period_end).getTime() : null;
  const notExpired = end === null || end > Date.now();
  if (["active", "trialing", "past_due"].includes(row.subscription_status)) return notExpired;
  if (row.subscription_status === "canceled") return notExpired;
  return false;
}

export type AthleteAccess = {
  athleteId: string;
  /** 'primary' | 'co' */
  role: "primary" | "co";
  canWrite: boolean;
};

/**
 * Resolve how a parent relates to an athlete and whether they may write.
 * Primary parents always write. Co-guardians write only while the athlete's
 * primary parent holds an active Team plan; otherwise they're read-only.
 */
export async function resolveAthleteAccess(
  admin: Admin,
  parentId: string,
  athleteId: string,
): Promise<AthleteAccess | null> {
  const athlete = await admin
    .from("athletes")
    .select("id, parent_id")
    .eq("id", athleteId)
    .maybeSingle();
  if (!athlete.data) return null;
  const primaryId = (athlete.data as { parent_id: string | null }).parent_id;
  if (primaryId === parentId) return { athleteId, role: "primary", canWrite: true };

  const link = await admin
    .from("athlete_guardians")
    .select("id, role")
    .eq("athlete_id", athleteId)
    .eq("parent_id", parentId)
    .maybeSingle();
  if (!link.data) return null;

  const canWrite = primaryId ? await teamPlanActive(admin, primaryId) : false;
  return { athleteId, role: "co", canWrite };
}

/** Throws unless the caller may write for this athlete. */
export async function assertCanWriteAthlete(
  admin: Admin,
  parentId: string,
  athleteId: string,
): Promise<void> {
  const access = await resolveAthleteAccess(admin, parentId, athleteId);
  if (!access) throw new Error("Athlete not found");
  if (!access.canWrite) {
    throw new Error(
      "This athlete's Team plan isn't active, so additional guardians have view-only access.",
    );
  }
}

export function newInviteToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function newInviteCode(len = 8): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => ALPHABET[b % ALPHABET.length])
    .join("");
}
