/**
 * A built-in demo competition so the Live Board can be viewed before any real
 * competition exists in the database. Browser-safe: no scraper, no network,
 * no database. Times are derived from `Date.now()` so countdowns stay sensible
 * whenever the page is opened.
 */
import type {
  BoardCurrent,
  BoardEvent,
  BoardPayload,
  BoardResponse,
  BoardRink,
  BoardSkater,
  SkaterProtocol,
} from "./board-types";

export const DEMO_SLUG = "demo";

const DEMO_NAME = "Demo Competition (sample data)";
const DEMO_DATES = "Sample day";
const DEMO_LOCATION = "Northwind Skating Club, Lakeside, MI";

function iso(minutesFromNow: number): string {
  return new Date(Date.now() + minutesFromNow * 60_000).toISOString();
}

function timeLabel(minutesFromNow: number): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(Date.now() + minutesFromNow * 60_000));
}

/** A plausible free skate protocol, scaled so the totals match `score`. */
function protocolFor(score: string): SkaterProtocol {
  const total = Number(score);
  const elementsScore = (total * 0.55).toFixed(2);
  const componentsScore = (total * 0.45).toFixed(2);
  return {
    total: score,
    elementsScore,
    componentsScore,
    deductionsScore: "0.00",
    elements: [
      { planned: "2A", executed: "2A", baseValue: "3.30", goe: "0.44", score: "3.74" },
      { planned: "3T", executed: "3T", baseValue: "4.20", goe: "-0.56", score: "3.64" },
      { planned: "FCSp3", executed: "FCSp3", baseValue: "2.80", goe: "0.28", score: "3.08" },
      { planned: "2Lz+2Lo", executed: "2Lz+2Lo", baseValue: "3.80", goe: "0.21", score: "4.01" },
      { planned: "StSq2", executed: "StSq2", baseValue: "2.60", goe: "0.35", score: "2.95" },
      { planned: "2F", executed: "2F", baseValue: "1.80", goe: "0.18", score: "1.98" },
      { planned: "CCoSp4", executed: "CCoSp4", baseValue: "3.50", goe: "0.47", score: "3.97" },
    ],
    elementsTotal: { baseValue: "22.00", score: elementsScore },
    components: [
      { name: "Composition", unfactored: "5.25", factor: "1.00" },
      { name: "Presentation", unfactored: "5.00", factor: "1.00" },
      { name: "Skating Skills", unfactored: "5.50", factor: "1.00" },
    ],
    deductions: [],
  };
}

function skater(
  start: number,
  of: number,
  name: string,
  club: string,
  opts: { segScore?: string; total?: string; place?: string; finalPlace?: string } = {},
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
    finalPlace: opts.finalPlace ?? opts.place ?? "",
    protocol: opts.segScore ? protocolFor(opts.segScore) : null,
  };
}

const A_ORDER: BoardSkater[] = [
  skater(1, 12, "Maren Holloway", "Northwind SC", {
    segScore: "54.18",
    total: "54.18",
    place: "5",
  }),
  skater(2, 12, "Pia Castellanos", "Riverbend FSC", {
    segScore: "58.02",
    total: "58.02",
    place: "3",
  }),
  skater(3, 12, "Lucia Ferrante", "Lakeshore SA", {
    segScore: "49.77",
    total: "49.77",
    place: "7",
  }),
  skater(4, 12, "Odette Marchand", "Pinecrest SC", {
    segScore: "51.30",
    total: "51.30",
    place: "6",
  }),
  skater(5, 12, "Zara Kowalczyk", "Northwind SC", {
    segScore: "60.11",
    total: "60.11",
    place: "2",
  }),
  skater(6, 12, "Ines Villanueva", "Harborview FSC", {
    segScore: "56.44",
    total: "56.44",
    place: "4",
  }),
  skater(7, 12, "Clementine Voss", "Northwind SC", {
    segScore: "62.41",
    total: "62.41",
    place: "1",
  }),
  skater(8, 12, "Greta Halvorsen", "Lakeshore SA"),
  skater(9, 12, "Annika Bergstrom", "Riverbend FSC"),
  skater(10, 12, "Tobias Fairbank", "Northwind SC"),
  skater(11, 12, "Wren Delacroix", "Pinecrest SC"),
  skater(12, 12, "Thea Solberg", "Harborview FSC"),
];

const C_ORDER: BoardSkater[] = [
  skater(1, 8, "Theo Marsh", "Harborview FSC"),
  skater(2, 8, "Barnaby Quill", "Northwind SC"),
  skater(3, 8, "Kaito Sorensen", "Riverbend FSC"),
  skater(4, 8, "Elio Sandoval", "Pinecrest SC"),
];

const B_DONE: BoardSkater[] = [
  skater(1, 6, "Elsie Varga", "Northwind SC", { segScore: "38.92", total: "38.92", place: "1" }),
  skater(2, 6, "Jamie Gilmore", "Harborview FSC", {
    segScore: "35.10",
    total: "35.10",
    place: "2",
  }),
  skater(3, 6, "Sam Ashby", "Pinecrest SC", { segScore: "31.44", total: "31.44", place: "3" }),
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
  justScored: A_ORDER[6]!,
  onIce: A_ORDER[7]!,
  upNext: A_ORDER[8]!,
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
  onIce: C_ORDER[0]!,
  upNext: C_ORDER[1]!,
  startOrder: C_ORDER,
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
      winner: { name: "Elsie Varga", club: "Northwind SC", score: "38.92" },
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

function ev(
  file: string,
  name: string,
  segment: string,
  rink: string,
  minutes: number,
  status: BoardEvent["status"],
  results: BoardSkater[] = [],
  count: number | null = null,
): BoardEvent {
  const startIso = iso(minutes);
  const at = new Date(startIso);
  return {
    file,
    name,
    segment,
    rink,
    timeLabel: timeLabel(minutes),
    startIso,
    status,
    count: count ?? (results.length || null),
    dayLabel: new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(at),
    dayKey: new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(at),
    results,
  };
}

const DAY_MIN = 60 * 24;

/** Yesterday's finished event, so past-day standings are visible in the demo. */
const YESTERDAY_RESULTS: BoardSkater[] = [
  skater(1, 5, "Greta Lindgren", "Northwind SC", {
    segScore: "61.44",
    total: "61.44",
    place: "2",
  }),
  skater(2, 5, "Elowen Marsh", "Harborview FSC", {
    segScore: "64.90",
    total: "64.90",
    place: "1",
  }),
  skater(3, 5, "Ingrid Sandhu", "Pinecrest SC", { segScore: "58.31", total: "58.31", place: "3" }),
  skater(4, 5, "Tamsin Whitlock", "Riverbend FSC", {
    segScore: "52.07",
    total: "52.07",
    place: "4",
  }),
  skater(5, 5, "Juno Aldridge", "Lakeshore SA", {
    segScore: "47.85",
    total: "47.85",
    place: "5",
  }),
];

const SCHEDULE: BoardEvent[] = [
  ev(
    "d0a",
    "Intermediate Ladies",
    "Short Program",
    "A Rink",
    -DAY_MIN - 200,
    "final",
    YESTERDAY_RESULTS,
    5,
  ),
  ev("d0b", "Juvenile Boys", "Short Program", "C Rink", -DAY_MIN - 120, "final", [], 8),
  ev("d1", "Pre-Juvenile Ladies", "Free Skate", "B Rink", -120, "final", B_DONE, 6),
  ev("d2", "Aspire 3 Boys", "Free Skate", "C Rink", -95, "final", [], 5),
  ev("d3", "Intermediate Ladies", "Free Skate", "A Rink", -52, "live", A_ORDER, 12),
  ev("d4", "Juvenile Boys", "Free Skate", "C Rink", -6, "live", C_ORDER, 8),
  ev("d5", "Preliminary Ladies", "Free Skate", "B Rink", 21, "scheduled", [], 18),
  ev("d6", "Novice Ladies", "Short Program", "A Rink", 38, "scheduled", [], 15),
  ev("d7", "Juvenile Ladies", "Free Skate", "C Rink", 46, "scheduled", [], 22),
  ev("d8", "Novice Men", "Short Program", "A Rink", 95, "scheduled", [], 9),
  ev("d9", "Junior Ladies", "Free Skate", "B Rink", 150, "scheduled", [], 11),
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
    schedule: SCHEDULE,
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
