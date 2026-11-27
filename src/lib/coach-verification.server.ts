/**
 * Coach verification for the marketplace (scope: "Coach verification").
 *
 * Identity runs through Stripe Identity on the platform's own Stripe account
 * (the same key as Connect payouts): a document VerificationSession with a
 * live capture and a matching selfie. The coach completes Stripe's hosted
 * page (from the app, in the secure sheet), Stripe reports the outcome by
 * webhook (`/api/public/webhooks/stripe-identity`), and a read also asks
 * Stripe about a session still open, so a missed webhook never strands a
 * coach. Only the result and dates are kept (`coach_verifications`), never
 * images.
 *
 * SafeSport has no vendor yet: an admin records it. An admin can also
 * override the identity result, only with a reason.
 *
 * Until the `coach_verifications` migration is applied, every read answers
 * "not started" and starting a check answers 503: nothing else breaks.
 * Publishing requires a verified coach only when MARKETPLACE_REQUIRE_VERIFICATION
 * is "true", so turning it on is a deliberate step once the table exists.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type Stripe from "stripe";
import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { dbError } from "./db-error";
import { createConnectStripeClient } from "./stripe-connect.server";

type Admin = any;

export type VerificationStatus = "not_started" | "pending" | "passed" | "failed";

export type IdentityStripe = {
  identity: {
    verificationSessions: Pick<Stripe["identity"]["verificationSessions"], "create" | "retrieve">;
  };
};

export type VerificationRow = {
  coach_id: string;
  vendor: string;
  identity_status: VerificationStatus;
  identity_session_id: string | null;
  identity_failure_reason: string | null;
  identity_checked_at: string | null;
  safesport_status: VerificationStatus;
  safesport_checked_at: string | null;
  next_recheck_at: string | null;
  override_status: "passed" | "failed" | null;
  override_reason: string | null;
  override_by: string | null;
  override_at: string | null;
};

const COLUMNS =
  "coach_id, vendor, identity_status, identity_session_id, identity_failure_reason, identity_checked_at, safesport_status, safesport_checked_at, next_recheck_at, override_status, override_reason, override_by, override_at";

/** What the coach's app shows (`GET /api/v1/marketplace/seller/verification`). */
export const verificationStateSchema = z.object({
  status: z.enum(["not_started", "pending", "passed", "failed"]),
  failureReason: z.string().nullable(),
  safeSportStatus: z.enum(["not_started", "pending", "passed", "failed"]),
  checkedAt: z.string().nullable(),
  nextCheckAt: z.string().nullable(),
  /** An admin set the identity result by hand (with a recorded reason). */
  overridden: z.boolean(),
  /** False until the verification table exists on this server. */
  available: z.boolean(),
});
export type VerificationState = z.infer<typeof verificationStateSchema>;

/** `POST …/verification` and `…/retry`. Keys match the iOS `MarketplaceVerificationResult`. */
export const verificationStartSchema = z.object({
  status: z.enum(["not_started", "pending", "passed", "failed"]),
  failureReason: z.string().nullable(),
  startURL: z.string().url().nullable(),
});
export type VerificationStart = z.infer<typeof verificationStartSchema>;

export const verificationOverrideInput = z.object({
  /** `null` clears an override, leaving Stripe's result. */
  status: z.enum(["passed", "failed"]).nullable(),
  reason: z.string().trim().min(3, "Give a reason for the override.").max(500),
});

// ---------- pure helpers ----------

/** What a coach can do about each Stripe failure, in plain words. */
const FAILURE_REASONS: Record<string, string> = {
  document_expired: "Your ID has expired. Try again with a current ID.",
  document_type_not_supported:
    "That kind of ID isn't accepted. Use a driver's license, passport or state ID card.",
  document_unverified_other:
    "We couldn't verify your ID. Try again with a clear photo of the whole ID.",
  selfie_document_missing_photo:
    "Your ID's photo couldn't be read. Try again with a clear photo of your ID.",
  selfie_face_mismatch:
    "Your selfie didn't match the photo on your ID. Try again in good light, facing the camera.",
  selfie_manipulated: "Your selfie couldn't be verified. Try again with a live selfie.",
  selfie_unverified_other:
    "We couldn't verify your selfie. Try again in good light, facing the camera.",
  consent_declined: "Verification needs your consent. Try again and accept to continue.",
  under_supported_age: "Coaches selling on Gradus must be adults.",
  country_not_supported: "IDs from that country aren't supported yet.",
  device_not_supported: "This device can't take the photos. Try again on a phone with a camera.",
  abandoned: "Verification wasn't finished. Try again when you're ready.",
};

export function failureReasonFor(
  code: string | null | undefined,
  fallback?: string | null,
): string {
  if (code && FAILURE_REASONS[code]) return FAILURE_REASONS[code];
  return fallback?.trim() || "We couldn't verify your identity. Try again.";
}

/** Stripe's session status as ours. A session waiting for input with no error is still open. */
export function statusFromSession(session: {
  status: string;
  last_error?: { code?: string | null; reason?: string | null } | null;
}): { status: VerificationStatus; failureReason: string | null } {
  switch (session.status) {
    case "verified":
      return { status: "passed", failureReason: null };
    case "processing":
      return { status: "pending", failureReason: null };
    case "canceled":
      return { status: "not_started", failureReason: null };
    case "requires_input":
      return session.last_error?.code
        ? {
            status: "failed",
            failureReason: failureReasonFor(session.last_error.code, session.last_error.reason),
          }
        : { status: "pending", failureReason: null };
    default:
      return { status: "pending", failureReason: null };
  }
}

/** The identity result the marketplace acts on: an admin override wins. */
export function effectiveIdentityStatus(
  row: Pick<VerificationRow, "identity_status" | "override_status"> | null,
): VerificationStatus {
  if (!row) return "not_started";
  return row.override_status ?? row.identity_status;
}

export function toState(row: VerificationRow | null, available = true): VerificationState {
  const status = effectiveIdentityStatus(row);
  return {
    status,
    failureReason:
      status === "failed"
        ? row?.override_status === "failed"
          ? "An admin couldn't confirm your identity. Contact Gradus support."
          : (row?.identity_failure_reason ?? failureReasonFor(null))
        : null,
    safeSportStatus: row?.safesport_status ?? "not_started",
    checkedAt:
      row?.override_at && row.override_status
        ? row.override_at
        : (row?.identity_checked_at ?? null),
    nextCheckAt: row?.next_recheck_at ?? null,
    overridden: !!row?.override_status,
    available,
  };
}

export function verificationRequiredToPublish(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.MARKETPLACE_REQUIRE_VERIFICATION === "true";
}

// ---------- data ----------

/** The table isn't there yet (migration not applied): PostgREST's "unknown table". */
function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "PGRST205" ||
    error.code === "42P01" ||
    (/coach_verifications/.test(error.message ?? "") &&
      /(does not exist|schema cache)/.test(error.message ?? ""))
  );
}

const notAvailable = () =>
  new ApiError({
    code: "verification_unavailable",
    status: 503,
    message: "Verification isn't available yet. Try again later.",
  });

export async function coachIdForUser(admin: Admin, userId: string): Promise<string> {
  const { data, error } = await admin
    .from("coach_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) dbError(error);
  if (!data)
    throw new ApiError({
      code: "forbidden",
      status: 403,
      message: "Only coaches can verify to sell.",
    });
  return data.id as string;
}

/** The coach's row, `null` when there is none yet, or `undefined` when the table doesn't exist. */
export async function readVerification(
  admin: Admin,
  coachId: string,
): Promise<VerificationRow | null | undefined> {
  const { data, error } = await admin
    .from("coach_verifications")
    .select(COLUMNS)
    .eq("coach_id", coachId)
    .maybeSingle();
  if (isMissingTable(error)) return undefined;
  if (error) dbError(error);
  return (data as VerificationRow | null) ?? null;
}

async function writeVerification(
  admin: Admin,
  coachId: string,
  patch: Partial<VerificationRow>,
): Promise<VerificationRow> {
  const { data, error } = await admin
    .from("coach_verifications")
    .upsert({ coach_id: coachId, ...patch }, { onConflict: "coach_id" })
    .select(COLUMNS)
    .single();
  if (isMissingTable(error)) throw notAvailable();
  if (error) dbError(error);
  return data as VerificationRow;
}

/** Keeps the setup checklist's "Verify identity" tick in step with the result. */
async function syncChecklist(admin: Admin, coachId: string, passed: boolean): Promise<void> {
  const { data, error } = await admin
    .from("coach_profiles")
    .select("checklist")
    .eq("id", coachId)
    .maybeSingle();
  if (error || !data) return;
  const checklist = {
    ...((data.checklist as Record<string, boolean> | null) ?? {}),
    identityVerification: passed,
  };
  const { error: upErr } = await admin
    .from("coach_profiles")
    .update({ checklist })
    .eq("id", coachId);
  if (upErr) console.error("[verification] checklist sync failed", upErr);
}

/** Records a Stripe session's outcome on its coach. Ignores a session that isn't the coach's latest. */
export async function applySession(
  admin: Admin,
  session: {
    id: string;
    status: string;
    metadata?: Record<string, string> | null;
    last_error?: { code?: string | null; reason?: string | null } | null;
  },
  now: () => Date = () => new Date(),
): Promise<VerificationRow | null> {
  const coachId = session.metadata?.coach_id;
  if (!coachId) return null;
  const current = await readVerification(admin, coachId);
  if (current === undefined) return null;
  if (current?.identity_session_id && current.identity_session_id !== session.id) return current;
  const outcome = statusFromSession(session);
  const finished = outcome.status === "passed" || outcome.status === "failed";
  const row = await writeVerification(admin, coachId, {
    identity_status: outcome.status,
    identity_session_id: session.id,
    identity_failure_reason: outcome.failureReason,
    ...(finished ? { identity_checked_at: now().toISOString() } : {}),
  });
  if (finished) await syncChecklist(admin, coachId, effectiveIdentityStatus(row) === "passed");
  return row;
}

export type VerificationContext = {
  userId: string;
  admin: Admin;
  stripe?: IdentityStripe;
};

const stripeOf = (ctx: VerificationContext): IdentityStripe =>
  ctx.stripe ?? (createConnectStripeClient() as unknown as IdentityStripe);

/** The coach's verification, asking Stripe about a session still open first. */
export async function getMyVerification(ctx: VerificationContext): Promise<VerificationState> {
  const coachId = await coachIdForUser(ctx.admin, ctx.userId);
  let row = await readVerification(ctx.admin, coachId);
  if (row === undefined) return toState(null, false);
  if (row?.identity_status === "pending" && row.identity_session_id && !row.override_status) {
    try {
      const session = await stripeOf(ctx).identity.verificationSessions.retrieve(
        row.identity_session_id,
      );
      row = (await applySession(ctx.admin, session as any)) ?? row;
    } catch (e) {
      // Stripe unreachable: show what we last knew.
      console.error("[verification] session refresh failed", e);
    }
  }
  return toState(row ?? null);
}

/**
 * Opens a Stripe Identity session for the coach and answers its hosted page.
 * Coach Pro only (scope: "Only coaches on Coach Pro can start verification").
 */
export async function startIdentityVerification(
  ctx: VerificationContext,
  opts: { returnUrl: string },
): Promise<VerificationStart> {
  const coachId = await coachIdForUser(ctx.admin, ctx.userId);
  const { data: tier, error: tierErr } = await ctx.admin.rpc("coach_effective_tier", {
    _coach_id: coachId,
  });
  if (tierErr) dbError(tierErr);
  if (tier !== "coach_pro") {
    throw new ApiError({
      code: "coach_pro_required",
      status: 403,
      message: "Verification is for Coach Pro. Upgrade to Coach Pro to verify and publish.",
    });
  }
  const current = await readVerification(ctx.admin, coachId);
  if (current === undefined) throw notAvailable();
  if (effectiveIdentityStatus(current) === "passed") {
    return { status: "passed", failureReason: null, startURL: null };
  }
  const session = await stripeOf(ctx).identity.verificationSessions.create({
    type: "document",
    options: {
      document: {
        allowed_types: ["driving_license", "passport", "id_card"],
        require_live_capture: true,
        require_matching_selfie: true,
      },
    },
    metadata: { coach_id: coachId, user_id: ctx.userId },
    return_url: opts.returnUrl,
  } as any);
  await writeVerification(ctx.admin, coachId, {
    identity_status: "pending",
    identity_session_id: session.id,
    identity_failure_reason: null,
  });
  return { status: "pending", failureReason: null, startURL: (session as any).url ?? null };
}

/**
 * Which of these coaches passed identity verification (an admin override counts): the
 * "Verified" badge. Never fails a listing: a missing table or a failed read means nobody.
 */
export async function verifiedCoachIds(admin: Admin, coachIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(coachIds.filter(Boolean))];
  const verified = new Set<string>();
  if (!ids.length) return verified;
  try {
    const { data, error } = await admin
      .from("coach_verifications")
      .select("coach_id, identity_status, override_status")
      .in("coach_id", ids);
    if (error) {
      if (!isMissingTable(error)) console.error("[verification] badge lookup failed", error);
      return verified;
    }
    for (const row of (data ?? []) as Pick<
      VerificationRow,
      "coach_id" | "identity_status" | "override_status"
    >[]) {
      if (effectiveIdentityStatus(row) === "passed") verified.add(row.coach_id);
    }
  } catch (e) {
    console.error("[verification] badge lookup failed", e);
  }
  return verified;
}

// ---------- admin ----------

export type AdminVerification = VerificationState & {
  coachId: string;
  vendor: string | null;
  sessionId: string | null;
  stripeStatus: VerificationStatus;
  stripeFailureReason: string | null;
  overrideStatus: "passed" | "failed" | null;
  overrideReason: string | null;
  overrideAt: string | null;
};

export async function adminGetVerification(
  admin: Admin,
  coachId: string,
): Promise<AdminVerification> {
  const row = await readVerification(admin, coachId);
  const available = row !== undefined;
  const r = row ?? null;
  return {
    ...toState(r, available),
    coachId,
    vendor: r?.vendor ?? null,
    sessionId: r?.identity_session_id ?? null,
    stripeStatus: r?.identity_status ?? "not_started",
    stripeFailureReason: r?.identity_failure_reason ?? null,
    overrideStatus: r?.override_status ?? null,
    overrideReason: r?.override_reason ?? null,
    overrideAt: r?.override_at ?? null,
  };
}

/** An admin sets (or clears) the identity result, always with a reason. */
export async function adminOverrideVerification(
  admin: Admin,
  coachId: string,
  input: z.infer<typeof verificationOverrideInput>,
  adminUserId: string,
  now: () => Date = () => new Date(),
): Promise<AdminVerification> {
  const parsed = verificationOverrideInput.parse(input);
  const current = await readVerification(admin, coachId);
  if (current === undefined) throw notAvailable();
  const row = await writeVerification(admin, coachId, {
    override_status: parsed.status,
    override_reason: parsed.reason,
    override_by: adminUserId,
    override_at: now().toISOString(),
  });
  await syncChecklist(admin, coachId, effectiveIdentityStatus(row) === "passed");
  return adminGetVerification(admin, coachId);
}

/** 403 when publishing needs a verified coach and this one isn't (only with the switch on). */
export async function assertVerifiedToPublish(
  admin: Admin,
  coachId: string,
  env = process.env,
): Promise<void> {
  if (!verificationRequiredToPublish(env)) return;
  const row = await readVerification(admin, coachId);
  if (row === undefined) return;
  if (effectiveIdentityStatus(row) !== "passed") {
    throw new ApiError({
      code: "verification_required",
      status: 403,
      message: "Verify your identity to publish. Your plan is saved as a draft until then.",
    });
  }
}
