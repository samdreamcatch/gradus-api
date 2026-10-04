/**
 * Retention sweeps beyond the provisional one (PRD §6.13 A9, milestone S5;
 * decisions #41–#43, Mariah 2026-10-03; reworked after the 2026-10-04
 * adversarial review). Run daily from `/api/public/hooks/consent-retention`.
 *
 * Dormant minor accounts (#41). An athlete whose birthdate makes them under
 * 18 and whose account has seen no activity for `DORMANT_MONTHS` is deleted
 * `DORMANT_NOTICE_DAYS` plus one day of grace (so the date the email names
 * has ended in every US time zone) after every guardian on file was emailed.
 * Activity is the latest of anything anyone did on the account: the
 * athlete's and guardians' sign-ins and devices, logged practice, messages,
 * goal edits, and the coach's work on the athlete (wrap-ups, briefings,
 * invoices, skill events, competition results). `updated_at` is not a
 * signal: this sweep's own stamps bump it.
 *
 * Rules the review forced:
 * - A failed lookup or a failed send is a failed row, retried tomorrow. It
 *   is never read as "nobody to notify" or "notice sent".
 * - Nobody to notify (no guardian with an email, no guardian email on file)
 *   leaves the account alone and counts it; it is never deleted unseen.
 * - Accounts with no birthdate are out of scope (coach-added adults may
 *   carry none); `isMinorBirthdate` decides, with the floor applied
 *   server-side first. Adult athletes: §12 #34.
 * - Every examined row gets `retention_checked_at`, and candidates are taken
 *   least-recently-checked first, so old active accounts cannot occupy the
 *   batch forever.
 * - A deletion always leaves a `deleted_accounts` tombstone, login or not.
 * - The run stops at its time budget and resumes tomorrow.
 *
 * Records (#43). Webhook receipts and deletion tombstones carry no personal
 * data beyond an email hash; they are the audit trail that consent was
 * obtained and deletions happened, kept `RECORD_RETENTION_YEARS`, then gone.
 */
import type { supabaseAdmin } from "@/integrations/supabase/client.server";
import { dbError } from "./db-error";
import { isMinorBirthdate } from "./athlete-age";
import { provisionalCutoff } from "./guardian-verification.server";

type Admin = typeof supabaseAdmin;

export const DORMANT_MONTHS = 36;
export const DORMANT_NOTICE_DAYS = 30;
/** The email names a UTC date; deleting a day later keeps "on <date>" true west of UTC. */
export const DORMANT_GRACE_DAYS = 1;
export const RECORD_RETENTION_YEARS = 5;
export const DEFAULT_RUN_BUDGET_MS = 20_000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Three years back, clamped like the provisional cutoff (never deletes early). */
export function dormantCutoff(now: Date): Date {
  return provisionalCutoff(now, DORMANT_MONTHS);
}

/** Five years back, month-clamped the same way (Feb 29 does not roll forward). */
export function recordCutoff(now: Date): Date {
  return provisionalCutoff(now, RECORD_RETENTION_YEARS * 12);
}

/** `YYYY-MM-DD` eighteen years before `now`: a birthdate after it is under 18 today. */
export function minorBirthdateFloor(now: Date): string {
  return provisionalCutoff(now, 18 * 12)
    .toISOString()
    .slice(0, 10);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export interface RetentionNoticeArgs {
  to: string;
  athleteName: string;
  deleteOn: Date;
}

export interface DormantSweepDeps {
  purgeAthlete: (athleteId: string) => Promise<void>;
  /** The raw auth deletion; the tombstone is `recordDeletion`'s job. */
  deleteAuthUser: (userId: string) => Promise<void>;
  /** The `deleted_accounts` row, written before the purge, login or not. */
  recordDeletion: (args: { athleteId: string; userId: string | null }) => Promise<void>;
  /** Must throw when the email was not queued; a swallowed failure would stamp a notice nobody got. */
  sendNotice: (args: RetentionNoticeArgs) => Promise<void>;
}

const DORMANT_COLUMNS =
  "id, user_id, parent_id, first_name, birthdate, created_at, is_test, retention_notice_sent_at, retention_checked_at, guardian_email";

export interface DormantAthleteRow {
  id: string;
  user_id: string | null;
  parent_id: string | null;
  first_name: string;
  birthdate: string | null;
  created_at: string;
  is_test: boolean | null;
  retention_notice_sent_at: string | null;
  retention_checked_at: string | null;
  guardian_email: string | null;
}

function latest(dates: Array<string | Date | null | undefined>): Date | null {
  let best: Date | null = null;
  for (const d of dates) {
    if (!d) continue;
    const t = d instanceof Date ? d : new Date(d);
    if (Number.isNaN(t.getTime())) continue;
    if (!best || t > best) best = t;
  }
  return best;
}

interface GuardianAccount {
  parentId: string;
  userId: string | null;
  lastSeenAt: string | null;
}

interface AuthSummary {
  email: string | null;
  lastSignInAt: string | null;
}

/** Per-run memo of auth lookups: one call per user, however many rows share a guardian. */
export type AuthCache = Map<string, AuthSummary | null>;

/** The parent on the row plus co-guardians, deduplicated. */
async function guardianAccounts(admin: Admin, row: DormantAthleteRow): Promise<GuardianAccount[]> {
  const ids = new Set<string>();
  if (row.parent_id) ids.add(row.parent_id);
  const co = await admin.from("athlete_guardians").select("parent_id").eq("athlete_id", row.id);
  if (co.error) dbError(co.error);
  for (const r of (co.data ?? []) as { parent_id: string }[]) ids.add(r.parent_id);
  if (ids.size === 0) return [];
  const parents = await admin
    .from("parent_profiles")
    .select("id, user_id, last_seen_at")
    .in("id", [...ids]);
  if (parents.error) dbError(parents.error);
  return (
    (parents.data ?? []) as { id: string; user_id: string | null; last_seen_at: string | null }[]
  ).map((p) => ({ parentId: p.id, userId: p.user_id, lastSeenAt: p.last_seen_at }));
}

/**
 * One auth user. A missing user is `null`; any other failure throws, so the
 * row is retried tomorrow instead of being read as "no email, delete now".
 */
async function authUser(
  admin: Admin,
  userId: string,
  cache: AuthCache,
): Promise<AuthSummary | null> {
  if (cache.has(userId)) return cache.get(userId) ?? null;
  const res = await admin.auth.admin.getUserById(userId);
  if (res.error) {
    const err = res.error as { status?: number; message?: string };
    if (err.status === 404 || /not found/i.test(err.message ?? "")) {
      cache.set(userId, null);
      return null;
    }
    throw new Error(`auth lookup failed for ${userId}: ${err.message ?? "unknown error"}`);
  }
  const u = res.data?.user as
    | { email?: string | null; last_sign_in_at?: string | null }
    | null
    | undefined;
  const summary: AuthSummary | null = u
    ? { email: u.email?.trim().toLowerCase() || null, lastSignInAt: u.last_sign_in_at ?? null }
    : null;
  cache.set(userId, summary);
  return summary;
}

/** The few PostgREST calls `newest` needs, untyped by table so one helper serves twelve tables. */
interface LooseFilter {
  eq(column: string, value: string): LooseFilter;
  in(column: string, values: string[]): LooseFilter;
  order(column: string, opts: { ascending: boolean }): LooseFilter;
  limit(n: number): PromiseLike<{ data: Record<string, string>[] | null; error: unknown }>;
}

/** The newest value of `column` on `table` for this athlete, or undefined. */
async function newest(
  admin: Admin,
  table: string,
  column: string,
  filter: { column: string; value: string | string[] },
): Promise<string | undefined> {
  const from = (admin as unknown as { from(table: string): { select(c: string): LooseFilter } })
    .from;
  let q = from.call(admin, table).select(column);
  q = Array.isArray(filter.value)
    ? q.in(filter.column, filter.value)
    : q.eq(filter.column, filter.value);
  const res = await q.order(column, { ascending: false }).limit(1);
  if (res.error) dbError(res.error as never);
  const row = (res.data ?? [])[0];
  return row?.[column];
}

/** Everything that counts as someone using the account, newest first wins. */
export async function lastActivityAt(
  admin: Admin,
  row: DormantAthleteRow,
  guardians: GuardianAccount[],
  cache: AuthCache,
): Promise<Date> {
  const by = { column: "athlete_id", value: row.id };
  const signals: Array<string | Date | null | undefined> = [row.created_at];

  // The athlete's and parents' own activity.
  signals.push(await newest(admin, "plan_sessions", "logged_at", by));
  signals.push(await newest(admin, "athlete_goals", "updated_at", by));
  const rooms = await admin.from("message_rooms").select("id").eq("athlete_id", row.id);
  if (rooms.error) dbError(rooms.error);
  const roomIds = ((rooms.data ?? []) as { id: string }[]).map((r) => r.id);
  if (roomIds.length > 0) {
    signals.push(
      await newest(admin, "messages", "created_at", { column: "room_id", value: roomIds }),
    );
  }
  signals.push(await newest(admin, "competition_attendance", "first_seen_at", by));
  signals.push(await newest(admin, "app_store_app_transactions", "last_seen_at", by));

  // The coach's work on the athlete: an actively coached athlete is in use
  // even when the family never opens the app.
  signals.push(await newest(admin, "lesson_wrap_ups", "updated_at", by));
  signals.push(await newest(admin, "pre_lesson_briefings", "updated_at", by));
  signals.push(await newest(admin, "invoices", "updated_at", by));
  signals.push(await newest(admin, "athlete_skill_events", "occurred_at", by));
  signals.push(await newest(admin, "athlete_competition_results", "updated_at", by));

  // Sign-ins and devices, for the athlete and every guardian.
  const userIds = [row.user_id, ...guardians.map((g) => g.userId)].filter((u): u is string => !!u);
  for (const g of guardians) signals.push(g.lastSeenAt);
  for (const uid of userIds) signals.push((await authUser(admin, uid, cache))?.lastSignInAt);
  if (userIds.length > 0) {
    signals.push(
      await newest(admin, "device_tokens", "last_seen_at", { column: "user_id", value: userIds }),
    );
  }

  return latest(signals) ?? new Date(row.created_at);
}

/** Every address the notice goes to: each guardian's account email, else the guardian email on file. */
async function noticeRecipients(
  admin: Admin,
  row: DormantAthleteRow,
  guardians: GuardianAccount[],
  cache: AuthCache,
): Promise<string[]> {
  const out = new Set<string>();
  for (const g of guardians) {
    if (!g.userId) continue;
    const email = (await authUser(admin, g.userId, cache))?.email;
    if (email) out.add(email);
  }
  if (out.size === 0 && row.guardian_email?.trim())
    out.add(row.guardian_email.trim().toLowerCase());
  return [...out];
}

export interface DormantSweepResult {
  scanned: number;
  /** Rows that got the notice this run (one row may notify several guardians). */
  noticed: number;
  /** Notices cancelled because activity resumed. */
  reactivated: number;
  deleted: number;
  /** Notified, still inside the window. */
  waiting: number;
  /** Dormant but nobody to tell: left alone for an admin to look at. */
  unnotifiable: number;
  /** Not examined this run: out of time budget. */
  skipped: number;
  failed: number;
}

export async function sweepDormantMinorAthletes(
  admin: Admin,
  opts: {
    now?: Date;
    deps?: DormantSweepDeps;
    limit?: number;
    budgetMs?: number;
    cache?: AuthCache;
  } = {},
): Promise<DormantSweepResult> {
  const now = opts.now ?? new Date();
  const started = Date.now();
  const budgetMs = opts.budgetMs ?? DEFAULT_RUN_BUDGET_MS;
  const cutoff = dormantCutoff(now);
  const floor = minorBirthdateFloor(now);
  const deps = opts.deps ?? (await defaultDormantDeps());
  const limit = opts.limit ?? 200;
  const cache: AuthCache = opts.cache ?? new Map();

  // Rows with a notice pending come first, whatever their age; then old
  // under-18 accounts with no notice, least recently examined first.
  const pending = await admin
    .from("athletes")
    .select(DORMANT_COLUMNS)
    .eq("is_test", false)
    .not("retention_notice_sent_at", "is", null)
    .order("retention_notice_sent_at", { ascending: true })
    .limit(limit);
  if (pending.error) dbError(pending.error);
  const fresh = await admin
    .from("athletes")
    .select(DORMANT_COLUMNS)
    .eq("is_test", false)
    .is("retention_notice_sent_at", null)
    .lt("created_at", cutoff.toISOString())
    .gt("birthdate", floor)
    .order("retention_checked_at", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: true })
    .limit(limit);
  if (fresh.error) dbError(fresh.error);

  const rows = [
    ...((pending.data ?? []) as DormantAthleteRow[]),
    ...((fresh.data ?? []) as DormantAthleteRow[]),
  ];

  const result: DormantSweepResult = {
    scanned: 0,
    noticed: 0,
    reactivated: 0,
    deleted: 0,
    waiting: 0,
    unnotifiable: 0,
    skipped: 0,
    failed: 0,
  };

  type RetentionPatch = {
    retention_checked_at?: string | null;
    retention_notice_sent_at?: string | null;
  };
  const stamp = async (id: string, patch: RetentionPatch) => {
    const upd = await admin.from("athletes").update(patch).eq("id", id);
    if (upd.error) dbError(upd.error);
  };

  for (const row of rows) {
    if (Date.now() - started > budgetMs) {
      result.skipped += 1;
      continue;
    }
    result.scanned += 1;
    try {
      // The server-side floor is a prefilter; the calendar check is the rule.
      // An athlete who turned 18 after a notice went out leaves the rule too:
      // clearing the stamp keeps the pending batch from filling with them.
      if (!isMinorBirthdate(row.birthdate, now)) {
        await stamp(row.id, {
          retention_checked_at: now.toISOString(),
          retention_notice_sent_at: null,
        });
        continue;
      }

      const guardians = await guardianAccounts(admin, row);
      const last = await lastActivityAt(admin, row, guardians, cache);
      if (last >= cutoff) {
        if (row.retention_notice_sent_at) result.reactivated += 1;
        await stamp(row.id, {
          retention_checked_at: now.toISOString(),
          retention_notice_sent_at: null,
        });
        continue;
      }

      if (!row.retention_notice_sent_at) {
        const recipients = await noticeRecipients(admin, row, guardians, cache);
        if (recipients.length === 0) {
          // Nobody to tell. The policy promises an email first, so the
          // account stays; the count is the admin's cue to look.
          result.unnotifiable += 1;
          await stamp(row.id, { retention_checked_at: now.toISOString() });
          continue;
        }
        const deleteOn = addDays(now, DORMANT_NOTICE_DAYS);
        for (const to of recipients) {
          await deps.sendNotice({ to, athleteName: row.first_name, deleteOn });
        }
        // Only after every send was queued: a stamp with no email behind it
        // would be a deletion nobody was warned about.
        await stamp(row.id, {
          retention_checked_at: now.toISOString(),
          retention_notice_sent_at: now.toISOString(),
        });
        result.noticed += 1;
        continue;
      }

      const sentAt = new Date(row.retention_notice_sent_at);
      if (now.getTime() - sentAt.getTime() < (DORMANT_NOTICE_DAYS + DORMANT_GRACE_DAYS) * DAY_MS) {
        result.waiting += 1;
        await stamp(row.id, { retention_checked_at: now.toISOString() });
        continue;
      }
      await deps.recordDeletion({ athleteId: row.id, userId: row.user_id });
      await deps.purgeAthlete(row.id);
      if (row.user_id) await deps.deleteAuthUser(row.user_id);
      result.deleted += 1;
    } catch (err) {
      result.failed += 1;
      console.error("[retention] dormant sweep failed for athlete", row.id, err);
      // Rotate a failing row to the back so it cannot block the others.
      try {
        await stamp(row.id, { retention_checked_at: now.toISOString() });
      } catch (stampErr) {
        console.error("[retention] could not stamp athlete", row.id, stampErr);
      }
    }
  }
  return result;
}

async function defaultDormantDeps(): Promise<DormantSweepDeps> {
  const [{ purgeAthlete }, { supabaseAdmin }, { sendRetentionNotice }] = await Promise.all([
    import("./account-deletion.server"),
    import("@/integrations/supabase/client.server"),
    import("./guardian.server"),
  ]);
  return {
    purgeAthlete,
    deleteAuthUser: async (userId) => {
      const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
      if (error) throw new Error(error.message);
    },
    recordDeletion: async ({ athleteId, userId }) => {
      // `deleted_accounts.user_id` is NOT NULL; a parent-managed minor has no
      // login, so the athlete id stands in and the note says so. No email is
      // ever collected for the sweep, so no hash.
      const { error } = await supabaseAdmin.from("deleted_accounts").insert({
        user_id: userId ?? athleteId,
        role: "athlete",
        initiated_by: "retention",
        notes: userId
          ? "dormant athlete account (retention policy)"
          : "dormant athlete profile without a login; user_id holds the athlete id (retention policy)",
      });
      if (error) throw new Error(error.message);
    },
    sendNotice: sendRetentionNotice,
  };
}

export interface RecordPurgeResult {
  receipts: number;
  tombstones: number;
}

/** Audit records older than `RECORD_RETENTION_YEARS` (#43). */
export async function purgeExpiredRecords(
  admin: Admin,
  opts: { now?: Date } = {},
): Promise<RecordPurgeResult> {
  const cutoff = recordCutoff(opts.now ?? new Date()).toISOString();
  const receipts = await admin
    .from("webhook_receipts")
    .delete()
    .lt("received_at", cutoff)
    .select("id");
  if (receipts.error) dbError(receipts.error);
  const tombstones = await admin
    .from("deleted_accounts")
    .delete()
    .lt("deleted_at", cutoff)
    .select("id");
  if (tombstones.error) dbError(tombstones.error);
  return {
    receipts: (receipts.data ?? []).length,
    tombstones: (tombstones.data ?? []).length,
  };
}
