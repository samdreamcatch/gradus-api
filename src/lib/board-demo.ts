/**
 * A built-in demo competition so the Live Board can be viewed before any real
 * competition exists in the database. Browser-safe: no scraper, no network,
 * no database. Times are derived from `Date.now()` so countdowns stay sensible
 * whenever the page is opened.
 */
import type {
  BoardCurrent,
  BoardPayload,
  BoardResponse,
  BoardRink,
  BoardSkater,
} from "./board-types";

export const DEMO_SLUG = "demo";

const DEMO_NAME = "Demo Competition (sample data)";
const DEMO_DATES = "Sample day";
const DEMO_LOCATION = "Detroit Skating Club, Bloomfield Hills, MI";

function iso(minutesFromNow: number): string {
  return new Date(Date.now() + minutesFromNow * 60_000).toISOString();
}

function timeLabel(minutesFromNow: number): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(Date.now() + minutesFromNow * 60_000));
}

function skater(
  start: number,
  of: number,
  name: string,
  club: string,
  opts: { segScore?: string; total?: string; place?: string } = {},
): BoardSkater {
  return {
    start,
    of,
    name,
    club,
    group: "",
    segScore: opts.segScore ?? "",
    total: opts.total ?? "",
    place: opts.place ?? "",
  };
}

const A_ORDER: { start: number; name: string; club: string }[] = [
  { start: 1, name: "Harper Lindqvist", club: "Detroit SC" },
  { start: 2, name: "Mia Okonkwo", club: "Ann Arbor FSC" },
  { start: 3, name: "Sofia Renaldi", club: "Onyx-Suburban SA" },
  { start: 4, name: "Claire Beaumont", club: "Lansing SC" },
  { start: 5, name: "Ava Petrenko", club: "Detroit SC" },
  { start: 6, name: "Emilia Vasquez", club: "Fraser FSC" },
  { start: 7, name: "Josephine Marr", club: "Detroit SC" },
  { start: 8, name: "Nora Donaldson", club: "Onyx-Suburban SA" },
  { start: 9, name: "Addie DiMuro", club: "Ann Arbor FSC" },
  { start: 10, name: "Leon Gillespie", club: "Detroit SC" },
  { start: 11, name: "Wren Castellano", club: "Lansing SC" },
  { start: 12, name: "Talia Bergström", club: "Fraser FSC" },
];

const A_CURRENT: BoardCurrent = {
  event: "Intermediate Ladies",
  segment: "Free Skate",
  status: "In Progress",
  skaters: 12,
  withdrawn: 0,
  done: 7,
  startLabel: timeLabel(-52),
  startIso: iso(-52),
  url: "#",
  justScored: skater(7, 12, "Josephine Marr", "Detroit SC", {
    segScore: "62.41",
    total: "62.41",
    place: "1",
  }),
  onIce: skater(8, 12, "Nora Donaldson", "Onyx-Suburban SA"),
  upNext: skater(9, 12, "Addie DiMuro", "Ann Arbor FSC"),
  startOrder: A_ORDER,
};

const C_CURRENT: BoardCurrent = {
  event: "Juvenile Boys",
  segment: "Free Skate",
  status: "In Progress",
  skaters: 8,
  withdrawn: 1,
  done: 0,
  startLabel: timeLabel(-6),
  startIso: iso(-6),
  url: "#",
  justScored: null,
  onIce: skater(1, 8, "Theo Marchetti", "Fraser FSC"),
  upNext: skater(2, 8, "Bennett Shaw", "Detroit SC"),
  startOrder: [
    { start: 1, name: "Theo Marchetti", club: "Fraser FSC" },
    { start: 2, name: "Bennett Shaw", club: "Detroit SC" },
    { start: 3, name: "Kai Nakamura", club: "Ann Arbor FSC" },
    { start: 4, name: "Elias Brandt", club: "Lansing SC" },
  ],
};

const RINKS: BoardRink[] = [
  {
    name: "A Rink",
    state: "live",
    current: A_CURRENT,
    next: {
      event: "Novice Ladies Short Program",
      timeLabel: timeLabel(38),
      startIso: iso(38),
      skaters: 15,
      url: "#",
    },
    justFinished: null,
    alsoLive: [],
    dayEvents: 9,
  },
  {
    name: "B Rink",
    state: "idle",
    current: null,
    next: {
      event: "Preliminary Ladies Free Skate",
      timeLabel: timeLabel(21),
      startIso: iso(21),
      skaters: 18,
      url: "#",
    },
    justFinished: {
      event: "Pre-Juvenile Ladies Free Skate",
      winner: { name: "Isla Fontaine", club: "Detroit SC", score: "38.92" },
    },
    alsoLive: [],
    dayEvents: 7,
  },
  {
    name: "C Rink",
    state: "live",
    current: C_CURRENT,
    next: {
      event: "Juvenile Ladies Free Skate",
      timeLabel: timeLabel(46),
      startIso: iso(46),
      skaters: 22,
      url: "#",
    },
    justFinished: null,
    alsoLive: [],
    dayEvents: 6,
  },
];

export function buildDemoBoard(): BoardResponse {
  const payload: BoardPayload = {
    generatedAt: new Date().toISOString(),
    competition: {
      name: DEMO_NAME,
      dates: DEMO_DATES,
      location: DEMO_LOCATION,
      url: "#",
    },
    rinks: RINKS,
    errors: [],
  };

  return {
    slug: DEMO_SLUG,
    name: DEMO_NAME,
    datesLabel: DEMO_DATES,
    location: DEMO_LOCATION,
    active: true,
    isLiveWindow: true,
    generatedAt: payload.generatedAt,
    error: null,
    payload,
  };
}

export const DEMO_LIST_ENTRY = {
  slug: DEMO_SLUG,
  name: DEMO_NAME,
  datesLabel: DEMO_DATES,
  location: DEMO_LOCATION,
  isLiveWindow: true,
};
