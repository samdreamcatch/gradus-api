import { describe, expect, it, mock } from "bun:test";
import { ApiError } from "./api/errors";
import {
  IMAGE_UPLOAD_REFUSED,
  PDF_ONLY,
  assertPublicImageUrl,
  createCoachResource,
  createCoachResourceInput,
  createCoachResourceUploadUrl,
  createCoachResourceUploadUrlInput,
  deleteCoachResource,
  listCoachResources,
} from "./coach-resources.server";

/**
 * A chainable fake: `rows[table]` answers `maybeSingle`/`single`; `lists[table]` answers
 * awaited selects; `writeErrors[table]` fails that table's `single`/awaited-insert only
 * (so one table can succeed while another fails, e.g. resources insert vs. resource_sports
 * insert). Also records each table's `insert()` payloads and the ids passed to
 * `delete().eq('id', ...)`, so tests can assert on the actual write, not just the outcome.
 */
function fakeClient(
  rows: Record<string, unknown | null> = {},
  lists: Record<string, unknown[]> = {},
  writeErrors: Record<string, { message: string } | null | undefined> = {},
) {
  const insertedPayloads: Record<string, unknown[]> = {};
  const deletedIds: Record<string, string[]> = {};
  const chain = (table: string) => {
    const self: Record<string, unknown> = {};
    let deleting = false;
    for (const m of ["select", "neq", "in", "is", "not", "order", "limit", "upsert"]) {
      self[m] = () => self;
    }
    self.insert = (payload: unknown) => {
      (insertedPayloads[table] ??= []).push(payload);
      return self;
    };
    self.delete = () => {
      deleting = true;
      return self;
    };
    self.eq = (_col: string, value: string) => {
      if (deleting) {
        (deletedIds[table] ??= []).push(value);
        deleting = false;
      }
      return self;
    };
    const writeError = writeErrors[table] ?? null;
    self.maybeSingle = async () => ({ data: rows[table] ?? null, error: null });
    self.single = async () =>
      writeError ? { data: null, error: writeError } : { data: rows[table] ?? null, error: null };
    self.then = (resolve: (v: unknown) => void) =>
      resolve(
        writeError ? { data: null, error: writeError } : { data: lists[table] ?? [], error: null },
      );
    return self;
  };
  return {
    from: (table: string) => chain(table),
    insertedPayloads,
    deletedIds,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

async function caught(run: () => Promise<unknown>): Promise<ApiError | null> {
  try {
    await run();
    return null;
  } catch (err) {
    return err instanceof ApiError ? err : null;
  }
}

/** Like `caught`, but returns any thrown Error (used for `dbError`'s plain-Error fallback). */
async function caughtAny(run: () => Promise<unknown>): Promise<Error | null> {
  try {
    await run();
    return null;
  } catch (err) {
    return err instanceof Error ? err : null;
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
  it("requires a storagePath (not externalUrl) for pdf", () => {
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

  it("takes exactly one of externalUrl or storagePath for image (the handler refuses the upload)", () => {
    const base = { title: "t", kind: "image", sports: ["figure_skating"] };
    expect(
      createCoachResourceInput.safeParse({ ...base, externalUrl: "https://cdn.example/a.jpg" })
        .success,
    ).toBe(true);
    expect(
      createCoachResourceInput.safeParse({ ...base, storagePath: "coach/1/a.jpg" }).success,
    ).toBe(true);
    expect(createCoachResourceInput.safeParse(base).success).toBe(false);
    expect(
      createCoachResourceInput.safeParse({
        ...base,
        externalUrl: "https://cdn.example/a.jpg",
        storagePath: "coach/1/a.jpg",
      }).success,
    ).toBe(false);
    expect(
      createCoachResourceInput.safeParse({ ...base, externalUrl: "http://cdn.example/a.jpg" })
        .success,
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

  it("rejects an empty extension and one longer than 8 characters", () => {
    expect(
      createCoachResourceUploadUrlInput.safeParse({ ext: "", contentType: "application/pdf" })
        .success,
    ).toBe(false);
    expect(
      createCoachResourceUploadUrlInput.safeParse({
        ext: "a".repeat(9),
        contentType: "application/pdf",
      }).success,
    ).toBe(false);
    expect(
      createCoachResourceUploadUrlInput.safeParse({
        ext: "a".repeat(8),
        contentType: "application/pdf",
      }).success,
    ).toBe(true);
  });

  it("enforces contentType's 3-120 character bounds", () => {
    expect(
      createCoachResourceUploadUrlInput.safeParse({ ext: "pdf", contentType: "ab" }).success,
    ).toBe(false);
    expect(
      createCoachResourceUploadUrlInput.safeParse({ ext: "pdf", contentType: "a".repeat(121) })
        .success,
    ).toBe(false);
    expect(
      createCoachResourceUploadUrlInput.safeParse({ ext: "pdf", contentType: "a".repeat(120) })
        .success,
    ).toBe(true);
  });

  it("accepts any contentType shape; createCoachResourceUploadUrl refuses anything but a PDF", () => {
    // The refusal lives in the handler so the coach reads a sentence, not "validation failed".
    expect(
      createCoachResourceUploadUrlInput.safeParse({ ext: "pdf", contentType: "text/html" }).success,
    ).toBe(true);
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
    expect(result).toEqual({ id: "r1", reviewState: "released" });
    expect(supabase.insertedPayloads.resources).toEqual([
      {
        coach_id: "c1",
        kind: "link",
        title: "t",
        description: "",
        sport: "figure_skating",
        storage_path: null,
        external_url: "https://example.com",
        published: true,
        display_order: 0,
        updated_by: "u1",
      },
    ]);
    expect(supabase.insertedPayloads.resource_sports).toEqual([
      [{ resource_id: "r1", sport: "figure_skating" }],
    ]);
  });

  it("inserts and returns the new id for a Club (org) coach with an allowed sport", async () => {
    const supabase = fakeClient(
      {
        coach_profiles: { id: "c1", organization_id: "org1", subscription_tier: null },
        resources: { id: "c1res" },
      },
      { coach_levels: [{ sport: "hockey" }], resource_sports: [] },
    );
    const result = await createCoachResource(
      { userId: "u1", supabase },
      createCoachResourceInput.parse({
        title: "t",
        kind: "link",
        sports: ["hockey"],
        externalUrl: "https://example.com",
      }),
    );
    expect(result).toEqual({ id: "c1res", reviewState: "released" });
  });

  it("rolls back the inserted resource row when tagging it with resource_sports fails", async () => {
    const supabase = fakeClient(
      {
        coach_profiles: { id: "c1", organization_id: null, subscription_tier: "coach_pro" },
        resources: { id: "r1" },
      },
      { coach_levels: [{ sport: "figure_skating" }] },
      { resource_sports: { message: "tag insert failed" } },
    );
    const err = await caughtAny(() =>
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
    // resource_sports's error isn't in `dbError`'s passthrough list, so it surfaces as the
    // generic fallback message rather than the raw db error.
    expect(err?.message).toBe("Something went wrong. Please try again.");
    // The compensating delete of the just-inserted resources row actually happened.
    expect(supabase.deletedIds.resources).toEqual(["r1"]);
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

/** A fetch stand-in answering each call in turn; records the methods it saw. */
function fakeFetch(...answers: Array<{ status: number; type?: string } | Error>) {
  const calls: string[] = [];
  const impl = (async (_url: string, init?: RequestInit) => {
    calls.push(init?.method ?? "GET");
    const next = answers.shift();
    if (!next) throw new Error("unexpected fetch");
    if (next instanceof Error) throw next;
    return new Response(null, {
      status: next.status,
      headers: next.type ? { "content-type": next.type } : {},
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const NOT_A_PUBLIC_IMAGE =
  "That link isn't a publicly available image. Paste a direct https link to a JPG, PNG, GIF, or WebP that opens without signing in.";

describe("assertPublicImageUrl", () => {
  it("identifies itself with a User-Agent (some hosts refuse anonymous clients)", async () => {
    let ua: string | null = null;
    const impl = (async (_u: string, init?: RequestInit) => {
      ua = new Headers(init?.headers).get("user-agent");
      return new Response(null, { status: 200, headers: { "content-type": "image/png" } });
    }) as unknown as typeof fetch;
    await assertPublicImageUrl("https://upload.example/a.png", impl);
    expect(ua).toContain("GradusLinkCheck");
  });

  it("accepts a URL that answers a HEAD with a raster image type", async () => {
    const f = fakeFetch({ status: 200, type: "image/jpeg; charset=binary" });
    await assertPublicImageUrl("https://cdn.example/a.jpg", f.impl);
    expect(f.calls).toEqual(["HEAD"]);
  });

  it("falls back to a one-byte GET when the host refuses HEAD", async () => {
    const f = fakeFetch({ status: 405 }, { status: 206, type: "image/png" });
    await assertPublicImageUrl("https://cdn.example/a.png", f.impl);
    expect(f.calls).toEqual(["HEAD", "GET"]);
  });

  it("refuses a share page that answers HTML (e.g. a photos album link)", async () => {
    const f = fakeFetch({ status: 200, type: "text/html" });
    const err = await caught(() => assertPublicImageUrl("https://photos.example/share/x", f.impl));
    expect(err?.status).toBe(422);
    expect(err?.message).toBe(NOT_A_PUBLIC_IMAGE);
  });

  it("refuses an image behind a sign-in", async () => {
    const f = fakeFetch({ status: 403, type: "image/jpeg" }, { status: 403, type: "image/jpeg" });
    const err = await caught(() => assertPublicImageUrl("https://cdn.example/private.jpg", f.impl));
    expect(err?.message).toBe(NOT_A_PUBLIC_IMAGE);
  });

  it("refuses SVG, which the apps can't show", async () => {
    const f = fakeFetch({ status: 200, type: "image/svg+xml" });
    const err = await caught(() => assertPublicImageUrl("https://cdn.example/a.svg", f.impl));
    expect(err?.message).toBe(NOT_A_PUBLIC_IMAGE);
  });

  it("refuses private hosts and credentials in the URL without fetching", async () => {
    for (const url of [
      "https://localhost/a.jpg",
      "https://127.0.0.1/a.jpg",
      "https://10.0.0.4/a.jpg",
      "https://192.168.1.9/a.jpg",
      "https://172.20.0.1/a.jpg",
      "https://169.254.169.254/a.jpg",
      "https://[::1]/a.jpg",
      "https://nas.local/a.jpg",
      "https://user:pw@cdn.example/a.jpg",
      "http://cdn.example/a.jpg",
    ]) {
      const f = fakeFetch();
      const err = await caught(() => assertPublicImageUrl(url, f.impl));
      expect(err?.message).toBe(NOT_A_PUBLIC_IMAGE);
      expect(f.calls).toEqual([]);
    }
  });

  it("says the link couldn't be reached when the fetch fails", async () => {
    const f = fakeFetch(new TypeError("network"));
    const err = await caught(() => assertPublicImageUrl("https://cdn.example/a.jpg", f.impl));
    expect(err?.status).toBe(422);
    expect(err?.message).toContain("couldn't reach that image link");
  });
});

describe("createCoachResource — images come only from a public URL", () => {
  const proCoach = () =>
    fakeClient(
      {
        coach_profiles: { id: "c1", organization_id: null, subscription_tier: "coach_pro" },
        resources: { id: "r1" },
      },
      { coach_levels: [{ sport: "figure_skating" }], resource_sports: [] },
    );

  it("refuses an uploaded image (e.g. from an older app) and writes nothing", async () => {
    const supabase = proCoach();
    const err = await caught(() =>
      createCoachResource(
        { userId: "u1", supabase },
        createCoachResourceInput.parse({
          title: "t",
          kind: "image",
          sports: ["figure_skating"],
          storagePath: "coach/c1/a.jpg",
        }),
      ),
    );
    expect(err?.status).toBe(422);
    expect(err?.message).toBe(IMAGE_UPLOAD_REFUSED);
    expect(supabase.insertedPayloads.resources).toBeUndefined();
  });

  it("saves an image link once it checks out as public", async () => {
    const supabase = proCoach();
    const f = fakeFetch({ status: 200, type: "image/webp" });
    const result = await createCoachResource(
      { userId: "u1", supabase, fetchImpl: f.impl },
      createCoachResourceInput.parse({
        title: "t",
        kind: "image",
        sports: ["figure_skating"],
        externalUrl: "https://cdn.example/a.webp",
      }),
    );
    expect(result).toEqual({ id: "r1", reviewState: "released" });
    const [row] = supabase.insertedPayloads.resources as Array<Record<string, unknown>>;
    expect(row.kind).toBe("image");
    expect(row.external_url).toBe("https://cdn.example/a.webp");
    expect(row.storage_path).toBeNull();
  });

  it("refuses an image link that isn't public and writes nothing", async () => {
    const supabase = proCoach();
    const f = fakeFetch({ status: 200, type: "text/html" });
    const err = await caught(() =>
      createCoachResource(
        { userId: "u1", supabase, fetchImpl: f.impl },
        createCoachResourceInput.parse({
          title: "t",
          kind: "image",
          sports: ["figure_skating"],
          externalUrl: "https://photos.example/share/x",
        }),
      ),
    );
    expect(err?.message).toBe(NOT_A_PUBLIC_IMAGE);
    expect(supabase.insertedPayloads.resources).toBeUndefined();
  });
});

describe("createCoachResource — a PDF must be the coach's own upload", () => {
  it("refuses a storagePath outside the coach's folder or not ending .pdf, and writes nothing", async () => {
    for (const storagePath of [
      "coach/other-coach/a.pdf",
      "library/figure_skating/rulebook.pdf",
      "coach/c1/a.jpg",
      "coach/c1/../other/a.pdf",
    ]) {
      const supabase = fakeClient(
        {
          coach_profiles: { id: "c1", organization_id: null, subscription_tier: "coach_pro" },
          resources: { id: "r1" },
        },
        { coach_levels: [{ sport: "figure_skating" }], resource_sports: [] },
      );
      const err = await caught(() =>
        createCoachResource(
          { userId: "u1", supabase },
          createCoachResourceInput.parse({
            title: "t",
            kind: "pdf",
            sports: ["figure_skating"],
            storagePath,
          }),
        ),
      );
      expect(err?.status).toBe(422);
      expect(supabase.insertedPayloads.resources).toBeUndefined();
    }
  });
});

describe("createCoachResourceUploadUrl — PDF only", () => {
  it("refuses an image, whatever it claims to be, before signing anything", async () => {
    const supabase = fakeClient({
      coach_profiles: { id: "c1", organization_id: null, subscription_tier: "coach_pro" },
    });
    for (const data of [
      { ext: "jpg", contentType: "image/jpeg" },
      { ext: "heic", contentType: "image/heic" },
      { ext: "pdf", contentType: "image/jpeg" },
      { ext: "mov", contentType: "video/quicktime" },
    ]) {
      const err = await caught(() =>
        createCoachResourceUploadUrl(
          { userId: "u1", supabase },
          createCoachResourceUploadUrlInput.parse(data),
        ),
      );
      expect(err?.status).toBe(422);
      expect(err?.message).toBe(PDF_ONLY);
    }
  });
});
