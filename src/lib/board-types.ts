/**
 * Shared shapes for the Live Board. Browser-safe: imported by both the public
 * board routes and the server-side refresher.
 */

/** One judged element from a skater's protocol. */
export interface ProtocolElement {
  planned: string;
  executed: string;
  baseValue: string;
  goe: string;
  score: string;
}

export interface ProtocolComponent {
  name: string;
  unfactored: string;
  factor: string;
}

/** The judged breakdown behind a posted score, as published on the event page. */
export interface SkaterProtocol {
  total: string;
  elementsScore: string;
  componentsScore: string;
  deductionsScore: string;
  elements: ProtocolElement[];
  elementsTotal: { baseValue: string; score: string } | null;
  components: ProtocolComponent[];
  deductions: { name: string; value: string }[];
}

export interface BoardSkater {
  start: number;
  of: number;
  name: string;
  club: string;
  group: string;
  segScore: string;
  total: string;
  place: string;
  /** Overall placement in the event, as published (blank until placed). */
  finalPlace?: string;
  /** Every segment's score for combined events, in published column order. */
  segScores?: { segment: string; score: string; place: string }[];
  protocol?: SkaterProtocol | null;
}



export interface BoardCurrent {
  event: string;
  segment: string;
  status: string;
  skaters: number;
  withdrawn: number;
  done: number;
  startLabel: string;
  startIso: string | null;
  url: string;
  justScored: BoardSkater | null;
  onIce: BoardSkater | null;
  upNext: BoardSkater | null;
  /** Full start order, used to find a viewer's own skater. */
  startOrder: BoardSkater[];
}

export interface BoardNext {
  event: string;
  timeLabel: string;
  startIso: string | null;
  skaters: number | null;
  url: string;
}

export interface BoardRink {
  name: string;
  state: "live" | "idle";
  current: BoardCurrent | null;
  next: BoardNext | null;
  justFinished: {
    event: string;
    winner: { name: string; club: string; score: string } | null;
  } | null;
  alsoLive: string[];
  dayEvents: number;
}

/** One row of the departures board. */
export interface BoardEvent {
  file: string;
  name: string;
  segment: string;
  rink: string;
  timeLabel: string;
  startIso: string | null;
  status: "scheduled" | "live" | "final";
  count: number | null;
  /** Day heading as published, e.g. `Sat Aug 22`. */
  dayLabel: string;
  /** Venue-local `YYYY-MM-DD`, used to group and pick a day. */
  dayKey: string;
  /**
   * Start order with any posted scores. Present for events already fetched;
   * protocols are attached only for the live and most recently finished event
   * on each sheet, which keeps the shared snapshot small.
   */
  results: BoardSkater[];
}

/** Results ordered by final placement — unplaced skaters last. */
export function standingsOf(e: Pick<BoardEvent, "results">): BoardSkater[] {
  const rank = (s: BoardSkater) => {
    const p = Number(s.finalPlace || s.place);
    return Number.isFinite(p) && p > 0 ? p : Number.POSITIVE_INFINITY;
  };
  return [...e.results].sort((a, b) => rank(a) - rank(b) || a.start - b.start);
}


export interface BoardPayload {
  generatedAt: string;
  competition: { name: string; dates: string; location: string; url: string };
  rinks: BoardRink[];
  /** Every event on the competition's current day, in start-time order. */
  schedule: BoardEvent[];
  errors: string[];
}



export interface BoardResponse {
  slug: string;
  /** The competition row's id, for `POST /competitions/{id}/attendance`. Absent for the built-in demo. */
  competitionId?: string;
  name: string;
  datesLabel: string;
  location: string;
  active: boolean;
  isLiveWindow: boolean;
  generatedAt: string | null;
  error: string | null;
  payload: BoardPayload | null;
}

/** Normalise a skater name for comparison: case- and accent-insensitive. */
export function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
