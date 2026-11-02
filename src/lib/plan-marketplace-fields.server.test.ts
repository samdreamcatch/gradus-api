import { describe, expect, it } from "bun:test";
import {
  assertPlanMediaOwned,
  getPlanMarketplaceFields,
  planMediaFolder,
  setPlanMarketplaceFields,
} from "./plan-marketplace-fields.server";

const SUPABASE = "https://proj.supabase.co";
const PLAN = "6a1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const imageUrl = (folder = PLAN, host = SUPABASE) =>
  `${host}/storage/v1/object/authenticated/plan-media/${folder}/cover.jpg`;

type Row = Record<string, unknown>;

/** `.from("plans")` with `.select().eq().maybeSingle()` reads and a recorded `.update().eq()`. */
function fakeClient(rows: Row[]) {
  const updates: { columns: Row; id: unknown }[] = [];
  const client = {
    from: () => {
      let matched = [...rows];
      const chain = {
        select: () => chain,
        eq: (col: string, val: unknown) => {
          matched = matched.filter((r) => r[col] === val);
          return chain;
        },
        maybeSingle: () => Promise.resolve({ data: matched[0] ?? null, error: null }),
        update: (columns: Row) => ({
          eq: (_col: string, id: unknown) => {
            updates.push({ columns, id });
            return Promise.resolve({ error: null });
          },
        }),
      };
      return chain;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return { client, updates };
}

describe("planMediaFolder", () => {
  it("reads the plan folder out of an authenticated plan-media URL", () => {
    expect(planMediaFolder(imageUrl(), SUPABASE)).toBe(PLAN);
  });

  it("refuses another host, bucket, URL form, a non-plan folder, or a bare folder", () => {
    expect(planMediaFolder(imageUrl(PLAN, "https://evil.example"), SUPABASE)).toBeNull();
    expect(
      planMediaFolder(
        `${SUPABASE}/storage/v1/object/authenticated/voice-notes/${PLAN}/a.jpg`,
        SUPABASE,
      ),
    ).toBeNull();
    expect(
      planMediaFolder(`${SUPABASE}/storage/v1/object/public/plan-media/${PLAN}/a.jpg`, SUPABASE),
    ).toBeNull();
    expect(planMediaFolder(imageUrl("not-a-plan"), SUPABASE)).toBeNull();
    expect(
      planMediaFolder(`${SUPABASE}/storage/v1/object/authenticated/plan-media/${PLAN}/`, SUPABASE),
    ).toBeNull();
    expect(planMediaFolder("not a url", SUPABASE)).toBeNull();
  });
});

describe("assertPlanMediaOwned", () => {
  it("accepts an image in a plan the coach owns and refuses anyone else's", async () => {
    const { client } = fakeClient([{ id: PLAN, coach_id: "coach-1" }]);
    const previous = process.env.SUPABASE_URL;
    process.env.SUPABASE_URL = SUPABASE;
    try {
      await assertPlanMediaOwned(client, "coach-1", imageUrl());
      await expect(assertPlanMediaOwned(client, "coach-2", imageUrl())).rejects.toThrow();
      await expect(
        assertPlanMediaOwned(client, "coach-1", "https://x.test/a.jpg"),
      ).rejects.toThrow();
    } finally {
      if (previous === undefined) delete process.env.SUPABASE_URL;
      else process.env.SUPABASE_URL = previous;
    }
  });
});

describe("plan marketplace fields", () => {
  it("writes only the fields a request sent, and nothing when it sent none", async () => {
    const { client, updates } = fakeClient([]);
    await setPlanMarketplaceFields(client, PLAN, {});
    await setPlanMarketplaceFields(client, PLAN, { price: 19.99 });
    await setPlanMarketplaceFields(client, PLAN, { media: null });
    expect(updates).toEqual([
      { columns: { price: 19.99 }, id: PLAN },
      { columns: { media: null }, id: PLAN },
    ]);
  });

  it("reads price as a number, numeric strings included", async () => {
    const { client } = fakeClient([{ id: PLAN, price: "24.50", media: null }]);
    expect(await getPlanMarketplaceFields(client, PLAN)).toEqual({ price: 24.5, media: null });
    expect(await getPlanMarketplaceFields(client, "missing")).toBeNull();
  });
});
