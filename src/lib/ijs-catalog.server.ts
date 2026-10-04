/**
 * The IJS competition catalog: every U.S. Figure Skating IJS competition,
 * found automatically, so a Live board can be searched for instead of set up
 * in Admin -> Competitions (Mariah, 2026-09-26). Migration
 * 20260927100000_ijs_catalog.
 *
 * IJS has no directory. Each competition is `/leaderboard/results/<calendar
 * year>/<id>/index.asp`; unused ids answer 404 and a page appears once the
 * event starts publishing. `sweepCatalog` (the `ijs-catalog-sweep` cron, once
 * a minute) walks a window of ids around the newest one found, at most 25
 * page checks a run, one at a time, inside a 40 s budget, so a full pass is
 * about two hours. Two slow or 429/5xx answers in a run pause the sweep,
 * 15 minutes at first and doubling to two hours, because the Live board reads
 * the same site and must never be the one IJS blocks.
 *
 * Found competitions become boards lazily: a catalog entry's slug is
 * `ijs-<year>-<id>`, and `materializeCatalogBoard` creates the `competitions`
 * row the first time anyone opens it. Boards refresh on read, as always, so a
 * catalog entry nobody opens costs nothing after it's found.
 */
import { IJS_USER_AGENT, decodeLatin1, parseIndex } from "./ijs-scrape.server";
import type { BoardListEntry } from "./board.server";
import { competitionWindow, dayKeyIn, isWithinWindow, parseDateRange } from "./competition-window";

/** Service-role client, cast loosely for the un-typed competition tables. */
export type CatalogDb = { from: (table: string) => any };

export const IJS_RESULTS_BASE = "https://ijs.usfigureskating.org/leaderboard/results";
export const SWEEP_BATCH = 25;
export const SWEEP_BUDGET_MS = 40_000;
export const PROBE_TIMEOUT_MS = 10_000;
/** How far below and above the newest id found the window reaches. */
export const WINDOW_BELOW = 2000;
export const WINDOW_ABOVE = 800;
/** The newest id seen when this shipped (2026-09-26), until the catalog knows better. */
export const SEED_TOP_ID = 37100;
export const TROUBLE_LIMIT = 2;
export const BACKOFF_FIRST_MINUTES = 15;
export const BACKOFF_MAX_MINUTES = 120;
const LEASE_MS = 55_000;
const RINK_TZ = "America/New_York";

export type ProbeResult =
  | { kind: "found"; html: string }
  | { kind: "missing" }
  | { kind: "trouble"; reason: string };

export interface CatalogEntry {
  year: number;
  compId: number;
  name: string;
  datesLabel: string;
  location: string;
  startsOn: string | null;
  endsOn: string | null;
}

export function indexUrl(year: number, compId: number): string {
  return `${IJS_RESULTS_BASE}/${year}/${compId}/index.asp`;
}

export function catalogSlug(year: number, compId: number): string {
  return `ijs-${year}-${compId}`;
}

export function parseCatalogSlug(slug: string): { year: number; compId: number } | null {
  const m = /^ijs-(\d{4})-(\d{3,7})$/.exec(slug);
  return m ? { year: Number(m[1]), compId: Number(m[2]) } : null;
}

/** The calendar years whose folders are swept: this one, plus next year's from mid-December. */
export function sweepYears(now: Date): number[] {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: RINK_TZ,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const year = get("year");
  return get("month") === 12 && get("day") >= 15 ? [year, year + 1] : [year];
}

/** One page check. Never throws: IJS trouble is a result, not an error. */
export async function probeIndex(
  year: number,
  compId: number,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<ProbeResult> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(indexUrl(year, compId), {
      headers: { "User-Agent": IJS_USER_AGENT },
      signal: ctl.signal,
      redirect: "manual",
    });
    if (res.status === 200) return { kind: "found", html: decodeLatin1(await res.arrayBuffer()) };
    if (res.status === 404 || res.status === 403 || (res.status >= 300 && res.status < 400)) {
      return { kind: "missing" };
    }
    return { kind: "trouble", reason: `HTTP ${res.status}` };
  } catch (e) {
    return { kind: "trouble", reason: e instanceof Error ? e.name : "fetch failed" };
  } finally {
    clearTimeout(timer);
  }
}

/** The catalog row for an index page, or null when it doesn't look like a competition. */
export function catalogRowFromIndex(html: string, year: number, compId: number) {
  const { competition, events } = parseIndex(html, year);
  if (!competition.name || competition.name === "Competition") return null;
  const { startsOn, endsOn } = parseDateRange(competition.dates);
  const starts = events
    .map((e) => e.startAt?.getTime())
    .filter((t): t is number => typeof t === "number" && Number.isFinite(t));
  return {
    year,
    comp_id: compId,
    name: competition.name,
    dates_label: competition.dates,
    location: competition.location,
    starts_on: startsOn,
    ends_on: endsOn,
    first_event_at: starts.length ? new Date(Math.min(...starts)).toISOString() : null,
    updated_at: new Date().toISOString(),
  };
}

async function saveCatalogRow(
  db: CatalogDb,
  row: NonNullable<ReturnType<typeof catalogRowFromIndex>>,
) {
  // first_seen_at keeps its default on insert and is never overwritten.
  const { error } = await db.from("ijs_catalog").upsert(row, { onConflict: "year,comp_id" });
  if (error) throw new Error(error.message);
}

/**
 * The newest id the sweep could have found: at most `atMost` (the window's
 * top). A far-off id cataloged from a pasted link or number must not drag
 * the window away from where new competitions actually appear.
 */
async function topKnownId(db: CatalogDb, atMost: number): Promise<number> {
  const { data } = await db
    .from("ijs_catalog")
    .select("comp_id")
    .lte("comp_id", atMost)
    .order("comp_id", { ascending: false })
    .limit(1)
    .maybeSingle();
  return Math.max(SEED_TOP_ID, Number(data?.comp_id ?? 0));
}

/** The highest window top any year's sweep has reached (a new year starts from there). */
async function highestWindowTop(db: CatalogDb): Promise<number> {
  const { data } = await db
    .from("ijs_catalog_sweep")
    .select("hi")
    .order("hi", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.hi ? Number(data.hi) : SEED_TOP_ID + WINDOW_ABOVE;
}

export interface SweepDeps {
  db: CatalogDb;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  /** Milliseconds since some origin; injectable so tests control the budget. */
  clock?: () => number;
}

export interface SweepResult {
  year: number | null;
  skipped?: "paused" | "leased";
  probed: number;
  found: number;
  trouble: number;
  passCompleted: boolean;
}

/**
 * One cron run: claim the year's lease, check up to 25 ids from the cursor
 * (skipping ones already in the catalog), save what's found, advance the
 * cursor, and pause on trouble. When two years are swept (mid-December on),
 * alternate minutes so the rate stays 25 a minute in total.
 */
export async function sweepCatalog(deps: SweepDeps): Promise<SweepResult> {
  const { db } = deps;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = (deps.now ?? (() => new Date()))();
  const clock = deps.clock ?? (() => Date.now());
  const years = sweepYears(now);
  const year = years[now.getUTCMinutes() % years.length]!;
  const empty = { year, probed: 0, found: 0, trouble: 0, passCompleted: false };

  let { data: state } = await db
    .from("ijs_catalog_sweep")
    .select("*")
    .eq("year", year)
    .maybeSingle();
  if (!state) {
    const top = await topKnownId(db, await highestWindowTop(db));
    const fresh = {
      year,
      lo: top - WINDOW_BELOW,
      hi: top + WINDOW_ABOVE,
      cursor: top - WINDOW_BELOW,
      pass_started_at: now.toISOString(),
    };
    await db
      .from("ijs_catalog_sweep")
      .upsert(fresh, { onConflict: "year", ignoreDuplicates: true });
    ({ data: state } = await db
      .from("ijs_catalog_sweep")
      .select("*")
      .eq("year", year)
      .maybeSingle());
    if (!state) return empty;
  }
  if (state.paused_until && new Date(state.paused_until).getTime() > now.getTime()) {
    return { ...empty, skipped: "paused" };
  }

  // Claim the lease so an overrunning run and the next minute's never overlap.
  const nowIso = now.toISOString();
  const { data: claimed } = await db
    .from("ijs_catalog_sweep")
    .update({ leased_until: new Date(now.getTime() + LEASE_MS).toISOString() })
    .eq("year", year)
    .or(`leased_until.is.null,leased_until.lt.${nowIso}`)
    .select("year");
  if (!claimed || claimed.length === 0) return { ...empty, skipped: "leased" };

  const lo = Number(state.lo);
  const hi = Number(state.hi);
  const { data: foundRows } = await db
    .from("ijs_catalog")
    .select("comp_id")
    .eq("year", year)
    .gte("comp_id", lo)
    .lte("comp_id", hi);
  const known = new Set<number>(
    ((foundRows ?? []) as { comp_id: number }[]).map((r) => Number(r.comp_id)),
  );

  let cursor = Math.min(Math.max(Number(state.cursor), lo), hi + 1);
  let probed = 0;
  let found = 0;
  let trouble = 0;
  let passCompleted = false;
  /** The first id IJS didn't answer cleanly; the next run resumes there. */
  let retryFrom: number | null = null;
  const started = clock();

  while (probed < SWEEP_BATCH && trouble < TROUBLE_LIMIT && clock() - started < SWEEP_BUDGET_MS) {
    if (cursor > hi) {
      passCompleted = true;
      break;
    }
    const id = cursor;
    cursor += 1;
    if (known.has(id)) continue;
    probed += 1;
    const result = await probeIndex(year, id, fetchImpl);
    if (result.kind === "trouble") {
      trouble += 1;
      retryFrom ??= id;
      continue;
    }
    if (result.kind === "found") {
      const row = catalogRowFromIndex(result.html, year, id);
      if (row) {
        await saveCatalogRow(db, row);
        found += 1;
      }
    }
  }

  if (retryFrom !== null) {
    cursor = retryFrom;
    passCompleted = false;
  }
  const patch: Record<string, unknown> = { cursor, leased_until: null, updated_at: nowIso };
  if (passCompleted || cursor > hi) {
    // New pass: re-centre the window on the newest id found so far.
    const newTop = await topKnownId(db, hi);
    patch.cursor = newTop - WINDOW_BELOW;
    patch.lo = newTop - WINDOW_BELOW;
    patch.hi = Math.max(hi, newTop + WINDOW_ABOVE);
    patch.last_pass_completed_at = nowIso;
    patch.pass_started_at = nowIso;
    passCompleted = true;
  }
  if (trouble >= TROUBLE_LIMIT) {
    const backoff = Math.min(
      BACKOFF_MAX_MINUTES,
      Math.max(BACKOFF_FIRST_MINUTES, Number(state.backoff_minutes ?? 0) * 2),
    );
    patch.backoff_minutes = backoff;
    patch.paused_until = new Date(now.getTime() + backoff * 60_000).toISOString();
  } else {
    patch.backoff_minutes = 0;
    patch.paused_until = null;
  }
  await db.from("ijs_catalog_sweep").update(patch).eq("year", year);

  return { year, probed, found, trouble, passCompleted };
}

/* ------------------------------------------------------------------ search */

/** A pasted leaderboard link or a bare competition number, if that's what was typed. */
export function parseIjsReference(q: string): { year: number | null; compId: number } | null {
  const link = /results\/(\d{4})\/(\d{3,7})/i.exec(q);
  if (link) return { year: Number(link[1]), compId: Number(link[2]) };
  const bare = /^\s*(\d{4,7})\s*$/.exec(q);
  return bare ? { year: null, compId: Number(bare[1]) } : null;
}

/** Words safe to drop into a PostgREST `or` filter (no commas, parentheses or wildcards). */
export function searchWords(q: string): string[] {
  return q
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}'-]/gu, ""))
    .filter((w) => w.length >= 2)
    .slice(0, 6);
}

function toEntry(row: any): CatalogEntry {
  return {
    year: Number(row.year),
    compId: Number(row.comp_id),
    name: row.name ?? "",
    datesLabel: row.dates_label ?? "",
    location: row.location ?? "",
    startsOn: row.starts_on ?? null,
    endsOn: row.ends_on ?? null,
  };
}

/** Looks a competition up on IJS right away (a pasted link or number) and catalogs it. */
export async function resolveReference(
  db: CatalogDb,
  ref: { year: number | null; compId: number },
  deps: { fetchImpl?: typeof fetch; now?: () => Date } = {},
): Promise<CatalogEntry | null> {
  const now = (deps.now ?? (() => new Date()))();
  // A bare number is looked up in the folders the sweep covers (this year, and
  // next year's from mid-December): one IJS request, two at most. A pasted
  // link names its year, so it's one request for any year.
  const years = ref.year ? [ref.year] : sweepYears(now);
  for (const year of years) {
    const { data: existing } = await db
      .from("ijs_catalog")
      .select("*")
      .eq("year", year)
      .eq("comp_id", ref.compId)
      .maybeSingle();
    if (existing) return toEntry(existing);
    const result = await probeIndex(year, ref.compId, deps.fetchImpl ?? fetch);
    if (result.kind !== "found") continue;
    const row = catalogRowFromIndex(result.html, year, ref.compId);
    if (!row) continue;
    await saveCatalogRow(db, row);
    return toEntry(row);
  }
  return null;
}

/** Board-list rows for catalog entries, pointing at an existing board when there is one. */
export async function toBoardEntries(
  db: CatalogDb,
  entries: CatalogEntry[],
  today: string,
): Promise<BoardListEntry[]> {
  if (!entries.length) return [];
  const { data } = await db
    .from("competitions")
    .select("slug, comp_id, year")
    .in(
      "comp_id",
      entries.map((e) => String(e.compId)),
    );
  const existing = new Map<string, string>(
    ((data ?? []) as { slug: string; comp_id: string; year: number }[]).map((c) => [
      `${c.year}-${c.comp_id}`,
      c.slug,
    ]),
  );
  return entries.map((e) => ({
    slug: existing.get(`${e.year}-${e.compId}`) ?? catalogSlug(e.year, e.compId),
    name: e.name,
    datesLabel: e.datesLabel,
    location: e.location,
    isLiveWindow: isWithinWindow(
      competitionWindow({ startsOn: e.startsOn, endsOn: e.endsOn, datesLabel: e.datesLabel }),
      today,
    ),
  }));
}

export const SEARCH_LIMIT = 25;

/**
 * Search the catalog by name or place ("chicagoland", "lake placid 2026"),
 * newest first; a pasted IJS link or competition number is looked up on IJS
 * immediately, so nobody waits for the sweep.
 */
export async function searchCatalog(
  db: CatalogDb,
  q: string,
  deps: { fetchImpl?: typeof fetch; now?: () => Date } = {},
): Promise<BoardListEntry[]> {
  const now = (deps.now ?? (() => new Date()))();
  const today = dayKeyIn(now);
  const ref = parseIjsReference(q);
  if (ref) {
    const hit = await resolveReference(db, ref, deps);
    return hit ? toBoardEntries(db, [hit], today) : [];
  }
  const words = searchWords(q);
  if (!words.length) return [];
  let query = db.from("ijs_catalog").select("*");
  for (const w of words) {
    query = /^\d{4}$/.test(w)
      ? query.or(`year.eq.${w},name.ilike.%${w}%`)
      : query.or(`name.ilike.%${w}%,location.ilike.%${w}%`);
  }
  const { data, error } = await query
    .order("starts_on", { ascending: false, nullsFirst: false })
    .limit(SEARCH_LIMIT);
  if (error) throw new Error(error.message);
  return toBoardEntries(db, ((data ?? []) as any[]).map(toEntry), today);
}

/** Catalog competitions on today, for "Happening now". */
export async function liveCatalogEntries(db: CatalogDb, today: string): Promise<CatalogEntry[]> {
  const { data } = await db
    .from("ijs_catalog")
    .select("*")
    .lte("starts_on", today)
    .gte("ends_on", today)
    .order("starts_on", { ascending: false })
    .limit(60);
  return ((data ?? []) as any[]).map(toEntry);
}

/**
 * The first open of a catalog board: create its `competitions` row from the
 * catalog (never from anything the caller sends), or reuse the board an admin
 * already set up for the same competition. Returns the row's slug, or null.
 */
export async function materializeCatalogBoard(db: CatalogDb, slug: string): Promise<string | null> {
  const ref = parseCatalogSlug(slug);
  if (!ref) return null;
  const { data: existing } = await db
    .from("competitions")
    .select("slug")
    .eq("year", ref.year)
    .eq("comp_id", String(ref.compId))
    .limit(1)
    .maybeSingle();
  if (existing?.slug) return existing.slug as string;
  const { data: cat } = await db
    .from("ijs_catalog")
    .select("*")
    .eq("year", ref.year)
    .eq("comp_id", ref.compId)
    .maybeSingle();
  if (!cat) return null;
  const { error } = await db.from("competitions").upsert(
    {
      slug,
      ijs_base_url: `${IJS_RESULTS_BASE}/${ref.year}/${ref.compId}`,
      comp_id: String(ref.compId),
      year: ref.year,
      name: cat.name,
      dates_label: cat.dates_label,
      location: cat.location,
      starts_on: cat.starts_on,
      ends_on: cat.ends_on,
      active: true,
    },
    { onConflict: "slug", ignoreDuplicates: true },
  );
  if (error) throw new Error(error.message);
  return slug;
}
