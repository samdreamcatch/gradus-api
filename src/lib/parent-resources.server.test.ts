import { describe, expect, it, mock } from "bun:test";
import { ApiError } from "./api/errors";
import { getParentResources, getResourceSignedUrl } from "./parent-resources.server";

type Config = {
  parent?: { id: string } | null;
  ownAthletes?: { id: string }[];
  joinedAthletes?: { athlete_id: string }[];
  goals?: { sport: string }[];
  coachSports?: { sport: string }[];
  libraryRows?: unknown[];
  coachRows?: unknown[];
  resourceRow?: unknown | null;
};

/**
 * A fake `supabase` covering `getParentResources`'s query sequence: a
 * `maybeSingle` on `parent_profiles` and `resources` (by id), list awaits on
 * `athletes` / `athlete_guardians` (via `team.server`'s `guardianAthleteIds`),
 * `athlete_goals`, `coach_athlete_sports`, and two shapes of `resources`
 * query distinguished by whether `.is("coach_id", null)` or
 * `.not("coach_id", "is", null)` was applied.
 */
function fakeClient(config: Config) {
  const chain = (table: string) => {
    let coachIdIsNull = false;
    let coachIdNotNull = false;
    const self: Record<string, unknown> = {};
    for (const m of ["select", "order"]) self[m] = () => self;
    self.eq = (col: string) => {
      if (table === "athletes" && col === "parent_id") return self; // own athletes
      if (table === "athlete_guardians" && col === "parent_id") return self;
      return self;
    };
    let rightsFilter: string[] | null = null;
    self.in = (col: string, values: string[]) => {
      if (col === "rights") rightsFilter = values;
      return self;
    };
    self.is = (col: string) => {
      if (col === "coach_id") coachIdIsNull = true;
      return self;
    };
    self.not = (col: string) => {
      if (col === "coach_id") coachIdNotNull = true;
      return self;
    };
    self.maybeSingle = async () => {
      if (table === "parent_profiles") return { data: config.parent ?? null, error: null };
      if (table === "resources") return { data: config.resourceRow ?? null, error: null };
      return { data: null, error: null };
    };
    self.then = (resolve: (v: unknown) => void) => {
      if (table === "athletes") return resolve({ data: config.ownAthletes ?? [], error: null });
      if (table === "athlete_guardians")
        return resolve({ data: config.joinedAthletes ?? [], error: null });
      if (table === "athlete_goals") return resolve({ data: config.goals ?? [], error: null });
      if (table === "coach_athlete_sports")
        return resolve({ data: config.coachSports ?? [], error: null });
      if (table === "resources") {
        if (coachIdIsNull) {
          const rows = (config.libraryRows ?? []) as { rights?: string }[];
          const filter = rightsFilter;
          const data = filter ? rows.filter((r) => filter.includes(r.rights ?? "pending")) : rows;
          return resolve({ data, error: null });
        }
        if (coachIdNotNull) return resolve({ data: config.coachRows ?? [], error: null });
      }
      return resolve({ data: [], error: null });
    };
    return self;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: (table: string) => chain(table) } as any;
}

async function caught(run: () => Promise<unknown>): Promise<ApiError | null> {
  try {
    await run();
    return null;
  } catch (err) {
    return err instanceof ApiError ? err : null;
  }
}

async function withFakeAdminStorage<T>(
  storage: Record<string, unknown>,
  run: () => Promise<T>,
): Promise<T> {
  const real = await import("@/integrations/supabase/client.server");
  mock.module("@/integrations/supabase/client.server", () => ({
    ...real,
    supabaseAdmin: { storage },
  }));
  try {
    return await run();
  } finally {
    mock.module("@/integrations/supabase/client.server", () => real);
  }
}

describe("getParentResources", () => {
  it("the store feed (storeSafeOnly) lists only rights-confirmed library rows; the web feed lists all", async () => {
    const config = {
      parent: { id: "p1" },
      ownAthletes: [{ id: "a1" }],
      goals: [{ sport: "golf" }],
      libraryRows: [
        {
          id: "r1",
          sport: "golf",
          title: "Ours",
          description: "",
          kind: "pdf",
          external_url: null,
          rights: "gradus",
        },
        {
          id: "r2",
          sport: "golf",
          title: "Licensed",
          description: "",
          kind: "link",
          external_url: "https://x",
          rights: "licensed",
        },
        {
          id: "r3",
          sport: "golf",
          title: "Rulebook",
          description: "",
          kind: "pdf",
          external_url: null,
          rights: "pending",
        },
      ],
    };
    const store = await getParentResources(
      { userId: "u1", supabase: fakeClient(config), admin: fakeClient(config) },
      { storeSafeOnly: true },
    );
    expect(store.resources.map((r) => r.id)).toEqual(["r1", "r2"]);
    const web = await getParentResources({
      userId: "u1",
      supabase: fakeClient(config),
      admin: fakeClient(config),
    });
    expect(web.resources.map((r) => r.id)).toEqual(["r1", "r2", "r3"]);
  });

  it("returns empty when the caller has no parent profile", async () => {
    const supabase = fakeClient({ parent: null });
    expect(await getParentResources({ userId: "u1", supabase, admin: supabase })).toEqual({
      sports: [],
      resources: [],
      canAskGradus: true,
    });
  });

  it("returns empty when the parent has no athletes", async () => {
    const supabase = fakeClient({ parent: { id: "p1" } });
    expect(await getParentResources({ userId: "u1", supabase, admin: supabase })).toEqual({
      sports: [],
      resources: [],
      canAskGradus: true,
    });
  });

  it("returns empty when the parent's athletes have no sports", async () => {
    const supabase = fakeClient({ parent: { id: "p1" }, ownAthletes: [{ id: "a1" }] });
    expect(await getParentResources({ userId: "u1", supabase, admin: supabase })).toEqual({
      sports: [],
      resources: [],
      canAskGradus: true,
    });
  });

  it("combines coach uploads (first) and library resources (second) across own and joined athletes", async () => {
    const supabase = fakeClient({
      parent: { id: "p1" },
      ownAthletes: [{ id: "a1" }],
      joinedAthletes: [{ athlete_id: "a2" }],
      goals: [{ sport: "figure_skating" }],
      coachSports: [{ sport: "hockey" }],
      libraryRows: [
        {
          id: "lib1",
          sport: "figure_skating",
          title: "Library",
          description: null,
          kind: "pdf",
          external_url: null,
        },
      ],
      coachRows: [
        {
          id: "c1",
          sport: "hockey",
          title: "Coach upload",
          description: "d",
          kind: "link",
          external_url: "https://x",
          coach_id: "coach1",
          coach_profiles: { first_name: "Dana", last_name: "Wallace" },
          resource_sports: [{ sport: "hockey" }],
        },
      ],
    });
    const result = await getParentResources({ userId: "u1", supabase, admin: supabase });
    expect(result.sports).toEqual(["figure_skating", "hockey"]);
    expect(result.resources).toEqual([
      {
        id: "c1",
        sport: "hockey",
        sports: ["hockey"],
        title: "Coach upload",
        description: "d",
        kind: "link",
        source: "coach",
        externalUrl: "https://x",
        coachName: "Dana Wallace",
      },
      {
        id: "lib1",
        sport: "figure_skating",
        sports: ["figure_skating"],
        title: "Library",
        description: "",
        kind: "pdf",
        source: "library",
        externalUrl: null,
        coachName: null,
      },
    ]);
  });
});

describe("getParentResources locking", () => {
  it("a co-guardian's locked athlete contributes no sports or resources", async () => {
    // Bespoke fake: the shared fakeClient above doesn't apply real filters
    // (its parent_profiles maybeSingle can't tell the caller's own profile
    // apart from the primary's), so it can't express "this primary's plan
    // has lapsed." This one can, tracking which column was queried.
    let athleteGoalsQueried = false;
    const client = {
      from(table: string) {
        const self: Record<string, unknown> = {};
        let mode: string | null = null;
        self.select = () => self;
        self.order = () => self;
        self.in = () => self;
        self.is = () => self;
        self.not = () => self;
        self.eq = (col: string) => {
          if (table === "parent_profiles" && col === "user_id") mode = "caller";
          if (table === "parent_profiles" && col === "id") mode = "primaryPlan";
          if (table === "athletes" && col === "parent_id") mode = "own";
          return self;
        };
        self.maybeSingle = async () => {
          if (mode === "caller") return { data: { id: "parent-2" }, error: null };
          if (mode === "primaryPlan") {
            return { data: { subscription_status: null, current_period_end: null }, error: null };
          }
          return { data: null, error: null };
        };
        self.then = (resolve: (v: unknown) => void) => {
          if (table === "athletes" && mode === "own") return resolve({ data: [], error: null });
          if (table === "athlete_guardians") {
            return resolve({
              data: [{ athlete_id: "a2", athletes: { parent_id: "primary-1" } }],
              error: null,
            });
          }
          if (table === "athlete_goals") athleteGoalsQueried = true;
          return resolve({ data: [], error: null });
        };
        return self;
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    expect(await getParentResources({ userId: "u2", supabase: client, admin: client })).toEqual({
      sports: [],
      resources: [],
      canAskGradus: true,
    });
    expect(athleteGoalsQueried).toBe(false);
  });
});

describe("getResourceSignedUrl", () => {
  it("throws not_found 404 'Resource not found' when the row doesn't exist", async () => {
    const supabase = fakeClient({ resourceRow: null });
    const err = await caught(() => getResourceSignedUrl({ userId: "u1", supabase }, "r1"));
    expect(err?.code).toBe("not_found");
    expect(err?.status).toBe(404);
    expect(err?.message).toBe("Resource not found");
  });

  it("returns the external URL directly for a link resource", async () => {
    const supabase = fakeClient({
      resourceRow: { storage_path: null, external_url: "https://example.com", kind: "link" },
    });
    expect(await getResourceSignedUrl({ userId: "u1", supabase }, "r1")).toEqual({
      url: "https://example.com",
    });
  });

  it("returns the public URL directly for an image added by link", async () => {
    const supabase = fakeClient({
      resourceRow: { storage_path: null, external_url: "https://cdn.example/a.jpg", kind: "image" },
    });
    expect(await getResourceSignedUrl({ userId: "u1", supabase }, "r1")).toEqual({
      url: "https://cdn.example/a.jpg",
    });
  });

  it("throws unprocessable 422 'Missing link URL' for a link with no URL", async () => {
    const supabase = fakeClient({
      resourceRow: { storage_path: null, external_url: null, kind: "link" },
    });
    const err = await caught(() => getResourceSignedUrl({ userId: "u1", supabase }, "r1"));
    expect(err?.code).toBe("unprocessable");
    expect(err?.message).toBe("Missing link URL");
  });

  it("throws unprocessable 422 'Missing storage path' for a pdf with no path", async () => {
    const supabase = fakeClient({
      resourceRow: { storage_path: null, external_url: null, kind: "pdf" },
    });
    const err = await caught(() => getResourceSignedUrl({ userId: "u1", supabase }, "r1"));
    expect(err?.code).toBe("unprocessable");
    expect(err?.message).toBe("Missing storage path");
  });

  it("signs a URL for a pdf with a storage path", async () => {
    const supabase = fakeClient({
      resourceRow: { storage_path: "lib/a.pdf", external_url: null, kind: "pdf" },
    });
    const result = await withFakeAdminStorage(
      {
        from: () => ({
          createSignedUrl: async (path: string) => ({
            data: { signedUrl: `https://signed/${path}` },
            error: null,
          }),
        }),
      },
      () => getResourceSignedUrl({ userId: "u1", supabase }, "r1"),
    );
    expect(result).toEqual({ url: "https://signed/lib/a.pdf" });
  });

  it("throws unprocessable 422 'Could not sign URL' when signing fails", async () => {
    const supabase = fakeClient({
      resourceRow: { storage_path: "lib/a.pdf", external_url: null, kind: "pdf" },
    });
    const err = await withFakeAdminStorage(
      { from: () => ({ createSignedUrl: async () => ({ data: null, error: null }) }) },
      () => caught(() => getResourceSignedUrl({ userId: "u1", supabase }, "r1")),
    );
    expect(err?.code).toBe("unprocessable");
    expect(err?.message).toBe("Could not sign URL");
  });
});
