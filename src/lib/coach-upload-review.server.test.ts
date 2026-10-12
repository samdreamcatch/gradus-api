import { describe, expect, it } from "bun:test";
import { NOT_A_PDF, createCoachResource, createCoachResourceInput } from "./coach-resources.server";
import {
  outcomeOf,
  rejectUpload,
  releaseUpload,
  sweepCoachUploads,
} from "./coach-upload-review.server";
import type { PdfCheck } from "./resource-file-check.server";

/** The coach's own client: resources insert answers `inserted`. */
function coachClient(inserted = { id: "r1" }) {
  const writes: Record<string, unknown[]> = {};
  const chain = (table: string) => {
    const self: Record<string, unknown> = {};
    for (const m of ["select", "eq", "neq", "in", "is", "not", "order", "limit", "delete"]) {
      self[m] = () => self;
    }
    self.insert = (payload: unknown) => {
      (writes[table] ??= []).push(payload);
      return self;
    };
    self.maybeSingle = async () => ({
      data:
        table === "coach_profiles"
          ? { id: "c1", organization_id: null, subscription_tier: "coach_pro" }
          : null,
      error: null,
    });
    self.single = async () => ({ data: inserted, error: null });
    self.then = (resolve: (v: unknown) => void) =>
      resolve({
        data: table === "coach_levels" ? [{ sport: "figure_skating" }] : [],
        error: null,
      });
    return self;
  };
  return { from: chain, writes };
}

/** The service-role client: storage, resources updates, coach lookup, email queue. */
function fakeAdmin(
  opts: { file?: Uint8Array | null; pending?: unknown[]; orphans?: string[] } = {},
) {
  const removed: string[][] = [];
  const updates: Array<{ table: string; patch: unknown; id?: string }> = [];
  const deleted: Array<{ table: string; id: string }> = [];
  const emails: Array<{ to: string; subject: string }> = [];
  const chain = (table: string) => {
    let patch: unknown = null;
    let deleting = false;
    const self: Record<string, unknown> = {};
    for (const m of ["select", "neq", "order", "limit", "in"]) self[m] = () => self;
    self.update = (p: unknown) => {
      patch = p;
      return self;
    };
    self.delete = () => {
      deleting = true;
      return self;
    };
    self.eq = (_col: string, value: string) => {
      if (patch) updates.push({ table, patch, id: value });
      if (deleting) deleted.push({ table, id: value });
      patch = null;
      deleting = false;
      return self;
    };
    self.insert = () => self;
    self.single = async () => ({ data: { id: "ks1" }, error: null });
    self.maybeSingle = async () => {
      if (table === "coach_profiles")
        return { data: { first_name: "Renata", last_name: "Pruitt", user_id: "u1" }, error: null };
      if (table === "resources")
        return {
          data: { id: "r9", title: "Edge drill", coach_id: "c1", storage_path: "coach/c1/x.pdf" },
          error: null,
        };
      return { data: null, error: null };
    };
    self.then = (resolve: (v: unknown) => void) =>
      resolve({ data: table === "resources" ? (opts.pending ?? []) : [], error: null });
    return self;
  };
  return {
    from: chain,
    storage: {
      from: () => ({
        download: async () =>
          opts.file === null
            ? { data: null, error: { message: "not found" } }
            : { data: new Blob([new Uint8Array(opts.file ?? [1])]), error: null },
        remove: async (names: string[]) => {
          removed.push(names);
          return { error: null };
        },
      }),
    },
    auth: {
      admin: {
        getUserById: async () => ({ data: { user: { email: "renata.pruitt@example.com" } } }),
      },
    },
    rpc: async (name: string, args: { payload?: { to: string; subject: string } }) => {
      if (name === "enqueue_email" && args.payload) emails.push(args.payload);
      if (name === "orphan_coach_upload_paths")
        return { data: (opts.orphans ?? []).map((n) => ({ name: n })), error: null };
      return { data: null, error: null };
    },
    removed,
    updates,
    deleted,
    emails,
  };
}

const pdfInput = createCoachResourceInput.parse({
  title: "Edge drill",
  kind: "pdf",
  sports: ["figure_skating"],
  storagePath: "coach/c1/a.pdf",
});
const verdict = (v: PdfCheck) => async () => v;

describe("coach upload review", () => {
  it("maps the PDF check onto release, hold, or refuse", () => {
    expect(outcomeOf({ verdict: "clean", pages: 3 })).toEqual({ outcome: "released" });
    expect(outcomeOf({ verdict: "pictures", pages: 3, firstPage: 2 })).toEqual({
      outcome: "held",
      reason: "pictures",
    });
    expect(outcomeOf({ verdict: "unreadable", reason: "encrypted" })).toEqual({
      outcome: "held",
      reason: "encrypted",
    });
    expect(outcomeOf({ verdict: "not_pdf" })).toEqual({ outcome: "not_pdf" });
  });

  it("releases a PDF with no pictures at once, and emails no one", async () => {
    const admin = fakeAdmin();
    const result = await createCoachResource(
      {
        userId: "u1",
        supabase: coachClient() as never,
        uploadReview: { admin, check: verdict({ verdict: "clean", pages: 1 }) },
      },
      pdfInput,
    );
    expect(result).toEqual({ id: "r1", reviewState: "released" });
    expect(admin.updates).toEqual([
      { table: "resources", patch: { review_state: "released", review_reason: null }, id: "r1" },
    ]);
    expect(admin.emails).toEqual([]);
  });

  it("holds a PDF with pictures and emails support@gradussports.com", async () => {
    const admin = fakeAdmin();
    const result = await createCoachResource(
      {
        userId: "u1",
        supabase: coachClient() as never,
        uploadReview: { admin, check: verdict({ verdict: "pictures", pages: 2, firstPage: 1 }) },
      },
      pdfInput,
    );
    expect(result).toEqual({ id: "r1", reviewState: "held" });
    expect(admin.updates[0]).toEqual({
      table: "resources",
      patch: { review_state: "held", review_reason: "pictures" },
      id: "r1",
    });
    expect(admin.emails).toHaveLength(1);
    expect(admin.emails[0].to).toBe("support@gradussports.com");
    expect(admin.emails[0].subject).toContain("Edge drill");
  });

  it("refuses a file that isn't a PDF: deletes it and writes no resource", async () => {
    const admin = fakeAdmin();
    const coach = coachClient();
    let message = "";
    try {
      await createCoachResource(
        {
          userId: "u1",
          supabase: coach as never,
          uploadReview: { admin, check: verdict({ verdict: "not_pdf" }) },
        },
        pdfInput,
      );
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toBe(NOT_A_PDF);
    expect(admin.removed).toEqual([["coach/c1/a.pdf"]]);
    expect(coach.writes.resources).toBeUndefined();
  });

  it("holds an upload whose file is missing from storage", async () => {
    const admin = fakeAdmin({ file: null });
    const result = await createCoachResource(
      {
        userId: "u1",
        supabase: coachClient() as never,
        uploadReview: { admin, check: verdict({ verdict: "clean", pages: 1 }) },
      },
      pdfInput,
    );
    expect(result.reviewState).toBe("held");
    expect(admin.updates[0].patch).toEqual({ review_state: "held", review_reason: "missing_file" });
  });

  it("sweeps files waiting for a check, then deletes orphaned uploads", async () => {
    const admin = fakeAdmin({
      pending: [
        { id: "p1", title: "Old PDF", coach_id: "c1", storage_path: "coach/c1/p1.pdf" },
        { id: "p2", title: "Old PDF 2", coach_id: "c1", storage_path: "coach/c1/p2.pdf" },
      ],
      orphans: ["coach/c1/stray.pdf"],
    });
    let n = 0;
    const result = await sweepCoachUploads(admin, {
      check: async () =>
        n++ === 0
          ? { verdict: "clean", pages: 1 }
          : { verdict: "pictures", pages: 1, firstPage: 1 },
    });
    expect(result).toEqual({ checked: 2, released: 1, held: 1, deleted: 0, orphansRemoved: 1 });
    expect(admin.removed).toEqual([["coach/c1/stray.pdf"]]);
    expect(admin.emails).toHaveLength(1);
  });

  it("releases on review, and rejecting deletes the file and row and tells the coach", async () => {
    const admin = fakeAdmin();
    await releaseUpload(admin, "r9", "admin-user");
    expect(admin.updates[0]).toMatchObject({
      table: "resources",
      id: "r9",
      patch: { review_state: "released", review_reason: null, reviewed_by: "admin-user" },
    });

    const admin2 = fakeAdmin();
    await rejectUpload(admin2, "r9");
    expect(admin2.removed).toEqual([["coach/c1/x.pdf"]]);
    expect(admin2.deleted).toEqual([{ table: "resources", id: "r9" }]);
    expect(admin2.emails).toHaveLength(1);
    expect(admin2.emails[0].to).toBe("renata.pruitt@example.com");
  });
});
