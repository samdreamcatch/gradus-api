import { describe, expect, it } from "bun:test";
import {
  allOf,
  decodeMarketplaceCursor,
  encodeMarketplaceCursor,
  getMarketplacePlans,
  searchTerms,
} from "./marketplace-plans.server";

type Row = Record<string, unknown>;
type Call = { table: string; filters: unknown[][] };

/**
 * A row-store fake for the query shapes this module issues. Plain-column
 * `.eq()`/`.in()` filter the rows; every call is recorded so tests can assert
 * the filters that only PostgREST evaluates (embedded columns, `or`).
 */
function fakeAdmin(tables: Record<string, Row[]>) {
  const calls: Call[] = [];
  const admin = {
    from: (table: string) => {
      const call: Call = { table, filters: [] };
      calls.push(call);
      let rows = [...(tables[table] ?? [])];
      const chain = {
        select: () => chain,
        eq: (col: string, val: unknown) => {
          call.filters.push(["eq", col, val]);
          if (!col.includes(".")) rows = rows.filter((r) => r[col] === val);
          return chain;
        },
        in: (col: string, vals: unknown[]) => {
          call.filters.push(["in", col, vals]);
          rows = rows.filter((r) => vals.includes(r[col]));
          return chain;
        },
        neq: (col: string, val: unknown) => {
          call.filters.push(["neq", col, val]);
          return chain;
        },
        gte: (col: string, val: unknown) => {
          call.filters.push(["gte", col, val]);
          return chain;
        },
        lte: (col: string, val: unknown) => {
          call.filters.push(["lte", col, val]);
          return chain;
        },
        is: (col: string, val: unknown) => {
          call.filters.push(["is", col, val]);
          return chain;
        },
        or: (filter: string) => {
          call.filters.push(["or", filter]);
          return chain;
        },
        order: () => chain,
        limit: (n: number) => {
          call.filters.push(["limit", n]);
          return Promise.resolve({ data: rows.slice(0, n), error: null });
        },
        maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
        then: (resolve: (v: { data: Row[]; error: null }) => void) =>
          resolve({ data: rows, error: null }),
      };
      return chain;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return { admin, calls };
}

const COACH = { id: "c-pro", first_name: "Tami", last_name: "Taylor" };
const listing = (id: string, updatedAt: string) => ({
  id,
  title: `Plan ${id}`,
  kind: "template",
  status: "active",
  price: "24.99",
  updated_at: updatedAt,
  notes: "private notes",
  coach: COACH,
});

describe("searchTerms and allOf", () => {
  it("strips PostgREST syntax characters and keeps at most five words", () => {
    expect(searchTerms(undefined)).toEqual([]);
    expect(searchTerms("  double, (axel)  ")).toEqual(["double", "axel"]);
    expect(searchTerms("a b c d e f g")).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("combines or-groups so each one must hold", () => {
    expect(allOf([])).toBeNull();
    expect(allOf(["a.eq.1,b.eq.2"])).toBe("a.eq.1,b.eq.2");
    expect(allOf(["a.eq.1,b.eq.2", "c.eq.3"])).toBe("and(or(a.eq.1,b.eq.2),or(c.eq.3))");
  });
});

describe("marketplace cursor", () => {
  it("round-trips and refuses anything else", () => {
    const id = "6a1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
    const cursor = encodeMarketplaceCursor("2026-11-02T10:00:00.000Z", id);
    expect(decodeMarketplaceCursor(cursor)).toEqual({ updatedAt: "2026-11-02T10:00:00.000Z", id });
    expect(() => decodeMarketplaceCursor("not-a-cursor")).toThrow();
  });
});

describe("getMarketplacePlans", () => {
  it("lists active Coach Pro plans without the caller's own, assigned, or children's plans", async () => {
    const { admin, calls } = fakeAdmin({
      coach_profiles: [{ id: "c-me", user_id: "me" }],
      athletes: [
        { id: "a-me", user_id: "me" },
        { id: "a-kid", parent_id: "p-me" },
      ],
      parent_profiles: [{ id: "p-me", user_id: "me" }],
      athlete_guardians: [],
      plans: [listing("p1", "2026-11-02T10:00:00.000Z")],
      plan_moves: [{ plan_id: "p1" }, { plan_id: "p1" }],
    });

    const page = await getMarketplacePlans({ userId: "me", admin }, { limit: 20 });

    expect(page).toEqual({
      items: [
        {
          id: "p1",
          title: "Plan p1",
          kind: "template",
          moveCount: 2,
          price: 24.99,
          updatedAt: "2026-11-02T10:00:00.000Z",
          coach: { id: "c-pro", firstName: "Tami", lastName: "Taylor" },
        },
      ],
      nextCursor: null,
    });
    const plans = calls.find((c) => c.table === "plans")!;
    expect(plans.filters).toContainEqual(["eq", "status", "active"]);
    expect(plans.filters).toContainEqual(["eq", "coach.subscription_tier", "coach_pro"]);
    expect(plans.filters).toContainEqual(["is", "coach.organization_id", null]);
    expect(plans.filters).toContainEqual(["neq", "coach_id", "c-me"]);
    expect(plans.filters).toContainEqual([
      "or",
      "athlete_id.is.null,athlete_id.not.in.(a-me,a-kid)",
    ]);
  });

  it("matches the title or the coach's name, and pages with a cursor", async () => {
    const { admin, calls } = fakeAdmin({
      coach_profiles: [],
      athletes: [],
      parent_profiles: [],
      plans: [listing("p1", "2026-11-02T10:00:00.000Z"), listing("p2", "2026-11-01T10:00:00.000Z")],
      plan_moves: [],
    });

    const page = await getMarketplacePlans({ userId: "me", admin }, { q: "loop", limit: 1 });

    expect(page.items.map((i) => i.id)).toEqual(["p1"]);
    expect(page.nextCursor).not.toBeNull();
    const plans = calls.find((c) => c.table === "plans")!;
    // No coach is named "loop", so only the title can match.
    expect(plans.filters).toContainEqual(["or", "and(title.ilike.%loop%)"]);
    expect(plans.filters.some((f) => f[0] === "neq")).toBe(false);
  });

  it("filters by price, inclusive at both ends", async () => {
    const { admin, calls } = fakeAdmin({
      coach_profiles: [],
      athletes: [],
      parent_profiles: [],
      plans: [listing("p1", "2026-11-02T10:00:00.000Z")],
      plan_moves: [],
    });

    await getMarketplacePlans({ userId: "me", admin }, { minPrice: 10, maxPrice: 30, limit: 20 });

    const plans = calls.find((c) => c.table === "plans")!;
    expect(plans.filters).toContainEqual(["gte", "price", 10]);
    expect(plans.filters).toContainEqual(["lte", "price", 30]);
  });

  it("refuses a minimum price above the maximum", async () => {
    const { admin } = fakeAdmin({});
    await expect(
      getMarketplacePlans({ userId: "me", admin }, { minPrice: 50, maxPrice: 10, limit: 20 }),
    ).rejects.toThrow();
  });
});
