/**
 * Shared shapes for the Live Board. Browser-safe: imported by both the public
 * board routes and the server-side refresher.
 */

export interface BoardSkater {
  start: number;
  of: number;
  name: string;
  club: string;
  group: string;
  segScore: string;
  total: string;
  place: string;
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
  startOrder: { start: number; name: string; club: string }[];
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

export interface BoardPayload {
  generatedAt: string;
  competition: { name: string; dates: string; location: string; url: string };
  rinks: BoardRink[];
  errors: string[];
}

export interface BoardResponse {
  slug: string;
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
