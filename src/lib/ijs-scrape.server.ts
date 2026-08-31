/**
 * Scraper + parser for U.S. Figure Skating IJS leaderboards (ijsLive 2.6.x).
 *
 * The published pages are the only data source: there is no API, and
 * `ijs.usfigureskating.org` sends no CORS headers, so a browser can never read
 * them. Everything here runs server-side.
 *
 * Page shapes handled:
 *  - `index.asp`      — every event: day, start time, name, status, link
 *  - `CATnnnSEGnnn`   — one event: Venue, segment tabs, results table
 *  - variable columns — some events have a Group column, some don't; combined
 *                       events add a Place/Score pair per segment plus a Total
 *  - withdrawals      — place `WD` with a blank Start; excluded from counts
 *
 * Cells are read by CSS class, never by index — column layout varies per event.
 */

import type { SkaterProtocol } from "./board-types";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

export const LIVE_STATUS = "live unofficial";
export const DONE_STATUSES = ["final", "unofficial"];
export const RINK_TZ = "America/New_York";

/* ------------------------------------------------------------------ fetch */

/**
 * The pages declare `charset=iso-8859-1`. Decoding as UTF-8 mangles accented
 * names, so decode the raw bytes as latin-1 (windows-1252 is its superset and
 * is what browsers actually apply).
 */
function decodeLatin1(buf: ArrayBuffer): string {
  try {
    return new TextDecoder("windows-1252").decode(buf);
  } catch {
    const bytes = new Uint8Array(buf);
    let out = "";
    for (let i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]!);
    return out;
  }
}

export async function fetchPage(url: string, timeoutMs = 15_000): Promise<string> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Cache-Control": "no-cache" },
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
    return decodeLatin1(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------------------------------------------------------- helpers */

const TAG = /<[^>]+>/g;

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function unescapeHtml(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m);
}

/** Strip tags/entities from a cell and normalise whitespace. */
export function text(s: string): string {
  return unescapeHtml(s.replace(TAG, " "))
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** First class token of a tag whose class attribute may be quoted or bare. */
function attrClass(attrs: string): string {
  const m = /class\s*=\s*"([^"]*)"/i.exec(attrs) ?? /class\s*=\s*([^\s>]+)/i.exec(attrs);
  if (!m) return "";
  const parts = (m[1] ?? "").split(/\s+/).filter(Boolean);
  return (parts[0] ?? "").toLowerCase();
}

function isNum(s: string | undefined): boolean {
  return !!s && /^\d+(\.\d+)?$/.test(s.trim());
}

function matchAll(re: RegExp, doc: string): RegExpExecArray[] {
  const out: RegExpExecArray[] = [];
  let m: RegExpExecArray | null;
  const r = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  while ((m = r.exec(doc)) !== null) {
    out.push(m);
    if (m.index === r.lastIndex) r.lastIndex += 1;
  }
  return out;
}

/* ----------------------------------------------------------- time helpers */

const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

/**
 * Turn a venue-local wall clock into a real instant. IJS publishes schedules
 * in venue time (Eastern for these competitions), so guess the UTC offset and
 * correct it by formatting the guess back in the venue zone.
 */
function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number): Date {
  let guess = Date.UTC(y, mo, d, h + 4, mi);
  for (let i = 0; i < 2; i += 1) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: RINK_TZ,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    }).formatToParts(new Date(guess));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    const asUtc = Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour") % 24,
      get("minute"),
    );
    const wanted = Date.UTC(y, mo, d, h, mi);
    if (asUtc === wanted) break;
    guess += wanted - asUtc;
  }
  return new Date(guess);
}

/** `'Sat Aug 22'` + `'11:55 AM'` -> instant, in venue time. */
export function toDate(dayLabel: string, timeLabel: string, year: number): Date | null {
  if (!dayLabel || !timeLabel) return null;
  const dm = /([A-Za-z]{3})[a-z]*\s+(\d{1,2})/.exec(dayLabel);
  const tm = /(\d{1,2}):(\d{2})\s*([AaPp])/.exec(timeLabel.replace(/\./g, ""));
  if (!dm || !tm) return null;
  const mo = MONTHS.indexOf(dm[1]!.toLowerCase());
  if (mo < 0) return null;
  let hour = Number(tm[1]);
  const isPm = tm[3]!.toLowerCase() === "p";
  if (hour === 12) hour = 0;
  if (isPm) hour += 12;
  return zonedToUtc(year, mo, Number(dm[2]), hour, Number(tm[2]));
}

/* -------------------------------------------------------------- index.asp */

export interface IjsCompetition {
  name: string;
  dates: string;
  location: string;
}

export interface IjsEvent {
  day: string;
  timeLabel: string;
  name: string;
  status: string;
  file: string;
  startAt: Date | null;
  venue?: string;
}

export function parseIndex(
  doc: string,
  year: number,
): { competition: IjsCompetition; events: IjsEvent[] } {
  const title = /<H2[^>]*class=["']?title["']?[^>]*>(.*?)<\/H2>/is.exec(doc);
  const dates = /<H3[^>]*class=["']?date["']?[^>]*>(.*?)<\/H3>/is.exec(doc);
  const h3s = matchAll(/<H3[^>]*>(.*?)<\/H3>/gis, doc).map((m) => text(m[1] ?? ""));
  const competition: IjsCompetition = {
    name: title ? text(title[1] ?? "") : "Competition",
    dates: dates ? text(dates[1] ?? "") : "",
    location: h3s.length ? (h3s[h3s.length - 1] ?? "") : "",
  };

  const idx = doc.indexOf("id=daySort");
  if (idx < 0) return { competition, events: [] };
  const table = doc.slice(idx).split(/<\/TABLE>/i)[0] ?? "";

  const events: IjsEvent[] = [];
  let day = "";
  for (const rowMatch of matchAll(/<TR[^>]*>(.*?)<\/TR>/gis, table)) {
    const row = rowMatch[1] ?? "";
    const cells: Record<string, string> = {};
    for (const cell of matchAll(/<TD([^>]*)>(.*?)<\/TD>/gis, row)) {
      const key = attrClass(cell[1] ?? "");
      if (!(key in cells)) cells[key] = text(cell[2] ?? "");
    }
    if (cells["date"]) day = cells["date"]; // rowspan: only on the first row of a day
    const link = /href=["']?([A-Za-z0-9_]+\.html)/i.exec(row);
    if (!link || !cells["event"]) continue;
    const timeLabel = cells["time"] ?? "";
    events.push({
      day,
      timeLabel,
      name: cells["event"] ?? "",
      status: cells["stat"] ?? "",
      file: link[1]!,
      startAt: toDate(day, timeLabel, year),
    });
  }
  return { competition, events };
}

/* ------------------------------------------------------------- event page */

export interface IjsSkater {
  place: string;
  group: string;
  start: number;
  name: string;
  club: string;
  segScore: string;
  segPlace: string;
  /** Every published segment column, in page order. */
  segScores: { segment: string; score: string; place: string }[];
  total: string;
  of: number;
  protocol: SkaterProtocol | null;
}


export interface IjsEventPage {
  event: string;
  venue: string;
  startLabel: string;
  segments: { name: string; active: boolean; status: string }[];
  segment: string;
  status: string;
  skaters: IjsSkater[];
  count: number;
  withdrawn: number;
}

/* --------------------------------------------------------- score protocol */

/** Body rows of one detail table, as class-keyed cells. */
function detailRows(block: string, table: string): { cls: string; val: string }[][] {
  const m = new RegExp(
    `<TABLE[^>]*class=["']?${table}[^>]*>([\\s\\S]*?)</TABLE>`,
    "i",
  ).exec(block);
  if (!m) return [];
  const body = /<TBODY[^>]*>([\s\S]*?)<\/TBODY>/i.exec(m[1] ?? "")?.[1] ?? m[1] ?? "";
  return matchAll(/<TR[^>]*>([\s\S]*?)<\/TR>/gis, body)
    .filter((r) => !/<TH[\s>]/i.test(r[1] ?? ""))
    .map((r) =>
      matchAll(/<TD([^>]*)>([\s\S]*?)<\/TD>/gis, r[1] ?? "").map((c) => ({
        cls: attrClass(c[1] ?? ""),
        val: text(c[2] ?? ""),
      })),
    );
}

/**
 * The judged breakdown lives in a hidden `TR class=child` row next to each
 * skater — same page, no extra request. Deductions that scored zero are
 * dropped: IJS prints the whole catalogue whether or not it applied.
 */
export function parseProtocol(block: string): SkaterProtocol | null {
  const sum = detailRows(block, "detailScoreSum")[0];
  if (!sum || sum.length < 5) return null;

  const elements: SkaterProtocol["elements"] = [];
  let elementsTotal: SkaterProtocol["elementsTotal"] = null;
  for (const row of detailRows(block, "detailScoreElm")) {
    if (row.some((c) => c.cls === "totbv")) {
      elementsTotal = {
        baseValue: row.find((c) => c.cls === "bvv")?.val ?? "",
        score: row.find((c) => c.cls === "psv")?.val ?? "",
      };
      continue;
    }
    if (row.length < 6) continue;
    elements.push({
      planned: row[0]?.val ?? "",
      executed: row[1]?.val ?? "",
      baseValue: row[2]?.val ?? "",
      goe: row[4]?.val ?? "",
      score: row[5]?.val ?? "",
    });
  }

  const components: SkaterProtocol["components"] = [];
  for (const row of detailRows(block, "detailScoreCmp")) {
    if (row.some((c) => c.cls === "totcomp")) continue;
    if (row[0]?.cls !== "t") continue;
    components.push({
      name: row[0].val,
      unfactored: row[1]?.val ?? "",
      factor: row[2]?.val ?? "",
    });
  }

  const deductions: SkaterProtocol["deductions"] = [];
  for (const row of detailRows(block, "detailScoreDed")) {
    if (row[0]?.cls !== "t") continue;
    const value = row[1]?.val ?? "";
    if (!value || Number(value) === 0) continue;
    deductions.push({ name: row[0].val, value });
  }

  return {
    total: sum[0]?.val ?? "",
    elementsScore: sum[1]?.val ?? "",
    componentsScore: sum[2]?.val ?? "",
    deductionsScore: sum[4]?.val ?? "",
    elements,
    elementsTotal,
    components,
    deductions,
  };
}

export function parseEvent(doc: string): IjsEventPage {
  const h1 = /<H1[^>]*>(.*?)<\/H1>/is.exec(doc);
  const venue = /Venue:\s*<SPAN[^>]*>(.*?)<\/SPAN>/is.exec(doc);
  const startLabel = /class=["']?segStartTime["']?[^>]*>(.*?)<\/SPAN>/is.exec(doc);

  const segments: IjsEventPage["segments"] = [];
  for (const li of matchAll(/<LI[^>]*class=["']?seg\d+[^>]*>(.*?)<\/LI>/gis, doc)) {
    const block = li[1] ?? "";
    const strong = /<STRONG[^>]*>(.*?)<\/STRONG>/is.exec(block);
    const status = /<SPAN[^>]*>(.*?)<\/SPAN>/is.exec(block);
    segments.push({
      name: strong ? text(strong[1] ?? "") : "",
      active: /class\s*=\s*["']?activeSeg/i.test(block),
      status: status ? text(status[1] ?? "") : "",
    });
  }
  const active =
    segments.find((s) => s.active) ??
    (segments.length ? segments[segments.length - 1] : undefined);
  const segment = active?.name ?? "";

  // Multi-segment score pairs: column order comes from the `colspan=2 class=top`
  // headers, which need not match the tab order.
  const colSegs = matchAll(
    /<TH[^>]*colspan=["']?2["']?[^>]*class=["']?top["']?[^>]*>(.*?)<\/TH>/gis,
    doc,
  ).map((m) => text(m[1] ?? ""));
  let activeCol = colSegs.indexOf(segment);
  if (activeCol < 0) activeCol = colSegs.length ? colSegs.length - 1 : 0;

  const skaters: IjsSkater[] = [];
  let withdrawn = 0;

  // Parent rows carry the summary; everything between one parent row and the
  // next is that skater's hidden detail block.
  const parents = matchAll(/<TR[^>]*class=["']?parent["']?[^>]*>(.*?)<\/TR>/gis, doc);
  for (let p = 0; p < parents.length; p += 1) {
    const rowMatch = parents[p]!;
    const row = rowMatch[1] ?? "";
    const blockStart = rowMatch.index + rowMatch[0].length;
    const blockEnd = p + 1 < parents.length ? parents[p + 1]!.index : doc.length;
    const detailBlock = doc.slice(blockStart, blockEnd);
    const tds = matchAll(/<TD([^>]*)>(.*?)<\/TD>/gis, row)
      .map((m) => ({ cls: attrClass(m[1] ?? ""), val: text(m[2] ?? "") }))
      .filter((c) => c.cls !== "expb"); // drop the detail toggle


    const rest = [...tds];
    let place = "";
    let group = "";
    let startRaw = "";
    let name = "";
    let club = "";

    if (rest[0]?.cls === "place") place = rest.shift()!.val;
    if (rest[0]?.cls === "group") group = rest.shift()!.val;
    if (rest[0]?.cls === "start") startRaw = rest.shift()!.val;
    if (rest[0]?.cls === "name") {
      const raw = rest.shift()!.val;
      const [first, ...tail] = raw.split(",");
      name = (first ?? "").trim();
      club = tail.join(",").trim();
    }

    const vals = rest.map((c) => c.val);
    let segScore = "";
    let segPlace = place;
    let total = "";
    if (colSegs.length > 1) {
      const pairs: [string, string][] = [];
      for (let i = 0; i + 1 < vals.length && pairs.length < colSegs.length; i += 2) {
        pairs.push([vals[i] ?? "", vals[i + 1] ?? ""]);
      }
      const pair = pairs[activeCol];
      segPlace = pair?.[0] ?? "";
      segScore = pair?.[1] ?? "";
      total = vals[colSegs.length * 2] ?? "";
    } else {
      segScore = vals[0] ?? "";
    }
    if (!isNum(segScore)) segScore = "";
    if (!isNum(total)) total = "";

    if (["WD", "DSQ", "SCR", "DNS"].includes(place.toUpperCase()) || !isNum(startRaw)) {
      withdrawn += 1;
      continue;
    }

    skaters.push({
      place,
      group,
      start: Number(startRaw),
      name,
      club,
      segScore,
      segPlace,
      total,
      of: 0,
      protocol: segScore ? parseProtocol(detailBlock) : null,
    });

  }

  skaters.sort((a, b) => a.start - b.start);
  for (const s of skaters) s.of = skaters.length;

  return {
    event: h1 ? text(h1[1] ?? "") : "",
    venue: venue ? text(venue[1] ?? "") : "",
    startLabel: startLabel ? text(startLabel[1] ?? "") : "",
    segments,
    segment,
    status: active?.status ?? "",
    skaters,
    count: skaters.length,
    withdrawn,
  };
}

/* ------------------------------------------------------------- inference */

/**
 * IJS never publishes who is on the ice. Infer it: the highest start number
 * with a posted score is the last completed skate, so the next skater in start
 * order is presumed to be on the ice. Scores post 1–2 minutes late, so during
 * that gap the inferred skater is really the one who just stepped off — which
 * is why the UI always shows the inference next to the confirmed fact.
 */
export function lanes(ev: IjsEventPage): {
  justScored: IjsSkater | null;
  onIce: IjsSkater | null;
  upNext: IjsSkater | null;
  done: number;
} {
  const sk = ev.skaters;
  const scored = sk.filter((s) => s.segScore);
  const just = scored.length
    ? scored.reduce((a, b) => (b.start > a.start ? b : a))
    : null;
  const i = just ? sk.indexOf(just) + 1 : 0;
  return {
    justScored: just,
    onIce: sk[i] ?? null,
    upNext: sk[i + 1] ?? null,
    done: scored.length,
  };
}

export function topFinishers(ev: IjsEventPage, n = 3): IjsSkater[] {
  return ev.skaters
    .filter((s) => isNum(s.place))
    .sort((a, b) => Number(a.place) - Number(b.place))
    .slice(0, n);
}
