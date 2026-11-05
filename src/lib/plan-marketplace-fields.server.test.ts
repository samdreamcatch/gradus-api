import { describe, expect, it } from "bun:test";
import {
  assertPlanMediaOwned,
  DEFAULT_PLAN_MEDIA_URLS,
  getPlanMarketplaceFields,
  listingCoverUrls,
  marketplaceFieldsForCopy,
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
  } as unknown as Parameters<typeof setPlanMarketplaceFields>[0];
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
      // Gradus default artwork is allowed on any coach's plan.
      await assertPlanMediaOwned(client, "coach-2", DEFAULT_PLAN_MEDIA_URLS[0]);
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
    await setPlanMarketplaceFields(client, PLAN, {
      productType: "program",
      selectedLevel: "Juvenile",
      description: null,
    });
    await setPlanMarketplaceFields(client, PLAN, {
      selectedLevel: "basic_skills",
      selectedLevelTo: "pre_juvenile",
    });
    expect(updates).toEqual([
      { columns: { price: 19.99 }, id: PLAN },
      { columns: { media: null }, id: PLAN },
      {
        // A level sent without a range end is a single level: the old end is cleared.
        columns: {
          product_type: "program",
          selected_level: "Juvenile",
          selected_level_to: null,
          description: null,
        },
        id: PLAN,
      },
      {
        columns: { selected_level: "basic_skills", selected_level_to: "pre_juvenile" },
        id: PLAN,
      },
    ]);
  });

  it("reads price as a number, numeric strings included", async () => {
    const { client } = fakeClient([
      {
        id: PLAN,
        price: "24.50",
        media: null,
        product_type: "plan",
        selected_level: "basic_skills",
        selected_level_to: "pre_juvenile",
        description: "Edges first.",
      },
    ]);
    expect(await getPlanMarketplaceFields(client, PLAN)).toEqual({
      price: 24.5,
      media: null,
      productType: "plan",
      selectedLevel: "basic_skills",
      selectedLevelTo: "pre_juvenile",
      description: "Edges first.",
    });
    expect(await getPlanMarketplaceFields(client, "missing")).toBeNull();
  });
});

describe("marketplaceFieldsForCopy", () => {
  const source = {
    price: 30,
    media: imageUrl(),
    productType: "program" as const,
    selectedLevel: "basic_skills",
    selectedLevelTo: "pre_juvenile",
    description: "Edges first.",
  };

  it("takes the source's fields, its level range included, but never its image", () => {
    expect(marketplaceFieldsForCopy(source, {})).toEqual({
      price: 30,
      media: undefined,
      productType: "program",
      selectedLevel: "basic_skills",
      selectedLevelTo: "pre_juvenile",
      description: "Edges first.",
    });
  });

  it("gives a copy sent a single level no range end", () => {
    expect(marketplaceFieldsForCopy(source, { selectedLevel: "novice" })).toMatchObject({
      selectedLevel: "novice",
      selectedLevelTo: null,
    });
  });

  it("lets what the request sent win, a cleared description included", () => {
    expect(
      marketplaceFieldsForCopy(source, { price: 0, productType: "plan", description: null }),
    ).toMatchObject({
      price: 0,
      productType: "plan",
      selectedLevel: "basic_skills",
      description: null,
    });
  });
});

describe("default artwork on copies", () => {
  it("carries Gradus default artwork over to a copy", () => {
    const source = {
      price: 0,
      media: DEFAULT_PLAN_MEDIA_URLS[0],
      productType: "plan" as const,
      selectedLevel: "Novice",
      selectedLevelTo: null,
      description: null,
    };
    expect(marketplaceFieldsForCopy(source, {}).media).toBe(DEFAULT_PLAN_MEDIA_URLS[0]);
  });
});

describe("listingCoverUrls", () => {
  it("passes default artwork through, signs uploads in one call, and drops anything else", async () => {
    const signedCalls: string[][] = [];
    const admin = {
      storage: {
        from: (bucket: string) => ({
          createSignedUrls: async (paths: string[], expiresIn: number) => {
            signedCalls.push([bucket, String(expiresIn), ...paths]);
            return {
              data: paths.map((path) => ({ path, signedUrl: `https://signed.test/${path}` })),
              error: null,
            };
          },
        }),
      },
    };
    const previous = process.env.SUPABASE_URL;
    process.env.SUPABASE_URL = SUPABASE;
    try {
      const covers = await listingCoverUrls(admin, [
        DEFAULT_PLAN_MEDIA_URLS[0],
        imageUrl(),
        null,
        "https://elsewhere.test/a.jpg",
        imageUrl(),
      ]);
      expect(covers).toEqual([
        DEFAULT_PLAN_MEDIA_URLS[0],
        `https://signed.test/${PLAN}/cover.jpg`,
        null,
        null,
        `https://signed.test/${PLAN}/cover.jpg`,
      ]);
      expect(signedCalls).toEqual([["plan-media", "3600", `${PLAN}/cover.jpg`]]);
    } finally {
      if (previous === undefined) delete process.env.SUPABASE_URL;
      else process.env.SUPABASE_URL = previous;
    }
  });

  it("makes no signing call when no cover is an upload", async () => {
    const admin = {
      storage: {
        from: () => ({
          createSignedUrls: async () => {
            throw new Error("should not sign");
          },
        }),
      },
    };
    expect(await listingCoverUrls(admin, [null, DEFAULT_PLAN_MEDIA_URLS[0]])).toEqual([
      null,
      DEFAULT_PLAN_MEDIA_URLS[0],
    ]);
  });
});
