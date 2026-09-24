/**
 * The privacy rules of the admin Usage report (PRD §6.12 "Reporting"), kept
 * pure so they are tested apart from the page:
 * - adult groups under 5 users read "<5";
 * - minors by club and region: a club or region is named only when it has at
 *   least 10 minor athletes on the roster right now; smaller ones merge into
 *   "Other clubs" / "Other regions";
 * - a region's total is withheld when its unnamed remainder (the minors in
 *   clubs too small to name) is between 1 and 9, so a small club can't be
 *   found by subtracting its named neighbours from the region;
 * - "Other clubs" and "No club" are withheld too when they cover 1-9 minors;
 * - minors are never broken down per coach (§12 #22).
 */
export const MIN_ADULT_USERS = 5;
export const MIN_GROUP_MINORS = 10;

/** "<5" for a count of adult users too small to show. */
export function adultUsers(count: number): string {
  return count > 0 && count < MIN_ADULT_USERS ? `<${MIN_ADULT_USERS}` : String(count);
}

export interface RosterOrg {
  orgId: string;
  name: string;
  region: string | null;
  minors: number;
}

export interface GroupActivity {
  kind: "club" | "region" | "bucket" | "all";
  key: string;
  events: number;
  safeSportOpens: number;
  resourceOpens: number;
  screenMs: number;
}

export interface MinorGroupRow {
  label: string;
  kind: "club" | "region" | "other" | "none" | "all";
  minors: number | null;
  events: number;
  safeSportOpens: number;
  /** Safe Sport opens per minor athlete; null when the roster count is withheld. */
  safeSportPerMinor: number | null;
  resourceOpens: number;
  screenMinutes: number;
  /** A region whose total is withheld to protect a small club inside it. */
  withheld?: boolean;
}

const minutes = (ms: number) => Math.round(ms / 60000);
const perMinor = (n: number, minors: number | null) =>
  minors && minors > 0 ? Math.round((n / minors) * 100) / 100 : null;

/**
 * The minors-by-club/region table. `activity` comes from
 * `analytics_minor_group_report` (stored clubs/regions only passed the
 * 10-minor test at write time); `roster` from `analytics_minor_roster` (now).
 */
export function minorGroupRows(
  roster: RosterOrg[],
  activity: GroupActivity[],
  noClubMinors: number,
): {
  clubs: MinorGroupRow[];
  regions: MinorGroupRow[];
  baseline: { medianSafeSportPerMinor: number | null };
} {
  const byKey = new Map(activity.map((a) => [`${a.kind}:${a.key}`, a]));
  const empty = { events: 0, safeSportOpens: 0, resourceOpens: 0, screenMs: 0 };

  // Clubs: named only at >= 10 minors now; the rest (and events for clubs
  // that have since shrunk) merge into "Other clubs".
  const clubs: MinorGroupRow[] = [];
  const other = { ...empty };
  const namedOrgIds = new Set<string>();
  for (const org of roster) {
    const a = byKey.get(`club:${org.orgId}`) ?? { ...empty };
    if (org.minors >= MIN_GROUP_MINORS) {
      namedOrgIds.add(org.orgId);
      clubs.push(row(org.name, "club", org.minors, a));
    }
  }
  for (const a of activity) {
    if (a.kind === "club" && !namedOrgIds.has(a.key)) add(other, a);
    if (a.kind === "bucket" && a.key === "other_clubs") add(other, a);
  }
  clubs.sort((x, y) => y.events - x.events || x.label.localeCompare(y.label));
  const otherMinors = roster
    .filter((o) => !namedOrgIds.has(o.orgId))
    .reduce((n, o) => n + o.minors, 0);
  clubs.push(guarded("Other clubs", "other", otherMinors, other));
  clubs.push(guarded("No club", "none", noClubMinors, byKey.get("bucket:no_club") ?? { ...empty }));

  // Regions: named at >= 10 minors; a named region's total is withheld when
  // its unnamed remainder is 1-9 minors.
  const regionMinors = new Map<string, number>();
  const regionNamedMinors = new Map<string, number>();
  for (const org of roster) {
    const r = org.region?.trim();
    if (!r) continue;
    regionMinors.set(r, (regionMinors.get(r) ?? 0) + org.minors);
    if (namedOrgIds.has(org.orgId)) {
      regionNamedMinors.set(r, (regionNamedMinors.get(r) ?? 0) + org.minors);
    }
  }
  const regions: MinorGroupRow[] = [];
  const otherRegions = { ...empty };
  const namedRegions = new Set<string>();
  for (const [region, minors] of regionMinors) {
    if (minors < MIN_GROUP_MINORS) continue;
    namedRegions.add(region);
    const remainder = minors - (regionNamedMinors.get(region) ?? 0);
    const a = byKey.get(`region:${region}`) ?? { ...empty };
    if (remainder > 0 && remainder < MIN_GROUP_MINORS) {
      regions.push(withheldRow(region, "region"));
    } else {
      regions.push(row(region, "region", minors, a));
    }
  }
  for (const a of activity) {
    if (a.kind === "region" && !namedRegions.has(a.key)) add(otherRegions, a);
  }
  regions.sort((x, y) => y.events - x.events || x.label.localeCompare(y.label));
  const otherRegionMinors = [...regionMinors.entries()]
    .filter(([r]) => !namedRegions.has(r))
    .reduce((n, [, m]) => n + m, 0);
  regions.push(guarded("Other regions", "other", otherRegionMinors, otherRegions));

  const rates = clubs
    .filter((c) => c.kind === "club" && c.safeSportPerMinor !== null)
    .map((c) => c.safeSportPerMinor as number)
    .sort((a, b) => a - b);
  const mid = Math.floor(rates.length / 2);
  const median = rates.length
    ? rates.length % 2
      ? rates[mid]
      : Math.round(((rates[mid - 1] + rates[mid]) / 2) * 100) / 100
    : null;
  return { clubs, regions, baseline: { medianSafeSportPerMinor: median } };
}

/** A bucket row, withheld when it covers 1-9 minors. */
function guarded(
  label: string,
  kind: MinorGroupRow["kind"],
  minors: number,
  a: { events: number; safeSportOpens: number; resourceOpens: number; screenMs: number },
): MinorGroupRow {
  if (minors > 0 && minors < MIN_GROUP_MINORS) return withheldRow(label, kind);
  return row(label, kind, minors, a);
}

function withheldRow(label: string, kind: MinorGroupRow["kind"]): MinorGroupRow {
  return {
    label,
    kind,
    minors: null,
    events: 0,
    safeSportOpens: 0,
    safeSportPerMinor: null,
    resourceOpens: 0,
    screenMinutes: 0,
    withheld: true,
  };
}

function add(
  into: { events: number; safeSportOpens: number; resourceOpens: number; screenMs: number },
  a: GroupActivity,
) {
  into.events += a.events;
  into.safeSportOpens += a.safeSportOpens;
  into.resourceOpens += a.resourceOpens;
  into.screenMs += a.screenMs;
}

function row(
  label: string,
  kind: MinorGroupRow["kind"],
  minors: number | null,
  a: { events: number; safeSportOpens: number; resourceOpens: number; screenMs: number },
): MinorGroupRow {
  return {
    label,
    kind,
    minors,
    events: a.events,
    safeSportOpens: a.safeSportOpens,
    safeSportPerMinor: perMinor(a.safeSportOpens, minors),
    resourceOpens: a.resourceOpens,
    screenMinutes: minutes(a.screenMs),
  };
}
