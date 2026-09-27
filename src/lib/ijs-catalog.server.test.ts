import { describe, expect, it } from "bun:test";
import {
  BACKOFF_FIRST_MINUTES,
  SEED_TOP_ID,
  SWEEP_BATCH,
  WINDOW_BELOW,
  catalogRowFromIndex,
  catalogSlug,
  materializeCatalogBoard,
  parseCatalogSlug,
  parseIjsReference,
  probeIndex,
  searchWords,
  sweepCatalog,
  sweepYears,
} from "./ijs-catalog.server";

function indexPage(name: string) {
  return `
    <H1>${name}</H1>
    <H3>09/10/2026 - 09/13/2026 (EDT)</H3>
    <H4>Robert Crown Center, Evanston, IL</H4>
    <TABLE id=daySort><TBODY>
      <TR><TD class=date>Thu Sep 10</TD><TD class=time>8:00 AM</TD>
      <TD class=event>Juvenile Girls</TD><TD class=stat><A href=CAT001SEG001.html>Start order</A></TD></TR>
    </TBODY></TABLE>
    <P><FONT SIZE=-1>Thursday, Sep 10, 2026, 7:45 AM Central Daylight Time</FONT><!-- Competition local time --></P>
  `;
}

/** A minimal in-memory PostgREST stand-in for the calls the catalog makes. */
function fakeDb(seed: Record<string, Record<string, any>[]> = {}) {
  const tables: Record<string, Record<string, any>[]> = { ...seed };
  const rows = (t: string) => (tables[t] ??= []);
  type Filter = (r: Record<string, any>) => boolean;

  function query(table: string) {
    const filters: Filter[] = [];
    let patch: Record<string, any> | null = null;
    let order: { col: string; asc: boolean } | null = null;
    let limit = Infinity;
    const matching = () => {
      let out = rows(table).filter((r) => filters.every((f) => f(r)));
      if (order) {
        const { col, asc } = order;
        out = [...out].sort(
          (a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (asc ? 1 : -1),
        );
      }
      return out.slice(0, limit);
    };
    const run = () => {
      const hit = matching();
      if (patch) for (const r of hit) Object.assign(r, patch);
      return hit;
    };
    const q: any = {
      select: () => q,
      eq: (c: string, v: any) => (filters.push((r) => String(r[c]) === String(v)), q),
      gte: (c: string, v: any) => (filters.push((r) => r[c] >= v), q),
      lte: (c: string, v: any) => (filters.push((r) => r[c] !== null && r[c] <= v), q),
      in: (c: string, vs: any[]) => (filters.push((r) => vs.map(String).includes(String(r[c]))), q),
      or: (expr: string) => {
        const parts = expr.split(",").map((p) => p.split("."));
        filters.push((r) =>
          parts.some(([col, op, ...rest]) => {
            const v = rest.join(".");
            if (op === "is") return r[col!] === null || r[col!] === undefined;
            if (op === "lt") return r[col!] < v;
            if (op === "eq") return String(r[col!]) === v;
            if (op === "ilike")
              return String(r[col!] ?? "")
                .toLowerCase()
                .includes(v.replace(/%/g, ""));
            return false;
          }),
        );
        return q;
      },
      order: (col: string, o: { ascending: boolean }) => ((order = { col, asc: o.ascending }), q),
      limit: (n: number) => ((limit = n), q),
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      update: (p: Record<string, any>) => ((patch = p), q),
      upsert: async (
        row: Record<string, any>,
        opts: { onConflict: string; ignoreDuplicates?: boolean },
      ) => {
        const keys = opts.onConflict.split(",");
        const existing = rows(table).find((r) =>
          keys.every((k) => String(r[k]) === String(row[k])),
        );
        if (existing) {
          if (!opts.ignoreDuplicates) Object.assign(existing, row);
        } else rows(table).push({ first_seen_at: "now", ...row });
        return { data: null, error: null };
      },
      then: (resolve: (v: unknown) => void) => resolve({ data: run(), error: null }),
    };
    return q;
  }
  return { db: { from: (t: string) => query(t) }, tables };
}

/** IJS stand-in: the ids in `pages` exist, `trouble` ids answer 503, the rest 404. */
function fakeIjs(pages: Record<number, string>, trouble: number[] = []) {
  const seen: number[] = [];
  const fetchImpl = (async (url: string) => {
    const id = Number(/\/(\d+)\/index\.asp$/.exec(url)?.[1]);
    seen.push(id);
    if (trouble.includes(id)) return new Response("busy", { status: 503 });
    if (pages[id]) return new Response(pages[id], { status: 200 });
    return new Response("nope", { status: 404 });
  }) as unknown as typeof fetch;
  return { fetchImpl, seen };
}

const NOON = new Date("2026-09-27T16:00:00Z");

describe("IJS catalog helpers", () => {
  it("round-trips catalog slugs", () => {
    expect(catalogSlug(2026, 36546)).toBe("ijs-2026-36546");
    expect(parseCatalogSlug("ijs-2026-36546")).toEqual({ year: 2026, compId: 36546 });
    expect(parseCatalogSlug("lake-placid")).toBeNull();
  });

  it("reads pasted links and bare numbers", () => {
    expect(
      parseIjsReference("https://ijs.usfigureskating.org/leaderboard/results/2026/36546/index.asp"),
    ).toEqual({ year: 2026, compId: 36546 });
    expect(parseIjsReference(" 36546 ")).toEqual({ year: null, compId: 36546 });
    expect(parseIjsReference("lake placid")).toBeNull();
  });

  it("keeps search words safe for a PostgREST filter", () => {
    expect(searchWords("Lake Placid, (2026)%")).toEqual(["lake", "placid", "2026"]);
  });

  it("sweeps next year's folder only from mid-December", () => {
    expect(sweepYears(NOON)).toEqual([2026]);
    expect(sweepYears(new Date("2026-12-20T16:00:00Z"))).toEqual([2026, 2027]);
  });

  it("builds a catalog row from an index page, with the first event's start", () => {
    const row = catalogRowFromIndex(
      indexPage("2026 Greater Chicagoland Fall Invitational"),
      2026,
      36546,
    );
    expect(row).toMatchObject({
      year: 2026,
      comp_id: 36546,
      name: "2026 Greater Chicagoland Fall Invitational",
      starts_on: "2026-09-10",
      ends_on: "2026-09-13",
      location: "Robert Crown Center, Evanston, IL",
    });
    expect(row?.first_event_at).toBe("2026-09-10T13:00:00.000Z");
  });
});

describe("probeIndex", () => {
  it("tells found, missing and trouble apart, and never throws", async () => {
    const { fetchImpl } = fakeIjs({ 1: indexPage("A") }, [3]);
    expect((await probeIndex(2026, 1, fetchImpl)).kind).toBe("found");
    expect((await probeIndex(2026, 2, fetchImpl)).kind).toBe("missing");
    expect((await probeIndex(2026, 3, fetchImpl)).kind).toBe("trouble");
    const boom = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    expect((await probeIndex(2026, 4, boom)).kind).toBe("trouble");
  });
});

describe("sweepCatalog", () => {
  it("checks 25 ids from the start of a fresh window and catalogs what it finds", async () => {
    const lo = SEED_TOP_ID - WINDOW_BELOW;
    const { db, tables } = fakeDb();
    const ijs = fakeIjs({ [lo + 3]: indexPage("Found One") });
    const result = await sweepCatalog({ db, fetchImpl: ijs.fetchImpl, now: () => NOON });
    expect(result).toMatchObject({ year: 2026, probed: SWEEP_BATCH, found: 1, trouble: 0 });
    expect(ijs.seen[0]).toBe(lo);
    expect(tables.ijs_catalog?.[0]).toMatchObject({ comp_id: lo + 3, name: "Found One" });
    expect(tables.ijs_catalog_sweep?.[0]).toMatchObject({
      cursor: lo + SWEEP_BATCH,
      leased_until: null,
    });
  });

  it("skips ids already in the catalog", async () => {
    const lo = SEED_TOP_ID - WINDOW_BELOW;
    const { db } = fakeDb({ ijs_catalog: [{ year: 2026, comp_id: lo, name: "Known" }] });
    const ijs = fakeIjs({});
    await sweepCatalog({ db, fetchImpl: ijs.fetchImpl, now: () => NOON });
    expect(ijs.seen).not.toContain(lo);
    expect(ijs.seen).toHaveLength(SWEEP_BATCH);
  });

  it("pauses after two troubled answers, doubling the pause each time", async () => {
    const lo = SEED_TOP_ID - WINDOW_BELOW;
    const { db, tables } = fakeDb();
    const ijs = fakeIjs({}, [lo + 1, lo + 2]);
    const first = await sweepCatalog({ db, fetchImpl: ijs.fetchImpl, now: () => NOON });
    expect(first.trouble).toBe(2);
    const state = tables.ijs_catalog_sweep![0]!;
    expect(state.backoff_minutes).toBe(BACKOFF_FIRST_MINUTES);
    expect(state.cursor).toBe(lo + 1); // the first troubled id is checked again next time

    // Still paused a minute later: nothing is fetched.
    const before = ijs.seen.length;
    const paused = await sweepCatalog({
      db,
      fetchImpl: ijs.fetchImpl,
      now: () => new Date(NOON.getTime() + 60_000),
    });
    expect(paused.skipped).toBe("paused");
    expect(ijs.seen.length).toBe(before);

    // After the pause, more trouble doubles it.
    const later = new Date(NOON.getTime() + 16 * 60_000);
    await sweepCatalog({ db, fetchImpl: ijs.fetchImpl, now: () => later });
    expect(tables.ijs_catalog_sweep![0]!.backoff_minutes).toBe(BACKOFF_FIRST_MINUTES * 2);
  });

  it("stays out while another run holds the lease", async () => {
    const lo = SEED_TOP_ID - WINDOW_BELOW;
    const { db } = fakeDb({
      ijs_catalog_sweep: [
        {
          year: 2026,
          lo,
          hi: lo + 100,
          cursor: lo,
          backoff_minutes: 0,
          leased_until: new Date(NOON.getTime() + 30_000).toISOString(),
        },
      ],
    });
    const ijs = fakeIjs({});
    const result = await sweepCatalog({ db, fetchImpl: ijs.fetchImpl, now: () => NOON });
    expect(result.skipped).toBe("leased");
    expect(ijs.seen).toHaveLength(0);
  });

  it("starts a new pass at the end of the window, re-centred on the newest id found", async () => {
    const newest = SEED_TOP_ID + 50;
    const { db, tables } = fakeDb({
      ijs_catalog: [{ year: 2026, comp_id: newest, name: "Newest" }],
      ijs_catalog_sweep: [
        { year: 2026, lo: 100, hi: 110, cursor: 105, backoff_minutes: 0, leased_until: null },
      ],
    });
    const ijs = fakeIjs({});
    const result = await sweepCatalog({ db, fetchImpl: ijs.fetchImpl, now: () => NOON });
    expect(result.passCompleted).toBe(true);
    expect(ijs.seen).toEqual([105, 106, 107, 108, 109, 110]);
    expect(tables.ijs_catalog_sweep![0]).toMatchObject({
      cursor: newest - WINDOW_BELOW,
      lo: newest - WINDOW_BELOW,
    });
  });
});

describe("materializeCatalogBoard", () => {
  it("creates a board from the catalog on first open, and only from the catalog", async () => {
    const { db, tables } = fakeDb({
      ijs_catalog: [
        {
          year: 2026,
          comp_id: 36546,
          name: "2026 Greater Chicagoland Fall Invitational",
          dates_label: "09/10/2026 - 09/13/2026",
          location: "Evanston, IL",
          starts_on: "2026-09-10",
          ends_on: "2026-09-13",
        },
      ],
    });
    expect(await materializeCatalogBoard(db, "ijs-2026-36546")).toBe("ijs-2026-36546");
    expect(tables.competitions?.[0]).toMatchObject({
      slug: "ijs-2026-36546",
      comp_id: "36546",
      year: 2026,
      ijs_base_url: "https://ijs.usfigureskating.org/leaderboard/results/2026/36546",
      active: true,
    });
    expect(await materializeCatalogBoard(db, "ijs-2026-99999")).toBeNull();
    expect(await materializeCatalogBoard(db, "not-a-catalog-slug")).toBeNull();
  });

  it("reuses a board an admin already set up for the same competition", async () => {
    const { db } = fakeDb({
      competitions: [{ slug: "greater-chicagoland", comp_id: "36546", year: 2026 }],
    });
    expect(await materializeCatalogBoard(db, "ijs-2026-36546")).toBe("greater-chicagoland");
  });
});
