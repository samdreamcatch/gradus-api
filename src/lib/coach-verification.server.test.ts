import { describe, expect, it } from "bun:test";
import { ApiError } from "@/lib/api/errors";
import {
  adminGetVerification,
  adminOverrideVerification,
  applySession,
  assertVerifiedToPublish,
  effectiveIdentityStatus,
  failureReasonFor,
  getMyVerification,
  startIdentityVerification,
  statusFromSession,
  toState,
  verifiedCoachIds,
  type IdentityStripe,
  type VerificationRow,
} from "./coach-verification.server";
import { isVerifiedCoach } from "./marketplace-plans.server";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** An in-memory stand-in for the service-role client: coach_profiles and coach_verifications. */
function fakeAdmin(
  opts: { tier?: string; missingTable?: boolean; row?: Partial<VerificationRow> | null } = {},
) {
  const db = {
    coach: {
      id: "coach-1",
      user_id: "user-1",
      checklist: { identityVerification: false } as Record<string, boolean>,
    },
    row: (opts.row
      ? {
          coach_id: "coach-1",
          identity_status: "not_started",
          safesport_status: "not_started",
          vendor: "stripe_identity",
          ...opts.row,
        }
      : null) as any,
  };
  const missing = {
    data: null,
    error: {
      code: "PGRST205",
      message: "Could not find the table 'public.coach_verifications' in the schema cache",
    },
  };
  const from = (table: string) => {
    const q: any = {};
    let op = "select";
    let payload: any = null;
    q.select = () => q;
    q.eq = () => q;
    q.upsert = (p: any) => ((op = "upsert"), (payload = p), q);
    q.update = (p: any) => ((op = "update"), (payload = p), q);
    const run = () => {
      if (table === "coach_verifications") {
        if (opts.missingTable) return missing;
        if (op === "upsert")
          db.row = {
            ...(db.row ?? {
              identity_status: "not_started",
              safesport_status: "not_started",
              vendor: "stripe_identity",
            }),
            ...payload,
          };
        return { data: db.row, error: null };
      }
      if (table === "coach_profiles") {
        if (op === "update") Object.assign(db.coach, payload);
        return { data: db.coach, error: null };
      }
      return { data: null, error: null };
    };
    q.maybeSingle = async () => run();
    q.single = async () => run();
    q.then = (resolve: (v: unknown) => void) => resolve(run());
    return q;
  };
  return {
    db,
    admin: {
      from,
      rpc: async () => ({ data: opts.tier ?? "coach_pro", error: null }),
    } as any,
  };
}

function fakeStripe(retrieved?: any) {
  const created: any[] = [];
  const stripe: IdentityStripe = {
    identity: {
      verificationSessions: {
        create: (async (params: any) => {
          created.push(params);
          return {
            id: "vs_new",
            url: "https://verify.stripe.com/start/test_abc",
            status: "requires_input",
          };
        }) as any,
        retrieve: (async () => retrieved) as any,
      },
    },
  };
  return { stripe, created };
}

async function caught(run: () => Promise<unknown>): Promise<ApiError | null> {
  try {
    await run();
    return null;
  } catch (e) {
    return e instanceof ApiError ? e : null;
  }
}

describe("mapping Stripe's result", () => {
  it("verified passes, processing is pending, canceled starts over", () => {
    expect(statusFromSession({ status: "verified" }).status).toBe("passed");
    expect(statusFromSession({ status: "processing" }).status).toBe("pending");
    expect(statusFromSession({ status: "canceled" }).status).toBe("not_started");
  });

  it("waiting for input with an error fails with a reason the coach can act on; without one it's still open", () => {
    const failed = statusFromSession({
      status: "requires_input",
      last_error: { code: "selfie_face_mismatch" },
    });
    expect(failed.status).toBe("failed");
    expect(failed.failureReason).toContain("selfie didn't match");
    expect(statusFromSession({ status: "requires_input", last_error: null }).status).toBe(
      "pending",
    );
  });

  it("an unknown error code still says what to do", () => {
    expect(failureReasonFor("something_new")).toBe("We couldn't verify your identity. Try again.");
  });

  it("an admin override wins over Stripe's result", () => {
    expect(effectiveIdentityStatus({ identity_status: "failed", override_status: "passed" })).toBe(
      "passed",
    );
    expect(effectiveIdentityStatus({ identity_status: "passed", override_status: null })).toBe(
      "passed",
    );
    expect(effectiveIdentityStatus(null)).toBe("not_started");
  });

  it("the coach's state carries the reason only when failed", () => {
    const row = {
      identity_status: "failed",
      identity_failure_reason: "Your ID has expired.",
      override_status: null,
    } as any;
    expect(toState(row).failureReason).toBe("Your ID has expired.");
    expect(toState({ ...row, identity_status: "passed" }).failureReason).toBeNull();
  });
});

describe("starting a check", () => {
  it("opens a document check with a live capture and a matching selfie, and records it as in progress", async () => {
    const { admin, db } = fakeAdmin();
    const { stripe, created } = fakeStripe();
    const out = await startIdentityVerification(
      { userId: "user-1", admin, stripe },
      { returnUrl: "https://x.test/verification/complete" },
    );
    expect(out).toEqual({
      status: "pending",
      failureReason: null,
      startURL: "https://verify.stripe.com/start/test_abc",
    });
    expect(created[0].type).toBe("document");
    expect(created[0].options.document.require_matching_selfie).toBe(true);
    expect(created[0].options.document.require_live_capture).toBe(true);
    expect(created[0].metadata.coach_id).toBe("coach-1");
    expect(created[0].return_url).toBe("https://x.test/verification/complete");
    expect(db.row.identity_status).toBe("pending");
    expect(db.row.identity_session_id).toBe("vs_new");
  });

  it("a basic coach is refused: verification is Coach Pro only", async () => {
    const { admin } = fakeAdmin({ tier: "coach" });
    const err = await caught(() =>
      startIdentityVerification(
        { userId: "user-1", admin, stripe: fakeStripe().stripe },
        { returnUrl: "https://x.test/r" },
      ),
    );
    expect(err?.status).toBe(403);
    expect(err?.code).toBe("coach_pro_required");
  });

  it("an already verified coach gets no new session", async () => {
    const { admin } = fakeAdmin({ row: { identity_status: "passed" } });
    const { stripe, created } = fakeStripe();
    const out = await startIdentityVerification(
      { userId: "user-1", admin, stripe },
      { returnUrl: "https://x.test/r" },
    );
    expect(out.status).toBe("passed");
    expect(created).toHaveLength(0);
  });

  it("before the migration is applied, starting answers 503 and reading says not started", async () => {
    const { admin } = fakeAdmin({ missingTable: true });
    const err = await caught(() =>
      startIdentityVerification(
        { userId: "user-1", admin, stripe: fakeStripe().stripe },
        { returnUrl: "https://x.test/r" },
      ),
    );
    expect(err?.status).toBe(503);
    const state = await getMyVerification({ userId: "user-1", admin, stripe: fakeStripe().stripe });
    expect(state.status).toBe("not_started");
    expect(state.available).toBe(false);
  });
});

describe("recording the outcome", () => {
  it("a verified session passes the coach and ticks the checklist", async () => {
    const { admin, db } = fakeAdmin({
      row: { identity_status: "pending", identity_session_id: "vs_1" },
    });
    await applySession(admin, {
      id: "vs_1",
      status: "verified",
      metadata: { coach_id: "coach-1" },
    });
    expect(db.row.identity_status).toBe("passed");
    expect(db.row.identity_checked_at).toBeTruthy();
    expect(db.coach.checklist.identityVerification).toBe(true);
  });

  it("an older session than the coach's latest is ignored", async () => {
    const { admin, db } = fakeAdmin({
      row: { identity_status: "pending", identity_session_id: "vs_2" },
    });
    await applySession(admin, {
      id: "vs_1",
      status: "verified",
      metadata: { coach_id: "coach-1" },
    });
    expect(db.row.identity_status).toBe("pending");
  });

  it("reading asks Stripe about a session still open, so a missed webhook doesn't strand the coach", async () => {
    const { admin } = fakeAdmin({
      row: { identity_status: "pending", identity_session_id: "vs_1" },
    });
    const { stripe } = fakeStripe({
      id: "vs_1",
      status: "requires_input",
      metadata: { coach_id: "coach-1" },
      last_error: { code: "document_expired" },
    });
    const state = await getMyVerification({ userId: "user-1", admin, stripe });
    expect(state.status).toBe("failed");
    expect(state.failureReason).toContain("expired");
  });
});

describe("admin override", () => {
  it("records the status, reason and who, and updates the checklist", async () => {
    const { admin, db } = fakeAdmin({ row: { identity_status: "failed" } });
    const out = await adminOverrideVerification(
      admin,
      "coach-1",
      { status: "passed", reason: "Checked ID in person" },
      "admin-9",
    );
    expect(out.status).toBe("passed");
    expect(out.overridden).toBe(true);
    expect(db.row.override_reason).toBe("Checked ID in person");
    expect(db.row.override_by).toBe("admin-9");
    expect(db.coach.checklist.identityVerification).toBe(true);
  });

  it("refuses an override without a reason", async () => {
    const { admin } = fakeAdmin({ row: { identity_status: "failed" } });
    await expect(
      adminOverrideVerification(admin, "coach-1", { status: "passed", reason: " " }, "admin-9"),
    ).rejects.toThrow();
  });

  it("before the migration, the admin view says it isn't set up", async () => {
    const { admin } = fakeAdmin({ missingTable: true });
    expect((await adminGetVerification(admin, "coach-1")).available).toBe(false);
  });
});

describe("the switch (MARKETPLACE_REQUIRE_VERIFICATION)", () => {
  it("off: an unverified coach can still publish", async () => {
    const { admin } = fakeAdmin({ row: { identity_status: "not_started" } });
    await assertVerifiedToPublish(admin, "coach-1", {});
  });

  it("on: an unverified coach can't publish; a verified one can", async () => {
    const on = { MARKETPLACE_REQUIRE_VERIFICATION: "true" };
    const { admin } = fakeAdmin({ row: { identity_status: "pending" } });
    const err = await caught(() => assertVerifiedToPublish(admin, "coach-1", on));
    expect(err?.status).toBe(403);
    expect(err?.code).toBe("verification_required");
    const passed = fakeAdmin({ row: { identity_status: "passed" } });
    await assertVerifiedToPublish(passed.admin, "coach-1", on);
  });
});

describe("the Verified badge", () => {
  it("only a Coach Pro coach who passed verification gets it, whatever the switch", () => {
    const pro = { subscription_tier: "coach_pro", organization_id: null };
    expect(isVerifiedCoach(pro, true)).toBe(true);
    expect(isVerifiedCoach(pro, false)).toBe(false);
  });

  it("reads passed results (and passed overrides) from the table; a missing table means nobody", async () => {
    const rows = [
      { coach_id: "a", identity_status: "passed", override_status: null },
      { coach_id: "b", identity_status: "pending", override_status: null },
      { coach_id: "c", identity_status: "failed", override_status: "passed" },
      { coach_id: "d", identity_status: "passed", override_status: "failed" },
    ];
    const chain = (result: unknown) => ({ select: () => ({ in: async () => result }) });
    const ok = { from: () => chain({ data: rows, error: null }) } as any;
    expect([...(await verifiedCoachIds(ok, ["a", "b", "c", "d"]))].sort()).toEqual(["a", "c"]);
    const missing = {
      from: () =>
        chain({
          data: null,
          error: { code: "PGRST205", message: "coach_verifications schema cache" },
        }),
    } as any;
    expect((await verifiedCoachIds(missing, ["a"])).size).toBe(0);
  });
});
