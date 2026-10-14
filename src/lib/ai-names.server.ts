/**
 * Loads the names to keep out of an AI prompt about one athlete
 * (src/lib/ai-names.ts): the athlete, every parent or guardian on the
 * account, and any coaches the caller adds. Read with the service-role
 * client, so the mask is complete even when the caller's RLS can't see a
 * guardian's name. A failed read throws: a prompt is never sent half-masked.
 */
import { createNameMask, type MaskPerson, type NameMask } from "./ai-names";
import { dbError } from "./db-error";

/** Any service-role client (several modules type it their own way). */
type Admin = object;
type Loose = { from: (table: string) => any };

export interface NameMaskOptions {
  /** Coaches to mask too (briefings name the coach and the athlete's other coaches). */
  coaches?: { firstName: string | null; lastName: string | null; display?: string }[];
}

export async function loadAthleteNameMask(
  admin: Admin,
  athleteId: string,
  opts: NameMaskOptions = {},
): Promise<NameMask> {
  const db = admin as unknown as Loose;
  const athleteRes = await db
    .from("athletes")
    .select("first_name, last_name, parent_id")
    .eq("id", athleteId)
    .maybeSingle();
  if (athleteRes.error) dbError(athleteRes.error);
  const athlete = athleteRes.data as {
    first_name: string | null;
    last_name: string | null;
    parent_id: string | null;
  } | null;

  const people: MaskPerson[] = [];
  if (athlete) {
    people.push({ role: "ATHLETE", firstName: athlete.first_name, lastName: athlete.last_name });

    const guardiansRes = await db
      .from("athlete_guardians")
      .select("parent_id")
      .eq("athlete_id", athleteId);
    if (guardiansRes.error) dbError(guardiansRes.error);
    const parentIds = new Set<string>(
      ((guardiansRes.data ?? []) as { parent_id: string }[]).map((r) => r.parent_id),
    );
    if (athlete.parent_id) parentIds.add(athlete.parent_id);
    if (parentIds.size) {
      const parentsRes = await db
        .from("parent_profiles")
        .select("id, first_name, last_name")
        .in("id", [...parentIds]);
      if (parentsRes.error) dbError(parentsRes.error);
      // Primary parent first, so it gets the plain "[PARENT]" placeholder.
      const rows = (
        (parentsRes.data ?? []) as {
          id: string;
          first_name: string | null;
          last_name: string | null;
        }[]
      ).sort((a, b) => Number(b.id === athlete.parent_id) - Number(a.id === athlete.parent_id));
      for (const p of rows) {
        people.push({ role: "PARENT", firstName: p.first_name, lastName: p.last_name });
      }
    }
  }
  for (const c of opts.coaches ?? []) {
    people.push({
      role: "COACH",
      firstName: c.firstName,
      lastName: c.lastName,
      display: c.display,
    });
  }
  return createNameMask(people);
}
