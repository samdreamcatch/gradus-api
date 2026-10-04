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
import { isMinorOrUnconfirmed } from "./athlete-age";
import {
  grantGuardianConsent,
  revokeGuardianConsent,
  verificationRequired,
} from "./guardian-verification.server";
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
    .select("app_transaction_id, rescinded_at")
    .eq("app_transaction_id", verified.appTransactionId)
    .eq("environment", verified.environment)
    .maybeSingle();
  if (rescinded.error) dbError(rescinded.error);
  const rescindedAt = (rescinded.data as { rescinded_at?: string | null } | null)?.rescinded_at;
  if (rescinded.data) {
    // An admin restore (§12 #29) exempts this athlete from a withdrawal
    // recorded before the restore; a newer withdrawal applies again.
    const exempt = await restoreExemptionAt(
      admin,
      athleteId,
      verified.environment,
      verified.appTransactionId,
    );
    const stillWithdrawn = !exempt || ms(rescindedAt) > ms(exempt);
    // Only a newly paused athlete is announced: the app re-reports weekly.
    if (stillWithdrawn) await pauseForRescind(admin, [athleteId], deps, { notify: "newlyPaused" });
  }
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
      // Remembered so an admin restore (§12 #29) puts the account back where
      // it was, not where a guess would put it.
      const remembered = await admin.from("webhook_receipts").upsert(
        {
          source: PAUSE_RECORD_SOURCE,
          external_id: a.id,
          event: "paused",
          received_at: now.toISOString(),
          payload: { priorState: a.account_state ?? "active" } as Json,
        },
        { onConflict: "source,external_id" },
      );
      if (remembered.error) dbError(remembered.error);
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

/* ------------------------------------------------- restore (admin, §12 #29) */

/**
 * Apple sends no "consent restored" event, so a paused athlete comes back
 * only through Admin → Paused athletes, on the family's request to support
 * (PRD §12 #29). Only `RESCIND_CONSENT` ever pauses an athlete today.
 *
 * Bookkeeping lives in `webhook_receipts` (no migration):
 *  - `app_store_pause` / athlete id: the state the athlete had when paused;
 *  - `admin_restore` / `athleteId:environment:appTransactionId`: this athlete
 *    is exempt from that download's withdrawal as of `received_at`. The
 *    stored withdrawal itself is never deleted, so it still applies to a
 *    sibling on the same download and to anyone who binds to it later, and a
 *    newer `RESCIND_CONSENT` (a later `rescinded_at`) applies again;
 *  - `admin_restore_log` / `athleteId:timestamp`: who restored, why, and to
 *    what, for every restore.
 */
export const PAUSE_RECORD_SOURCE = "app_store_pause";
export const RESTORE_EXEMPTION_SOURCE = "admin_restore";
export const RESTORE_LOG_SOURCE = "admin_restore_log";

/**
 * Self-sign-up minors are created provisional since S1 reached production
 * (code on main 2026-09-25 16:10Z, migration applied 17:48Z, published after);
 * older ones were created active. Erring late on purpose: a wrong
 * "provisional" would hand an old account to the unclaimed-account sweep.
 * Used only when a pause predates the pause record.
 */
const S1_PROVISIONAL_SINCE = "2026-09-26T00:00:00Z";

/** Timestamps from Postgres (`+00:00`) and from JS (`Z`) compared as instants, not strings. */
const ms = (t: string | null | undefined) => (t ? Date.parse(t) : NaN);

const exemptionId = (athleteId: string, environment: string, appTransactionId: string) =>
  `${athleteId}:${environment}:${appTransactionId}`;

/** When an admin restore exempted this athlete from this download's withdrawal, if ever. */
async function restoreExemptionAt(
  admin: Admin,
  athleteId: string,
  environment: string,
  appTransactionId: string,
): Promise<string | null> {
  const res = await admin
    .from("webhook_receipts")
    .select("received_at")
    .eq("source", RESTORE_EXEMPTION_SOURCE)
    .eq("external_id", exemptionId(athleteId, environment, appTransactionId))
    .maybeSingle();
  if (res.error) dbError(res.error);
  return (res.data as { received_at?: string | null } | null)?.received_at ?? null;
}

export interface PausedAthleteDTO {
  athleteId: string;
  userId: string | null;
  firstName: string;
  lastName: string;
  birthdate: string | null;
  /** When the athlete was paused (the pause record, else the withdrawal or the consent revocation). */
  pausedAt: string | null;
  parent: {
    parentId: string;
    userId: string | null;
    firstName: string;
    lastName: string;
    adultVerified: boolean;
  } | null;
  /** What a restore sets the account to (see `restoredState`). */
  restoresTo: "active" | "provisional";
  /** The latest withdrawal on file for the athlete's downloads; later than `pausedAt` means Apple withdrew again. */
  latestWithdrawalAt: string | null;
}

type RestorableRow = {
  parent_id: string | null;
  birthdate: string | null;
  created_at?: string | null;
};

/**
 * The state a restore returns the athlete to: `active` with a parent on
 * file; otherwise the one recorded at the pause when there is one. Without a record, a parent on file or a known adult is
 * `active`, and a minor with no parent is `provisional` only if the account
 * was created under S1's rules; an older one was created active, and making
 * it provisional would hand it to the three-month unclaimed-account sweep.
 */
export function restoredState(
  row: RestorableRow,
  priorState?: string | null,
): "active" | "provisional" {
  // A parent on file means a claimed athlete, and a claimed athlete is active
  // (decision #31), whatever the account was when paused.
  if (row.parent_id) return "active";
  if (priorState === "active" || priorState === "provisional") return priorState;
  if (!isMinorOrUnconfirmed(row.birthdate)) return "active";
  if (row.created_at && ms(row.created_at) < ms(S1_PROVISIONAL_SINCE)) return "active";
  return "provisional";
}

type PausedRow = RestorableRow & {
  id: string;
  user_id: string | null;
  first_name: string | null;
  last_name: string | null;
};

const later = (a: string | null | undefined, b: string | null | undefined) =>
  !a ? (b ?? null) : !b ? a : ms(a) >= ms(b) ? a : b;

export async function listPausedAthletes(admin: Admin): Promise<PausedAthleteDTO[]> {
  const res = await admin
    .from("athletes")
    .select("id, user_id, first_name, last_name, birthdate, parent_id, created_at")
    .eq("account_state", "paused");
  if (res.error) dbError(res.error);
  const rows = (res.data ?? []) as PausedRow[];
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const parentIds = Array.from(
    new Set(rows.map((r) => r.parent_id).filter((x): x is string => !!x)),
  );
  const [pausesRes, revokedRes, boundRes, parentsRes] = await Promise.all([
    admin
      .from("webhook_receipts")
      .select("external_id, received_at, payload")
      .eq("source", PAUSE_RECORD_SOURCE)
      .in("external_id", ids),
    admin
      .from("guardian_consents")
      .select("athlete_id, revoked_at")
      .in("athlete_id", ids)
      .eq("revoked_reason", RESCIND_CONSENT_REASON),
    admin
      .from("app_store_app_transactions")
      .select("athlete_id, app_transaction_id, environment")
      .in("athlete_id", ids),
    parentIds.length
      ? admin
          .from("parent_profiles")
          .select("id, user_id, first_name, last_name, adult_verified_at")
          .in("id", parentIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (pausesRes.error) dbError(pausesRes.error);
  if (revokedRes.error) dbError(revokedRes.error);
  if (boundRes.error) dbError(boundRes.error);
  if (parentsRes.error) dbError(parentsRes.error);

  const bound = (boundRes.data ?? []) as {
    athlete_id: string;
    app_transaction_id: string;
    environment: string;
  }[];
  const txnIds = Array.from(new Set(bound.map((b) => b.app_transaction_id)));
  const rescindedRes = txnIds.length
    ? await admin
        .from("app_store_rescinded_transactions")
        .select("app_transaction_id, environment, rescinded_at")
        .in("app_transaction_id", txnIds)
    : { data: [], error: null };
  if (rescindedRes.error) dbError(rescindedRes.error);
  const rescindedAt = new Map(
    (
      (rescindedRes.data ?? []) as {
        app_transaction_id: string;
        environment: string;
        rescinded_at: string;
      }[]
    ).map((r) => [`${r.environment}:${r.app_transaction_id}`, r.rescinded_at]),
  );

  const pausedAt = new Map<string, string>();
  const priorState = new Map<string, string>();
  for (const p of (pausesRes.data ?? []) as {
    external_id: string;
    received_at: string;
    payload: { priorState?: string } | null;
  }[]) {
    pausedAt.set(p.external_id, p.received_at);
    if (p.payload?.priorState) priorState.set(p.external_id, p.payload.priorState);
  }
  const fallbackAt = new Map<string, string>();
  for (const r of (revokedRes.data ?? []) as { athlete_id: string; revoked_at: string | null }[]) {
    const at = later(fallbackAt.get(r.athlete_id), r.revoked_at);
    if (at) fallbackAt.set(r.athlete_id, at);
  }
  const latestWithdrawal = new Map<string, string>();
  for (const b of bound) {
    const withdrawn = rescindedAt.get(`${b.environment}:${b.app_transaction_id}`);
    const at = later(fallbackAt.get(b.athlete_id), withdrawn);
    if (at) fallbackAt.set(b.athlete_id, at);
    const latest = later(latestWithdrawal.get(b.athlete_id), withdrawn);
    if (latest) latestWithdrawal.set(b.athlete_id, latest);
  }
  const parents = new Map(
    (
      (parentsRes.data ?? []) as {
        id: string;
        user_id: string | null;
        first_name: string | null;
        last_name: string | null;
        adult_verified_at: string | null;
      }[]
    ).map((p) => [p.id, p]),
  );

  return rows
    .map((r) => {
      const p = r.parent_id ? parents.get(r.parent_id) : undefined;
      return {
        athleteId: r.id,
        userId: r.user_id,
        firstName: r.first_name ?? "",
        lastName: r.last_name ?? "",
        birthdate: r.birthdate,
        pausedAt: pausedAt.get(r.id) ?? fallbackAt.get(r.id) ?? null,
        parent: p
          ? {
              parentId: p.id,
              userId: p.user_id,
              firstName: p.first_name ?? "",
              lastName: p.last_name ?? "",
              adultVerified: !!p.adult_verified_at,
            }
          : null,
        restoresTo: restoredState(r, priorState.get(r.id)),
        latestWithdrawalAt: latestWithdrawal.get(r.id) ?? null,
      };
    })
    .sort((a, b) => (ms(b.pausedAt) || 0) - (ms(a.pausedAt) || 0));
}

export interface RestoreResult {
  ok: true;
  state: "active" | "provisional";
  /** Consent scopes granted fresh (method `admin`); empty with no parent on file. */
  granted: string[];
  /** Downloads this athlete is now exempt from (their withdrawal stays for everyone else). */
  exemptedDownloads: number;
}

const conflict = (code: string, message: string) => new ApiError({ code, status: 409, message });

/**
 * Restore one athlete paused by `RESCIND_CONSENT`, in an order that leaves
 * them paused if anything fails part way (a retry finishes the job):
 *  1. refuse unless paused, and, while parent verification is required,
 *     unless the parent on file has verified as an adult;
 *  2. exempt this athlete, and only this athlete, from the withdrawal of each
 *     download they are bound to (see the bookkeeping note above);
 *  3. refuse if Apple withdrew again after the admin looked (or, with no
 *     `seenWithdrawalAt`, after this restore began), before writing consent;
 *  4. with a parent on file, record fresh consent from that parent
 *     (method `admin`; the note and admin id as evidence);
 *  5. set the state from `restoredState`;
 *  6. check once more: a withdrawal that landed after step 3 wins, and the
 *     athlete is paused again;
 *  7. log the outcome.
 */
export async function restorePausedAthlete(
  admin: Admin,
  args: {
    athleteId: string;
    adminUserId: string;
    note: string;
    /** `latestWithdrawalAt` as the admin saw it in the list; a newer one refuses the restore. */
    seenWithdrawalAt?: string | null;
    now?: Date;
    env?: NodeJS.ProcessEnv;
    notify?: AppStoreDeps["notify"];
  },
): Promise<RestoreResult> {
  const now = args.now ?? new Date();
  const nowIso = now.toISOString();
  const res = await admin
    .from("athletes")
    .select("id, parent_id, birthdate, account_state, created_at")
    .eq("id", args.athleteId)
    .maybeSingle();
  if (res.error) dbError(res.error);
  const athlete = res.data as (RestorableRow & { id: string; account_state: string | null }) | null;
  if (!athlete) {
    throw new ApiError({ code: "not_found", status: 404, message: "Athlete not found." });
  }
  if (athlete.account_state !== "paused") {
    throw conflict("not_paused", "This athlete isn't paused.");
  }
  if (athlete.parent_id && verificationRequired(args.env)) {
    const parent = await admin
      .from("parent_profiles")
      .select("adult_verified_at")
      .eq("id", athlete.parent_id)
      .maybeSingle();
    if (parent.error) dbError(parent.error);
    if (!(parent.data as { adult_verified_at?: string | null } | null)?.adult_verified_at) {
      throw conflict(
        "parent_unverified",
        "The parent on file has to verify as an adult before this account can be restored.",
      );
    }
  }

  const pause = await admin
    .from("webhook_receipts")
    .select("payload")
    .eq("source", PAUSE_RECORD_SOURCE)
    .eq("external_id", athlete.id)
    .maybeSingle();
  if (pause.error) dbError(pause.error);
  const priorState = (pause.data as { payload?: { priorState?: string } | null } | null)?.payload
    ?.priorState;
  const state = restoredState(athlete, priorState);

  const bound = await admin
    .from("app_store_app_transactions")
    .select("app_transaction_id, environment")
    .eq("athlete_id", athlete.id);
  if (bound.error) dbError(bound.error);
  const downloads = (bound.data ?? []) as { app_transaction_id: string; environment: string }[];
  for (const d of downloads) {
    const ex = await admin.from("webhook_receipts").upsert(
      {
        source: RESTORE_EXEMPTION_SOURCE,
        external_id: exemptionId(athlete.id, d.environment, d.app_transaction_id),
        event: "restored",
        received_at: nowIso,
        payload: { adminUserId: args.adminUserId, note: args.note } as Json,
      },
      { onConflict: "source,external_id" },
    );
    if (ex.error) dbError(ex.error);
  }

  // Nothing but the (harmless, older) exemptions is written before this check.
  const before = await latestWithdrawalAt(admin, downloads);
  const seen = args.seenWithdrawalAt === undefined ? nowIso : args.seenWithdrawalAt;
  if (before && (!seen || ms(before) > ms(seen))) {
    throw conflict(
      "withdrawn_again",
      "Apple reported a newer consent withdrawal for this athlete. Reload the list and check before restoring.",
    );
  }

  let granted: string[] = [];
  if (athlete.parent_id) {
    const g = await grantGuardianConsent(admin, {
      athleteId: athlete.id,
      parentId: athlete.parent_id,
      method: "admin",
      evidence: {
        restored_after: RESCIND_CONSENT_REASON,
        admin_user_id: args.adminUserId,
        note: args.note,
      },
      now,
    });
    granted = g.granted;
  }

  const upd = await admin
    .from("athletes")
    .update({ account_state: state })
    .eq("id", athlete.id)
    .eq("account_state", "paused");
  if (upd.error) dbError(upd.error);

  // A RESCIND_CONSENT that landed after the check above is newer than the
  // exemption: it wins, and the athlete is paused (and consent revoked) again.
  const after = await latestWithdrawalAt(admin, downloads);
  const overridden = !!after && ms(after) > ms(nowIso);
  if (overridden) {
    await pauseForRescind(
      admin,
      [athlete.id],
      { now: new Date(Math.max(Date.now(), now.getTime() + 1)), notify: args.notify },
      { notify: "newlyPaused" },
    );
  }

  const logged = await admin.from("webhook_receipts").insert({
    source: RESTORE_LOG_SOURCE,
    external_id: `${athlete.id}:${nowIso}`,
    event: overridden ? "restore_overridden" : "restored",
    received_at: nowIso,
    payload: {
      athleteId: athlete.id,
      adminUserId: args.adminUserId,
      note: args.note,
      state: overridden ? "paused" : state,
      priorState: priorState ?? null,
      granted,
      downloads: downloads.map((d) => `${d.environment}:${d.app_transaction_id}`),
    } as Json,
  });
  if (logged.error) dbError(logged.error);
  if (overridden) {
    throw conflict(
      "withdrawn_again",
      "Apple reported a new consent withdrawal while restoring. The athlete is paused again.",
    );
  }

  console.info("[app-store] restored a paused athlete", {
    athleteId: athlete.id,
    state,
    exemptedDownloads: downloads.length,
  });
  return { ok: true, state, granted, exemptedDownloads: downloads.length };
}

/** The latest `rescinded_at` among these downloads, or null. */
async function latestWithdrawalAt(
  admin: Admin,
  downloads: { app_transaction_id: string; environment: string }[],
): Promise<string | null> {
  if (downloads.length === 0) return null;
  const res = await admin
    .from("app_store_rescinded_transactions")
    .select("app_transaction_id, environment, rescinded_at")
    .in(
      "app_transaction_id",
      downloads.map((d) => d.app_transaction_id),
    );
  if (res.error) dbError(res.error);
  const mine = new Set(downloads.map((d) => `${d.environment}:${d.app_transaction_id}`));
  let latest: string | null = null;
  for (const r of (res.data ?? []) as {
    app_transaction_id: string;
    environment: string;
    rescinded_at: string;
  }[]) {
    if (mine.has(`${r.environment}:${r.app_transaction_id}`))
      latest = later(latest, r.rescinded_at);
  }
  return latest;
}
