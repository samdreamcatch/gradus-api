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
    self.in = () => self;
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
        if (coachIdIsNull) return resolve({ data: config.libraryRows ?? [], error: null });
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
  it("returns empty when the caller has no parent profile", async () => {
    const supabase = fakeClient({ parent: null });
    expect(await getParentResources({ userId: "u1", supabase })).toEqual({
      sports: [],
      resources: [],
    });
  });

  it("returns empty when the parent has no athletes", async () => {
    const supabase = fakeClient({ parent: { id: "p1" } });
    expect(await getParentResources({ userId: "u1", supabase })).toEqual({
      sports: [],
      resources: [],
    });
  });

  it("returns empty when the parent's athletes have no sports", async () => {
    const supabase = fakeClient({ parent: { id: "p1" }, ownAthletes: [{ id: "a1" }] });
    expect(await getParentResources({ userId: "u1", supabase })).toEqual({
      sports: [],
      resources: [],
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
    const result = await getParentResources({ userId: "u1", supabase });
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
