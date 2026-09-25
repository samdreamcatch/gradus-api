/**
 * Parent adult verification, the consent ledger, athlete account states and
 * the provisional-account sweep — PRD §6.13 A, decisions #29–#33, milestone
 * S1. Single source of truth for the web server functions
 * (guardian-verification.functions.ts), the `/api/v1/guardian/verification/*`
 * routes, the `/api/public/webhooks/kws` receiver, the `/verified` page and
 * the daily `/api/public/hooks/consent-retention` sweep.
 *
 * Rollout switch: `PARENT_VERIFICATION_REQUIRED=true` turns the gates on
 * (`assertParentVerified`). Until KWS is configured in Lovable Cloud it stays
 * off, so a new parent is never asked for something that cannot succeed;
 * the DTO still reports the truth (`verified: false`, `required: false`).
 * Parents that existed before the S1 migration carry method `legacy` and
 * are never gated (§12 #27).
 */
import { z } from "zod";
import type { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { ApiError } from "./api/errors";
import { dbError } from "./db-error";
import {
  decodeExternalPayload,
  encodeExternalPayload,
  kwsConfig,
  kwsRedirectStatusSchema,
  kwsSendVerificationEmail,
  kwsVerificationSecrets,
  kwsWebhookEventSchema,
  kwsWebhookSecrets,
  verifyKwsRedirectSignature,
  verifyKwsWebhookSignature,
  type KwsClientOptions,
} from "./kws.server";

type Admin = typeof supabaseAdmin;

export type AdultVerificationMethod = "kws_card" | "admin" | "legacy";
export type AthleteAccountState = "active" | "provisional" | "paused";

export interface ParentVerificationDTO {
  /** The gates are on (`PARENT_VERIFICATION_REQUIRED`). */
  required: boolean;
  /** KWS is configured, so `start` can send the email. */
  available: boolean;
  verified: boolean;
  method: AdultVerificationMethod | null;
  verifiedAt: string | null;
  requestedAt: string | null;
}

export function verificationRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PARENT_VERIFICATION_REQUIRED === "true";
}

export function verificationAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  return kwsConfig(env) !== null;
}

export const PARENT_VERIFICATION_COLUMNS =
  "id, user_id, adult_verified_at, adult_verification_method, adult_verification_requested_at";

export interface ParentVerificationRow {
  id: string;
  user_id: string;
  adult_verified_at: string | null;
  adult_verification_method: string | null;
  adult_verification_requested_at: string | null;
}

export function toParentVerificationDTO(
  row: Pick<
    ParentVerificationRow,
    "adult_verified_at" | "adult_verification_method" | "adult_verification_requested_at"
  >,
  env: NodeJS.ProcessEnv = process.env,
): ParentVerificationDTO {
  const method = (row.adult_verification_method as AdultVerificationMethod | null) ?? null;
  return {
    required: verificationRequired(env),
    available: verificationAvailable(env),
    verified: method !== null && row.adult_verified_at !== null,
    method,
    verifiedAt: row.adult_verified_at ?? null,
    requestedAt: row.adult_verification_requested_at ?? null,
  };
}

/** Gating is `required && !verified`; everything else is display. */
export function parentVerificationSatisfied(dto: ParentVerificationDTO): boolean {
  return !dto.required || dto.verified;
}

async function loadParentByUser(
  admin: Admin,
  userId: string,
): Promise<ParentVerificationRow | null> {
  const res = await admin
    .from("parent_profiles")
    .select(PARENT_VERIFICATION_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle();
  if (res.error) dbError(res.error);
  return (res.data as ParentVerificationRow | null) ?? null;
}

async function loadParentById(
  admin: Admin,
  parentId: string,
): Promise<ParentVerificationRow | null> {
  const res = await admin
    .from("parent_profiles")
    .select(PARENT_VERIFICATION_COLUMNS)
    .eq("id", parentId)
    .maybeSingle();
  if (res.error) dbError(res.error);
  return (res.data as ParentVerificationRow | null) ?? null;
}

/** The signed-in user's parent verification, or null when they have no parent profile. */
export async function getParentVerificationForUser(
  admin: Admin,
  userId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ParentVerificationDTO | null> {
  const row = await loadParentByUser(admin, userId);
  return row ? toParentVerificationDTO(row, env) : null;
}

export async function getParentVerificationById(
  admin: Admin,
  parentId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ParentVerificationDTO | null> {
  const row = await loadParentById(admin, parentId);
  return row ? toParentVerificationDTO(row, env) : null;
}

export const PARENT_UNVERIFIED_MESSAGE =
  "Verify that you're an adult before connecting a coach or opening a conversation for an athlete under 18.";

/**
 * The gate every minor-facing action passes through once the switch is on:
 * linking a coach, issuing an athlete's login code, opening a room (§6.13
 * A4–A6). 403 `parent_unverified`. A missing parent profile is the caller's
 * own problem and surfaces as `wrong_role` elsewhere; here it is treated as
 * unverified.
 */
export async function assertParentVerified(
  admin: Admin,
  parentId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (!verificationRequired(env)) return;
  const dto = await getParentVerificationById(admin, parentId, env);
  if (dto && dto.verified) return;
  throw new ApiError({
    code: "parent_unverified",
    status: 403,
    message: PARENT_UNVERIFIED_MESSAGE,
  });
}

/* ------------------------------------------------------------------ start */

export type StartParentVerificationStatus =
  | "email_sent"
  | "already_verified"
  | "not_configured"
  | "rate_limited";

export interface StartParentVerificationResult {
  status: StartParentVerificationStatus;
}

/** A second tap inside this window re-uses the email already on its way. */
export const START_RESEND_COOLDOWN_MS = 60_000;

/** Every athlete is on the US storefront (decision #25); KWS wants the child's location. */
export const DEFAULT_KWS_LOCATION = "US";
export const DEFAULT_KWS_LANGUAGE = "en";

/**
 * Ask KWS to email the signed-in parent. The address is the parent's own
 * account email, never one a child typed. `already_verified` short-circuits;
 * `not_configured` means KWS credentials are absent in this environment.
 */
export async function startParentVerification(
  admin: Admin,
  userId: string,
  opts: {
    env?: NodeJS.ProcessEnv;
    now?: Date;
    client?: KwsClientOptions;
    location?: string;
    language?: string;
  } = {},
): Promise<StartParentVerificationResult> {
  const env = opts.env ?? process.env;
  const now = opts.now ?? new Date();

  const parent = await loadParentByUser(admin, userId);
  if (!parent) {
    throw new ApiError({
      code: "wrong_role",
      status: 403,
      message: "Only a parent account can be verified.",
    });
  }
  if (parent.adult_verified_at && parent.adult_verification_method) {
    return { status: "already_verified" };
  }

  const cfg = kwsConfig(env);
  if (!cfg) return { status: "not_configured" };

  if (
    parent.adult_verification_requested_at &&
    now.getTime() - new Date(parent.adult_verification_requested_at).getTime() <
      START_RESEND_COOLDOWN_MS
  ) {
    return { status: "email_sent" };
  }

  const user = await admin.auth.admin.getUserById(userId);
  const email = user.data?.user?.email?.trim().toLowerCase() ?? "";
  if (user.error || !email) {
    throw new ApiError({
      code: "unprocessable",
      status: 422,
      message: "Your account has no email address to verify with.",
    });
  }

  let result: Awaited<ReturnType<typeof kwsSendVerificationEmail>>;
  try {
    result = await kwsSendVerificationEmail(
      cfg,
      {
        email,
        location: opts.location ?? DEFAULT_KWS_LOCATION,
        language: opts.language ?? DEFAULT_KWS_LANGUAGE,
        externalPayload: encodeExternalPayload({ parentId: parent.id, userId }),
      },
      opts.client,
    );
  } catch (err) {
    // A token failure or an exhausted retry is KWS being unavailable, not a
    // bug of ours: 503 with the same message, never a generic 500.
    console.error("[verification] KWS request failed", err);
    throw new ApiError({
      code: "verification_unavailable",
      status: 503,
      message: "We couldn't start the verification right now. Please try again in a few minutes.",
    });
  }
  if (!result.ok) {
    if (result.status === 429) return { status: "rate_limited" };
    console.error("[verification] KWS send-email failed", result.status, result.body);
    throw new ApiError({
      code: "verification_unavailable",
      status: 503,
      message: "We couldn't start the verification right now. Please try again in a few minutes.",
    });
  }

  const upd = await admin
    .from("parent_profiles")
    .update({ adult_verification_requested_at: now.toISOString() })
    .eq("id", parent.id);
  if (upd.error) dbError(upd.error);

  return { status: "email_sent" };
}

/* ----------------------------------------------------------------- record */

export type VerificationSource = "kws" | "kws_redirect";

export interface RecordParentVerificationArgs {
  source: VerificationSource;
  event: string;
  transactionId: string;
  verified: boolean;
  parentId: string;
  userId: string;
  payload: unknown;
  now?: Date;
}

export interface RecordParentVerificationResult {
  /** The parent row was marked verified by this call. */
  applied: boolean;
  /** This (source, transaction id) had already been received. */
  duplicate: boolean;
}

/**
 * Store the receipt (idempotent on source + transaction id) and, for a
 * successful event whose payload still matches the parent profile, mark the
 * parent verified. Both channels for one verification carry the same
 * transaction id under different sources; marking twice is harmless.
 */
export async function recordParentVerification(
  admin: Admin,
  args: RecordParentVerificationArgs,
): Promise<RecordParentVerificationResult> {
  const now = args.now ?? new Date();
  const receipt = await admin.from("webhook_receipts").insert({
    source: args.source,
    external_id: args.transactionId,
    event: args.event,
    received_at: now.toISOString(),
    payload: (args.payload ?? {}) as Json,
  });
  if (receipt.error) {
    if ((receipt.error as { code?: string }).code === "23505") {
      return { applied: false, duplicate: true };
    }
    dbError(receipt.error);
  }

  if (!args.verified) return { applied: false, duplicate: false };

  const parent = await loadParentById(admin, args.parentId);
  if (!parent) {
    console.error("[verification] event for unknown parent", args.source, args.transactionId);
    return { applied: false, duplicate: false };
  }
  if (parent.user_id !== args.userId) {
    console.error("[verification] event user mismatch", args.source, args.transactionId);
    return { applied: false, duplicate: false };
  }

  const upd = await admin
    .from("parent_profiles")
    .update({
      adult_verified_at: now.toISOString(),
      adult_verification_method: "kws_card",
      adult_verification_ref: args.transactionId,
    })
    .eq("id", parent.id);
  if (upd.error) dbError(upd.error);
  return { applied: true, duplicate: false };
}

/** Demo and review accounts (decision #26), and admin repair: never from a client. */
export async function markParentVerifiedByAdmin(
  admin: Admin,
  parentId: string,
  ref: string,
  now: Date = new Date(),
): Promise<void> {
  const upd = await admin
    .from("parent_profiles")
    .update({
      adult_verified_at: now.toISOString(),
      adult_verification_method: "admin",
      adult_verification_ref: ref,
    })
    .eq("id", parentId);
  if (upd.error) dbError(upd.error);
}

/* ---------------------------------------------------------------- webhook */

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

/**
 * `POST /api/public/webhooks/kws`. Reads the raw body (never re-serialized),
 * checks `x-kws-signature`, and records the event. 2xx for anything genuine,
 * including duplicates and events we ignore, so KWS stops retrying; 401 for
 * a bad signature; 400 for a body we cannot read; 503 when no secret is set.
 */
export async function handleKwsWebhook(
  admin: Admin,
  request: Request,
  opts: { env?: NodeJS.ProcessEnv; now?: Date } = {},
): Promise<Response> {
  const env = opts.env ?? process.env;
  const now = opts.now ?? new Date();
  const secrets = kwsWebhookSecrets(env);
  if (secrets.length === 0) return json({ error: "not_configured" }, 503);

  const rawBody = await request.text();
  const genuine = await verifyKwsWebhookSignature(
    request.headers.get("x-kws-signature"),
    rawBody,
    secrets,
    now.getTime(),
  );
  if (!genuine) return json({ error: "invalid_signature" }, 401);

  let parsed: z.infer<typeof kwsWebhookEventSchema>;
  try {
    parsed = kwsWebhookEventSchema.parse(JSON.parse(rawBody));
  } catch {
    return json({ error: "invalid_body" }, 400);
  }

  if (parsed.name !== "parent-verified") return json({ ok: true, ignored: true }, 200);

  const ext = decodeExternalPayload(parsed.payload.externalPayload);
  if (!ext) {
    console.error("[verification] webhook without a usable externalPayload");
    return json({ ok: true, ignored: true }, 200);
  }

  const result = await recordParentVerification(admin, {
    source: "kws",
    event: parsed.name,
    transactionId: parsed.payload.status.transactionId,
    verified: parsed.payload.status.verified,
    parentId: ext.parentId,
    userId: ext.userId,
    // The parent's email is not ours to keep; the ids and status are enough.
    payload: {
      orgId: parsed.orgId ?? null,
      productId: parsed.productId ?? null,
      time: parsed.time ?? null,
      status: parsed.payload.status,
    },
    now,
  });
  return json({ ok: true, ...result }, 200);
}

/* --------------------------------------------------------------- redirect */

export const completeVerificationInput = z.object({
  /** The `status` query value, exactly as received (it is signed as-is). */
  status: z.string().min(1).max(2000),
  externalPayload: z.string().min(1).max(2000),
  /** Every `signature` query value; more than one during a KWS secret rotation. */
  signatures: z.array(z.string().min(1).max(256)).min(1).max(4),
});

export interface CompleteVerificationResult {
  ok: boolean;
  verified: boolean;
  duplicate: boolean;
  /** `not_configured`, `bad_signature` or `bad_payload` when `ok` is false. */
  reason: string | null;
}

/**
 * The Verification Response: KWS sends the parent to `/verified` with a
 * signed query. The web page and the iOS app both forward it here. The
 * signature is the trust anchor, so no session is needed; the transaction
 * id keeps a replay from doing anything twice.
 */
export async function completeVerificationFromRedirect(
  admin: Admin,
  input: z.infer<typeof completeVerificationInput>,
  opts: { env?: NodeJS.ProcessEnv; now?: Date } = {},
): Promise<CompleteVerificationResult> {
  const env = opts.env ?? process.env;
  const secrets = kwsVerificationSecrets(env);
  if (secrets.length === 0) {
    return { ok: false, verified: false, duplicate: false, reason: "not_configured" };
  }
  const genuine = await verifyKwsRedirectSignature(
    input.status,
    input.externalPayload,
    input.signatures,
    secrets,
  );
  if (!genuine) return { ok: false, verified: false, duplicate: false, reason: "bad_signature" };

  let status: z.infer<typeof kwsRedirectStatusSchema>;
  try {
    status = kwsRedirectStatusSchema.parse(JSON.parse(input.status));
  } catch {
    return { ok: false, verified: false, duplicate: false, reason: "bad_payload" };
  }
  const ext = decodeExternalPayload(input.externalPayload);
  if (!ext) return { ok: false, verified: false, duplicate: false, reason: "bad_payload" };

  const result = await recordParentVerification(admin, {
    source: "kws_redirect",
    event: "parent-verified",
    transactionId: status.transactionId,
    verified: status.verified,
    parentId: ext.parentId,
    userId: ext.userId,
    payload: { status },
    now: opts.now,
  });
  return { ok: true, verified: status.verified, duplicate: result.duplicate, reason: null };
}

/* ----------------------------------------------------------------- ledger */

export type ConsentScope = "account" | "messaging";
export type ConsentMethod = "parent_created" | "guardian_claim" | "admin";
export const ALL_CONSENT_SCOPES: ConsentScope[] = ["account", "messaging"];

/** Grant scopes that are not already active for this athlete and parent. */
export async function grantGuardianConsent(
  admin: Admin,
  args: {
    athleteId: string;
    parentId: string;
    method: ConsentMethod;
    scopes?: ConsentScope[];
    evidence?: Record<string, unknown>;
    now?: Date;
  },
): Promise<{ granted: ConsentScope[] }> {
  const scopes = args.scopes ?? ALL_CONSENT_SCOPES;
  const active = await admin
    .from("guardian_consents")
    .select("scope")
    .eq("athlete_id", args.athleteId)
    .eq("parent_id", args.parentId)
    .is("revoked_at", null);
  if (active.error) dbError(active.error);
  const have = new Set((active.data ?? []).map((r) => r.scope as ConsentScope));
  const missing = scopes.filter((s) => !have.has(s));
  if (missing.length === 0) return { granted: [] };
  const ins = await admin.from("guardian_consents").insert(
    missing.map((scope) => ({
      athlete_id: args.athleteId,
      parent_id: args.parentId,
      scope,
      method: args.method,
      evidence: (args.evidence ?? {}) as Json,
      granted_at: (args.now ?? new Date()).toISOString(),
    })),
  );
  if (ins.error) dbError(ins.error);
  return { granted: missing };
}

/** Revoke every active scope for the athlete (optionally one parent's only). Returns how many rows changed. */
export async function revokeGuardianConsent(
  admin: Admin,
  args: { athleteId: string; parentId?: string; reason: string; now?: Date },
): Promise<number> {
  let query = admin
    .from("guardian_consents")
    .update({ revoked_at: (args.now ?? new Date()).toISOString(), revoked_reason: args.reason })
    .eq("athlete_id", args.athleteId)
    .is("revoked_at", null);
  if (args.parentId) query = query.eq("parent_id", args.parentId);
  const res = await query.select("id");
  if (res.error) dbError(res.error);
  return (res.data ?? []).length;
}

/* ------------------------------------------------------------------ state */

/** The signed-in athlete's account state, or null when they have no athlete row. */
export async function getAthleteAccountStateForUser(
  admin: Admin,
  userId: string,
): Promise<AthleteAccountState | null> {
  const res = await admin
    .from("athletes")
    .select("account_state")
    .eq("user_id", userId)
    .maybeSingle();
  if (res.error) dbError(res.error);
  return (res.data?.account_state as AthleteAccountState | undefined) ?? null;
}

/* ------------------------------------------------------------------ sweep */

export interface SweepDeps {
  purgeAthlete: (athleteId: string) => Promise<void>;
  deleteAuthUser: (userId: string) => Promise<void>;
}

/**
 * §12 #25: three calendar months before `now`. When the target month is
 * shorter (May 31 → "February 31"), clamp to that month's last day rather
 * than let the date roll forward into March, which would delete a few days
 * early; the window may only ever err on the long side.
 */
export function provisionalCutoff(now: Date, months = 3): Date {
  const cutoff = new Date(now.getTime());
  const day = cutoff.getUTCDate();
  cutoff.setUTCDate(1);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  const lastDay = new Date(
    Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth() + 1, 0),
  ).getUTCDate();
  cutoff.setUTCDate(Math.min(day, lastDay));
  return cutoff;
}

export interface SweepResult {
  scanned: number;
  deleted: number;
  failed: number;
}

/**
 * Delete provisional accounts nobody claimed within the window: the athlete
 * row and everything hanging off it, then the auth user. Rows a parent has
 * since claimed are `active` and never touched. Bounded per run; the daily
 * cron catches up.
 */
export async function sweepProvisionalAthletes(
  admin: Admin,
  opts: { now?: Date; deps?: SweepDeps; limit?: number } = {},
): Promise<SweepResult> {
  const now = opts.now ?? new Date();
  const cutoff = provisionalCutoff(now);
  const deps = opts.deps ?? (await defaultSweepDeps());

  const res = await admin
    .from("athletes")
    .select("id, user_id, created_at")
    .eq("account_state", "provisional")
    .is("parent_id", null)
    .lt("created_at", cutoff.toISOString())
    .order("created_at", { ascending: true })
    .limit(opts.limit ?? 200);
  if (res.error) dbError(res.error);

  const rows = (res.data ?? []) as { id: string; user_id: string | null; created_at: string }[];
  let deleted = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await deps.purgeAthlete(row.id);
      if (row.user_id) await deps.deleteAuthUser(row.user_id);
      deleted += 1;
    } catch (err) {
      failed += 1;
      console.error("[verification] provisional sweep failed for athlete", row.id, err);
    }
  }
  return { scanned: rows.length, deleted, failed };
}

async function defaultSweepDeps(): Promise<SweepDeps> {
  const [{ purgeAthlete }, { supabaseAdmin }] = await Promise.all([
    import("./account-deletion.server"),
    import("@/integrations/supabase/client.server"),
  ]);
  return {
    purgeAthlete,
    deleteAuthUser: async (userId) => {
      // Same tombstone `deleteAccountForUser` leaves, so the deletion is on
      // record without the account's email (never collected for the sweep).
      const tomb = await supabaseAdmin
        .from("deleted_accounts")
        .insert({ user_id: userId, role: "athlete", initiated_by: "retention" });
      if (tomb.error) console.error("[verification] sweep tombstone failed", tomb.error);
      const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
      if (error) throw new Error(error.message);
    },
  };
}
