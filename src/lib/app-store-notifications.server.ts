/**
 * App Store Server Notifications V2 and the app transactions behind them
 * (PRD §6.13 B4, decision #33, milestone S3).
 *
 * `RESCIND_CONSENT` means a parent or guardian withdrew consent, through
 * Apple, for their child's use of Gradus (the Texas App Store Accountability
 * Act; Apple sends it on every storefront that requires it). The
 * notification names no Gradus account: its `appData.signedAppTransactionInfo`
 * carries the `appTransactionId` of that child's download. So the iOS app
 * reports its own signed app transaction for every athlete session
 * (`POST /api/v1/me/app-transaction` → `registerAppTransaction`), and the
 * webhook pauses every athlete bound to the rescinded download:
 * `account_state = 'paused'`, every consent scope revoked with reason
 * `rescind_consent`, and a push to the parent(s) and every linked coach.
 * The rescinded download is also remembered (`app_store_rescinded_transactions`),
 * so an athlete who binds to it later (a first sign-in after the rescind, or
 * a deleted and re-created account on the same Apple Account) is paused then.
 * Un-pausing is an admin action; Apple sends no "consent restored" event, and
 * claims and invite resends refuse a paused athlete.
 *
 * Other notification types (this app sells nothing in-app) are verified,
 * acknowledged and ignored. Everything Apple signs goes through
 * `verifyAppleJws`; nothing unverified is ever read.
 */
import { z } from "zod";
import type { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { ApiError } from "./api/errors";
import { inBackground } from "./background";
import { dbError } from "./db-error";
import { revokeGuardianConsent } from "./guardian-verification.server";
import {
  AppleSignedDataError,
  verifyAppleJws,
  type VerifyAppleJwsOptions,
} from "./apple-signed-data.server";
import { athleteHouseholdUserIds, coachUserId, notifyUsers } from "./push-notify.server";

type Admin = typeof supabaseAdmin;

export const DEFAULT_APP_BUNDLE_ID = "training.gradus.app";
export const RESCIND_CONSENT_REASON = "rescind_consent";

/** The app's bundle id; `APNS_BUNDLE_ID` already overrides it for pushes. */
export function appBundleId(env: NodeJS.ProcessEnv = process.env): string {
  return (env.APNS_BUNDLE_ID ?? "").trim() || DEFAULT_APP_BUNDLE_ID;
}

/** Apple's two environments. Xcode's local StoreKit signing is never trusted. */
export type AppStoreEnvironment = "Production" | "Sandbox";
const environmentSchema = z.enum(["Production", "Sandbox"]);

export interface AppStoreDeps {
  env?: NodeJS.ProcessEnv;
  now?: Date;
  /** Test roots; production always uses the pinned Apple Root CA - G3. */
  roots?: VerifyAppleJwsOptions["roots"];
  /** Sends the pushes; replaced in tests. */
  notify?: typeof notifyUsers;
}

const notificationSchema = z.object({
  notificationType: z.string().min(1),
  subtype: z.string().optional(),
  notificationUUID: z.string().min(1).max(128),
  version: z.string().optional(),
  signedDate: z.number().optional(),
  data: z
    .object({ bundleId: z.string().optional(), environment: z.string().optional() })
    .optional(),
  appData: z
    .object({
      appAppleId: z.number().optional(),
      bundleId: z.string(),
      environment: z.string(),
      signedAppTransactionInfo: z.string().optional(),
    })
    .optional(),
});

const appTransactionSchema = z.object({
  appTransactionId: z.string().min(1).max(128),
  bundleId: z.string(),
  receiptType: z.string(),
  receiptCreationDate: z.number().optional(),
});

type VerifiedAppTransaction = {
  appTransactionId: string;
  environment: AppStoreEnvironment;
};

/**
 * Verify an app transaction JWS for this app. Returns null for anything that
 * is genuine but not ours to bind (another bundle, Xcode's local signing);
 * throws `AppleSignedDataError` for anything not genuine.
 */
async function verifyAppTransaction(
  jws: string,
  deps: AppStoreDeps,
): Promise<VerifiedAppTransaction | null> {
  const { payload } = await verifyAppleJws(jws, {
    roots: deps.roots,
    now: deps.now,
    dateField: "receiptCreationDate",
  });
  const parsed = appTransactionSchema.safeParse(payload);
  if (!parsed.success) throw new AppleSignedDataError("malformed");
  if (parsed.data.bundleId !== appBundleId(deps.env)) return null;
  const environment = environmentSchema.safeParse(parsed.data.receiptType);
  if (!environment.success) return null;
  return { appTransactionId: parsed.data.appTransactionId, environment: environment.data };
}

/* ------------------------------------------------- binding (iOS → server) */

export const registerAppTransactionInput = z.object({
  /** `AppTransaction.shared`'s `jwsRepresentation`, untouched. */
  signedAppTransaction: z.string().min(1).max(16_384),
});

export interface RegisterAppTransactionResult {
  ok: true;
  /** False for a caller with no athlete row, or a transaction for another app or Xcode. */
  bound: boolean;
}

/**
 * Bind the signed-in athlete to the App Store download on this device, so a
 * later `RESCIND_CONSENT` for that download can find them. Coaches and
 * parents are never bound: consent is only ever rescinded for a child.
 * Idempotent; a repeat refreshes `last_seen_at`.
 */
export async function registerAppTransaction(
  admin: Admin,
  userId: string,
  input: z.infer<typeof registerAppTransactionInput>,
  deps: AppStoreDeps = {},
): Promise<RegisterAppTransactionResult> {
  const athlete = await admin.from("athletes").select("id").eq("user_id", userId).maybeSingle();
  if (athlete.error) dbError(athlete.error);
  const athleteId = (athlete.data as { id: string } | null)?.id;
  if (!athleteId) return { ok: true, bound: false };

  let verified: VerifiedAppTransaction | null;
  try {
    verified = await verifyAppTransaction(input.signedAppTransaction, deps);
  } catch (err) {
    if (err instanceof AppleSignedDataError) {
      console.error("[app-store] app transaction refused", err.reason);
      throw new ApiError({
        code: "invalid_app_transaction",
        status: 422,
        message: "That app transaction could not be verified.",
      });
    }
    throw err;
  }
  if (!verified) return { ok: true, bound: false };

  const now = (deps.now ?? new Date()).toISOString();
  const res = await admin.from("app_store_app_transactions").upsert(
    {
      app_transaction_id: verified.appTransactionId,
      environment: verified.environment,
      athlete_id: athleteId,
      last_seen_at: now,
    },
    { onConflict: "app_transaction_id,environment,athlete_id" },
  );
  if (res.error) dbError(res.error);

  // A download already rescinded before this athlete was bound to it.
  const rescinded = await admin
    .from("app_store_rescinded_transactions")
    .select("app_transaction_id")
    .eq("app_transaction_id", verified.appTransactionId)
    .eq("environment", verified.environment)
    .maybeSingle();
  if (rescinded.error) dbError(rescinded.error);
  // Only a newly paused athlete is announced: the app re-reports weekly.
  if (rescinded.data) await pauseForRescind(admin, [athleteId], deps, { notify: "newlyPaused" });
  return { ok: true, bound: true };
}

/* ------------------------------------------------------- the webhook */

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export interface RescindResult {
  paused: number;
  revoked: number;
}

/**
 * Remember the rescinded download, then pause every athlete bound to it and
 * revoke their consent. Idempotent: a paused row stays paused and only active
 * consent rows are revoked, so a retry after a partial failure finishes the
 * job. The pushes go out in the background and never fail the webhook.
 */
export async function applyRescindConsent(
  admin: Admin,
  transaction: VerifiedAppTransaction,
  deps: AppStoreDeps & { notificationUUID?: string } = {},
): Promise<RescindResult> {
  const now = deps.now ?? new Date();
  const remembered = await admin.from("app_store_rescinded_transactions").upsert(
    {
      app_transaction_id: transaction.appTransactionId,
      environment: transaction.environment,
      rescinded_at: now.toISOString(),
      notification_uuid: deps.notificationUUID ?? null,
    },
    { onConflict: "app_transaction_id,environment" },
  );
  if (remembered.error) dbError(remembered.error);

  const bound = await admin
    .from("app_store_app_transactions")
    .select("athlete_id")
    .eq("app_transaction_id", transaction.appTransactionId)
    .eq("environment", transaction.environment);
  if (bound.error) dbError(bound.error);
  const athleteIds = Array.from(
    new Set(((bound.data ?? []) as { athlete_id: string }[]).map((r) => r.athlete_id)),
  );
  if (athleteIds.length === 0) {
    // Not lost: registerAppTransaction pauses whoever binds to it later.
    console.error("[app-store] RESCIND_CONSENT for a download no athlete is bound to yet");
    return { paused: 0, revoked: 0 };
  }
  return pauseForRescind(admin, athleteIds, deps, { notify: "all" });
}

/**
 * Pause these athletes and revoke their consent, then tell each one's family
 * and coaches. The webhook tells everyone in the set (`all`), not only rows
 * this call flipped: a retry after a half-finished attempt must still reach
 * the families the first attempt never got to, and the push collapse id keeps
 * a repeat to one notification on the device. The binding path tells only
 * athletes it newly paused (`newlyPaused`), since the app re-reports weekly.
 */
async function pauseForRescind(
  admin: Admin,
  athleteIds: string[],
  deps: AppStoreDeps,
  opts: { notify: "all" | "newlyPaused" },
): Promise<RescindResult> {
  const now = deps.now ?? new Date();
  const rows = await admin
    .from("athletes")
    .select("id, first_name, account_state")
    .in("id", athleteIds);
  if (rows.error) dbError(rows.error);
  const athletes = (rows.data ?? []) as {
    id: string;
    first_name: string | null;
    account_state: string | null;
  }[];

  let paused = 0;
  let revoked = 0;
  const newlyPaused = new Set<string>();
  for (const a of athletes) {
    if (a.account_state !== "paused") {
      const upd = await admin.from("athletes").update({ account_state: "paused" }).eq("id", a.id);
      if (upd.error) dbError(upd.error);
      paused++;
      newlyPaused.add(a.id);
    }
    revoked += await revokeGuardianConsent(admin, {
      athleteId: a.id,
      reason: RESCIND_CONSENT_REASON,
      now,
    });
  }

  const notices = athletes
    .filter((a) => opts.notify === "all" || newlyPaused.has(a.id))
    .map((a) => ({ athleteId: a.id, firstName: (a.first_name ?? "").trim() || "Your athlete" }));
  if (notices.length > 0) {
    const notify = deps.notify ?? notifyUsers;
    await inBackground("rescind_consent push", () => notifyRescinded(admin, notices, notify));
  }
  return { paused, revoked };
}

async function notifyRescinded(
  admin: Admin,
  notices: { athleteId: string; firstName: string }[],
  notify: typeof notifyUsers,
): Promise<void> {
  for (const { athleteId, firstName } of notices) {
    const family = await athleteHouseholdUserIds(admin, athleteId, { includeAthlete: false });
    await notify(admin, family, {
      type: "consent_rescinded",
      route: "settings/athletes",
      title: `${firstName}'s Gradus account is paused`,
      body: "Consent for their use of Gradus was withdrawn through Apple. Messages and coach connections are on hold.",
      collapseId: `consent_rescinded:${athleteId}`,
    });

    const links = await admin.from("coach_athletes").select("coach_id").eq("athlete_id", athleteId);
    const coachIds = ((links.data ?? []) as { coach_id: string }[]).map((r) => r.coach_id);
    const coaches = (await Promise.all(coachIds.map((id) => coachUserId(admin, id)))).filter(
      (id): id is string => !!id,
    );
    await notify(admin, coaches, {
      type: "consent_rescinded",
      route: "coach/roster",
      title: `${firstName}'s account is paused`,
      body: "Their family withdrew consent through Apple. Messaging with them is on hold.",
      collapseId: `consent_rescinded:${athleteId}`,
    });
  }
}

/**
 * `POST /api/public/webhooks/app-store`. Apple retries anything but a 200,
 * so: 200 for every genuine notification (handled, duplicate, or ignored);
 * 401 for a signature that does not chain to Apple; 400 for a body that is
 * not a notification; 500 when applying a rescind fails half way, with no
 * receipt written, so Apple's retry applies it again.
 */
export async function handleAppStoreNotification(
  admin: Admin,
  request: Request,
  deps: AppStoreDeps = {},
): Promise<Response> {
  let signedPayload: unknown;
  try {
    signedPayload = ((await request.json()) as { signedPayload?: unknown } | null)?.signedPayload;
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  if (typeof signedPayload !== "string" || signedPayload.length === 0) {
    return json({ error: "invalid_body" }, 400);
  }

  let notification: z.infer<typeof notificationSchema>;
  try {
    const { payload } = await verifyAppleJws(signedPayload, { roots: deps.roots, now: deps.now });
    const parsed = notificationSchema.safeParse(payload);
    if (!parsed.success) return json({ error: "invalid_body" }, 400);
    notification = parsed.data;
  } catch (err) {
    if (err instanceof AppleSignedDataError) {
      console.error("[app-store] notification refused", err.reason);
      return json({ error: "invalid_signature" }, 401);
    }
    throw err;
  }

  const bundleId = notification.appData?.bundleId ?? notification.data?.bundleId;
  if (bundleId !== appBundleId(deps.env)) {
    console.error("[app-store] notification for another bundle", notification.notificationType);
    return json({ ok: true, ignored: true }, 200);
  }
  if (notification.notificationType !== "RESCIND_CONSENT") {
    return json({ ok: true, ignored: true }, 200);
  }

  const appData = notification.appData;
  if (!appData?.signedAppTransactionInfo) {
    console.error("[app-store] RESCIND_CONSENT without an app transaction");
    return json({ ok: true, ignored: true }, 200);
  }
  let transaction: VerifiedAppTransaction | null;
  try {
    transaction = await verifyAppTransaction(appData.signedAppTransactionInfo, deps);
  } catch (err) {
    if (err instanceof AppleSignedDataError) {
      console.error("[app-store] RESCIND_CONSENT app transaction refused", err.reason);
      return json({ error: "invalid_signature" }, 401);
    }
    throw err;
  }
  if (!transaction || transaction.environment !== appData.environment) {
    console.error("[app-store] RESCIND_CONSENT app transaction does not match the notification");
    return json({ ok: true, ignored: true }, 200);
  }

  // Duplicate check first, receipt last: the receipt means "applied", so a
  // failure (or a Worker cancelled mid-way) leaves nothing that would turn
  // Apple's retry into a no-op. Applying twice is harmless (idempotent).
  const seen = await admin
    .from("webhook_receipts")
    .select("id")
    .eq("source", "app_store")
    .eq("external_id", notification.notificationUUID)
    .maybeSingle();
  if (seen.error) dbError(seen.error);
  if (seen.data) return json({ ok: true, duplicate: true }, 200);

  const now = deps.now ?? new Date();
  const result = await applyRescindConsent(admin, transaction, {
    ...deps,
    now,
    notificationUUID: notification.notificationUUID,
  });

  const receipt = await admin.from("webhook_receipts").insert({
    source: "app_store",
    external_id: notification.notificationUUID,
    event: notification.notificationType,
    received_at: now.toISOString(),
    payload: {
      notificationType: notification.notificationType,
      subtype: notification.subtype ?? null,
      environment: transaction.environment,
      appTransactionId: transaction.appTransactionId,
      signedDate: notification.signedDate ?? null,
    } as Json,
  });
  // 23505: a concurrent delivery of the same notification finished first; both applied the same thing.
  if (receipt.error && (receipt.error as { code?: string }).code !== "23505")
    dbError(receipt.error);
  return json({ ok: true, ...result }, 200);
}
