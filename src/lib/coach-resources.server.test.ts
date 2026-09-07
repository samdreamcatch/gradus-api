import { describe, expect, it, mock } from "bun:test";
import { ApiError } from "./api/errors";
import {
  createCoachResource,
  createCoachResourceInput,
  createCoachResourceUploadUrl,
  createCoachResourceUploadUrlInput,
  deleteCoachResource,
  listCoachResources,
} from "./coach-resources.server";

/** A chainable fake: `rows[table]` answers `maybeSingle`/`single`; `lists[table]` answers awaited selects. */
function fakeClient(
  rows: Record<string, unknown | null> = {},
  lists: Record<string, unknown[]> = {},
  writeError: { message: string } | null = null,
) {
  const chain = (table: string) => {
    const self: Record<string, unknown> = {};
    for (const m of [
      "select",
      "eq",
      "neq",
      "in",
      "is",
      "not",
      "order",
      "limit",
      "delete",
      "insert",
      "upsert",
    ]) {
      self[m] = () => self;
    }
    self.maybeSingle = async () => ({ data: rows[table] ?? null, error: null });
    self.single = async () =>
      writeError ? { data: null, error: writeError } : { data: rows[table] ?? null, error: null };
    self.then = (resolve: (v: unknown) => void) =>
      resolve(
        writeError ? { data: null, error: writeError } : { data: lists[table] ?? [], error: null },
      );
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

/** Replaces `client.server`'s `supabaseAdmin` for one dynamic-import call, then restores it. */
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

describe("createCoachResourceInput", () => {
  it("requires a storagePath (not externalUrl) for pdf/image", () => {
    expect(
      createCoachResourceInput.safeParse({
        title: "t",
        kind: "pdf",
        sports: ["figure_skating"],
        storagePath: "coach/1/a.pdf",
      }).success,
    ).toBe(true);
    expect(
      createCoachResourceInput.safeParse({
        title: "t",
        kind: "pdf",
        sports: ["figure_skating"],
        externalUrl: "https://example.com",
      }).success,
    ).toBe(false);
  });

  it("requires an https externalUrl (not storagePath) for link", () => {
    expect(
      createCoachResourceInput.safeParse({
        title: "t",
        kind: "link",
        sports: ["figure_skating"],
        externalUrl: "https://example.com",
      }).success,
    ).toBe(true);
    expect(
      createCoachResourceInput.safeParse({
        title: "t",
        kind: "link",
        sports: ["figure_skating"],
        externalUrl: "http://example.com",
      }).success,
    ).toBe(false);
    expect(
      createCoachResourceInput.safeParse({
        title: "t",
        kind: "link",
        sports: ["figure_skating"],
        storagePath: "coach/1/a.pdf",
      }).success,
    ).toBe(false);
  });

  it("requires at least one sport, at most ten", () => {
    expect(
      createCoachResourceInput.safeParse({
        title: "t",
        kind: "link",
        sports: [],
        externalUrl: "https://example.com",
      }).success,
    ).toBe(false);
  });
});

describe("createCoachResourceUploadUrlInput", () => {
  it("accepts a short alphanumeric extension and lowercases it", () => {
    const parsed = createCoachResourceUploadUrlInput.parse({
      ext: "PDF",
      contentType: "application/pdf",
    });
    expect(parsed.ext).toBe("pdf");
  });

  it("rejects an extension with punctuation", () => {
    expect(
      createCoachResourceUploadUrlInput.safeParse({ ext: ".pdf", contentType: "application/pdf" })
        .success,
    ).toBe(false);
  });
});

describe("listCoachResources", () => {
  it("returns empty defaults with canUpload false when the caller has no coach profile", async () => {
    const supabase = fakeClient({ coach_profiles: null });
    const result = await listCoachResources({ userId: "u1", supabase });
    expect(result).toEqual({
      sports: [],
      resources: [],
      libraryResources: [],
      canUpload: false,
      effectiveTier: "coach",
    });
  });

  it("reports canUpload true and tier club for an org coach", async () => {
    const supabase = fakeClient(
      { coach_profiles: { id: "c1", organization_id: "org1", subscription_tier: null } },
      { coach_levels: [{ sport: "figure_skating" }], resources: [] },
    );
    const result = await listCoachResources({ userId: "u1", supabase });
    expect(result.canUpload).toBe(true);
    expect(result.effectiveTier).toBe("club");
    expect(result.sports).toEqual(["figure_skating"]);
  });
});

describe("createCoachResource", () => {
  it("throws wrong_role 403 'Coach profile not found' with no coach profile", async () => {
    const supabase = fakeClient({ coach_profiles: null });
    const err = await caught(() =>
      createCoachResource(
        { userId: "u1", supabase },
        createCoachResourceInput.parse({
          title: "t",
          kind: "link",
          sports: ["figure_skating"],
          externalUrl: "https://example.com",
        }),
      ),
    );
    expect(err?.code).toBe("wrong_role");
    expect(err?.status).toBe(403);
    expect(err?.message).toBe("Coach profile not found");
  });

  it("throws forbidden 403 for a base-tier coach", async () => {
    const supabase = fakeClient({
      coach_profiles: { id: "c1", organization_id: null, subscription_tier: null },
    });
    const err = await caught(() =>
      createCoachResource(
        { userId: "u1", supabase },
        createCoachResourceInput.parse({
          title: "t",
          kind: "link",
          sports: ["figure_skating"],
          externalUrl: "https://example.com",
        }),
      ),
    );
    expect(err?.code).toBe("forbidden");
    expect(err?.status).toBe(403);
    expect(err?.message).toBe("Coach Pro or Club plan required to upload resources");
  });

  it("throws unprocessable 422 'You don't coach <sport>' for a sport outside coach_levels", async () => {
    const supabase = fakeClient(
      { coach_profiles: { id: "c1", organization_id: null, subscription_tier: "coach_pro" } },
      { coach_levels: [{ sport: "figure_skating" }] },
    );
    const err = await caught(() =>
      createCoachResource(
        { userId: "u1", supabase },
        createCoachResourceInput.parse({
          title: "t",
          kind: "link",
          sports: ["hockey"],
          externalUrl: "https://example.com",
        }),
      ),
    );
    expect(err?.code).toBe("unprocessable");
    expect(err?.status).toBe(422);
    expect(err?.message).toBe("You don't coach hockey");
  });

  it("inserts and returns the new id for a Pro coach with an allowed sport", async () => {
    const supabase = fakeClient(
      {
        coach_profiles: { id: "c1", organization_id: null, subscription_tier: "coach_pro" },
        resources: { id: "r1" },
      },
      { coach_levels: [{ sport: "figure_skating" }], resource_sports: [] },
    );
    const result = await createCoachResource(
      { userId: "u1", supabase },
      createCoachResourceInput.parse({
        title: "t",
        kind: "link",
        sports: ["figure_skating"],
        externalUrl: "https://example.com",
      }),
    );
    expect(result).toEqual({ id: "r1" });
  });
});

describe("deleteCoachResource", () => {
  it("throws wrong_role 403 with no coach profile", async () => {
    const supabase = fakeClient({ coach_profiles: null });
    const err = await caught(() => deleteCoachResource({ userId: "u1", supabase }, "res-1"));
    expect(err?.code).toBe("wrong_role");
    expect(err?.message).toBe("Coach profile not found");
  });

  it("throws not_found 404 'Not found' when the resource belongs to another coach", async () => {
    const supabase = fakeClient({
      coach_profiles: { id: "c1", organization_id: null, subscription_tier: "coach_pro" },
      resources: { storage_path: null, coach_id: "someone-else" },
    });
    const err = await caught(() => deleteCoachResource({ userId: "u1", supabase }, "res-1"));
    expect(err?.code).toBe("not_found");
    expect(err?.status).toBe(404);
    expect(err?.message).toBe("Not found");
  });

  it("throws not_found 404 when the resource row doesn't exist", async () => {
    const supabase = fakeClient({
      coach_profiles: { id: "c1", organization_id: null, subscription_tier: "coach_pro" },
      resources: null,
    });
    const err = await caught(() => deleteCoachResource({ userId: "u1", supabase }, "res-1"));
    expect(err?.code).toBe("not_found");
  });

  it("deletes and returns ok without touching storage when storage_path is null", async () => {
    const supabase = fakeClient({
      coach_profiles: { id: "c1", organization_id: null, subscription_tier: "coach_pro" },
      resources: { storage_path: null, coach_id: "c1" },
    });
    const result = await deleteCoachResource({ userId: "u1", supabase }, "res-1");
    expect(result).toEqual({ ok: true });
  });

  it("removes the storage object when storage_path is set", async () => {
    const supabase = fakeClient({
      coach_profiles: { id: "c1", organization_id: null, subscription_tier: "coach_pro" },
      resources: { storage_path: "coach/c1/a.pdf", coach_id: "c1" },
    });
    const removed: string[][] = [];
    const result = await withFakeAdminStorage(
      {
        from: () => ({
          remove: async (paths: string[]) => {
            removed.push(paths);
            return { error: null };
          },
        }),
      },
      () => deleteCoachResource({ userId: "u1", supabase }, "res-1"),
    );
    expect(result).toEqual({ ok: true });
    expect(removed).toEqual([["coach/c1/a.pdf"]]);
  });
});

describe("createCoachResourceUploadUrl", () => {
  it("throws wrong_role 403 with no coach profile", async () => {
    const supabase = fakeClient({ coach_profiles: null });
    const err = await caught(() =>
      createCoachResourceUploadUrl(
        { userId: "u1", supabase },
        createCoachResourceUploadUrlInput.parse({ ext: "pdf", contentType: "application/pdf" }),
      ),
    );
    expect(err?.code).toBe("wrong_role");
  });

  it("throws forbidden 403 for a base-tier coach", async () => {
    const supabase = fakeClient({
      coach_profiles: { id: "c1", organization_id: null, subscription_tier: null },
    });
    const err = await caught(() =>
      createCoachResourceUploadUrl(
        { userId: "u1", supabase },
        createCoachResourceUploadUrlInput.parse({ ext: "pdf", contentType: "application/pdf" }),
      ),
    );
    expect(err?.code).toBe("forbidden");
    expect(err?.message).toBe("Coach Pro or Club plan required to upload resources");
  });

  it("mints a signed upload URL under coach/{coachId}/ for a Pro coach", async () => {
    const supabase = fakeClient({
      coach_profiles: { id: "c1", organization_id: null, subscription_tier: "coach_pro" },
    });
    const result = await withFakeAdminStorage(
      {
        from: () => ({
          createSignedUploadUrl: async (path: string) => ({
            data: { token: "tok-1", signedUrl: `https://signed/${path}` },
            error: null,
          }),
        }),
      },
      () =>
        createCoachResourceUploadUrl(
          { userId: "u1", supabase },
          createCoachResourceUploadUrlInput.parse({ ext: "pdf", contentType: "application/pdf" }),
        ),
    );
    expect(result.path.startsWith("coach/c1/")).toBe(true);
    expect(result.path.endsWith(".pdf")).toBe(true);
    expect(result.token).toBe("tok-1");
    expect(result.url).toBe(`https://signed/${result.path}`);
  });

  it("throws unprocessable 422 when signing fails", async () => {
    const supabase = fakeClient({
      coach_profiles: { id: "c1", organization_id: null, subscription_tier: "coach_pro" },
    });
    const err = await withFakeAdminStorage(
      {
        from: () => ({
          createSignedUploadUrl: async () => ({
            data: null,
            error: { message: "bucket missing" },
          }),
        }),
      },
      () =>
        caught(() =>
          createCoachResourceUploadUrl(
            { userId: "u1", supabase },
            createCoachResourceUploadUrlInput.parse({ ext: "pdf", contentType: "application/pdf" }),
          ),
        ),
    );
    expect(err?.code).toBe("unprocessable");
    expect(err?.status).toBe(422);
    expect(err?.message).toBe("bucket missing");
  });
});
