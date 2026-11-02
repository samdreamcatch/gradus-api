/**
 * In-app notification inbox (migration 20261030120000_notifications). The
 * single source of truth for the `/api/v1/notifications` routes and for the
 * rows `notifyUsers` records alongside every alert push
 * (src/lib/push-notify.server.ts).
 *
 * Reads, mark-read and clear go through the caller's RLS client: the table
 * grants the authenticated role SELECT, DELETE and UPDATE (read_at) on its own
 * rows only. Recording goes through the service role and the
 * `record_notifications` function, which folds events that share a group key
 * into the recipient's unread row.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { ApiError } from "./api/errors";
import { dbError } from "./db-error";

type Client = SupabaseClient<Database>;

/** `notifications` isn't in the generated types until Lovable regenerates them. */
type Untyped = {
  from: (table: string) => any;
  rpc: (fn: string, args: Record<string, unknown>) => any;
};
const untyped = (client: Client) => client as unknown as Untyped;

/** Postgres `undefined_table`/`undefined_function`, or PostgREST's schema-cache miss, before the migration is applied. */
function isMissingTable(error: { code?: string } | null | undefined): boolean {
  return (
    error?.code === "42P01" ||
    error?.code === "42883" ||
    error?.code === "PGRST202" ||
    error?.code === "PGRST205"
  );
}

export type NotificationsContext = { userId: string; supabase: Client };

const COLUMNS =
  "id, type, title, body, route, actor_user_id, athlete_id, count, read_at, created_at";

type NotificationRow = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  route: string | null;
  actor_user_id: string | null;
  athlete_id: string | null;
  count: number;
  read_at: string | null;
  created_at: string;
};

export interface NotificationDTO {
  id: string;
  type: string;
  title: string;
  body: string | null;
  route: string | null;
  actorUserId: string | null;
  athleteId: string | null;
  count: number;
  readAt: string | null;
  createdAt: string;
}

function toDTO(row: NotificationRow): NotificationDTO {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    route: row.route,
    actorUserId: row.actor_user_id,
    athleteId: row.athlete_id,
    count: row.count,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

/**
 * `GET /api/v1/notifications` `[page]` (PRD §6.2 "Pagination"): newest first,
 * paged by an opaque cursor over `(created_at, id)`, the same convention as
 * `getCoachInvoicesPage`. `unreadOnly` narrows to unread rows.
 */
export const notificationsPageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(200).optional(),
  unreadOnly: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});

/** Opaque, URL-safe page cursor: the oldest notification of the page just served. */
export function encodeNotificationCursor(createdAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ c: createdAt, i: id }), "utf8").toString("base64url");
}

export function decodeNotificationCursor(cursor: string): { createdAt: string; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      c?: unknown;
      i?: unknown;
    };
    if (typeof parsed.c !== "string" || typeof parsed.i !== "string" || !parsed.c || !parsed.i) {
      throw new Error("shape");
    }
    if (Number.isNaN(Date.parse(parsed.c))) throw new Error("date");
    return { createdAt: parsed.c, id: parsed.i };
  } catch {
    throw new ApiError({ code: "validation_failed", status: 400, message: "Bad cursor." });
  }
}

export async function getNotificationsPage(
  ctx: NotificationsContext,
  input: z.infer<typeof notificationsPageQuery>,
): Promise<{ items: NotificationDTO[]; nextCursor: string | null }> {
  const before = input.cursor ? decodeNotificationCursor(input.cursor) : null;

  let query = untyped(ctx.supabase)
    .from("notifications")
    .select(COLUMNS)
    .eq("user_id", ctx.userId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  if (input.unreadOnly) query = query.is("read_at", null);
  if (before) {
    query = query.or(
      `created_at.lt.${before.createdAt},and(created_at.eq.${before.createdAt},id.lt.${before.id})`,
    );
  }

  const { data, error } = await query.limit(input.limit + 1);
  if (error) {
    if (isMissingTable(error)) return { items: [], nextCursor: null };
    dbError(error);
  }

  const rows = (data ?? []) as NotificationRow[];
  const hasMore = rows.length > input.limit;
  const page = hasMore ? rows.slice(0, input.limit) : rows;
  const oldest = page[page.length - 1];
  const nextCursor =
    hasMore && oldest ? encodeNotificationCursor(oldest.created_at, oldest.id) : null;
  return { items: page.map(toDTO), nextCursor };
}

/** `GET /api/v1/notifications/unread-count`: the badge. Folded rows count once. */
export async function getUnreadNotificationCount(
  ctx: NotificationsContext,
): Promise<{ count: number }> {
  const { count, error } = await untyped(ctx.supabase)
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", ctx.userId)
    .is("read_at", null);
  if (error) {
    if (isMissingTable(error)) return { count: 0 };
    dbError(error);
  }
  return { count: count ?? 0 };
}

/**
 * `POST /api/v1/notifications/read`: `{ ids }` marks those rows, `{ all: true }`
 * every unread row. One flat object rather than a union, so the generated
 * Swift client gets a plain struct.
 */
export const markNotificationsReadInput = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200).optional(),
  all: z.boolean().optional(),
});

export async function markNotificationsRead(
  ctx: NotificationsContext,
  input: z.infer<typeof markNotificationsReadInput>,
): Promise<{ ok: true }> {
  if (!input.all && !input.ids) {
    throw new ApiError({
      code: "validation_failed",
      status: 400,
      message: "Send ids, or all: true.",
    });
  }
  let query = untyped(ctx.supabase)
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", ctx.userId)
    .is("read_at", null);
  if (!input.all && input.ids) query = query.in("id", input.ids);
  const { error } = await query;
  if (error && !isMissingTable(error)) dbError(error);
  return { ok: true };
}

/**
 * `DELETE /api/v1/notifications/{id}`: clear one row. A row that was already
 * cleared (or never existed for this caller) is still a 200.
 */
export async function clearNotification(
  ctx: NotificationsContext,
  id: string,
): Promise<{ ok: true }> {
  const { error } = await untyped(ctx.supabase)
    .from("notifications")
    .delete()
    .eq("user_id", ctx.userId)
    .eq("id", id);
  if (error && !isMissingTable(error)) dbError(error);
  return { ok: true };
}

/** `DELETE /api/v1/notifications`: clear the caller's whole inbox. */
export async function clearAllNotifications(ctx: NotificationsContext): Promise<{ ok: true }> {
  const { error } = await untyped(ctx.supabase)
    .from("notifications")
    .delete()
    .eq("user_id", ctx.userId);
  if (error && !isMissingTable(error)) dbError(error);
  return { ok: true };
}

/** Inbox rows keep more than the 160-character push body, but not unbounded text. */
const INBOX_BODY_LIMIT = 1000;

export type NotificationEvent = {
  type: string;
  title: string;
  body?: string;
  route?: string;
  groupKey?: string;
  /** The push collapse id: a new event with the same key replaces the row (migration 20261102120000). */
  collapseKey?: string;
  actorUserId?: string;
  athleteId?: string;
};

/**
 * Record one event for every recipient, as the service role. Called by
 * `notifyUsers` before it sends the push, so the inbox fills even when the
 * recipient has push off or no device. Never throws: a failed write must not
 * stop the push or the action that triggered it (PRD §4.1 rule 7).
 */
export async function recordNotifications(
  admin: Client,
  userIds: string[],
  event: NotificationEvent,
): Promise<void> {
  if (userIds.length === 0) return;
  try {
    const body = event.body?.trim();
    const { error } = await untyped(admin).rpc("record_notifications", {
      p_user_ids: userIds,
      p_type: event.type,
      p_title: event.title,
      p_body: body ? body.slice(0, INBOX_BODY_LIMIT) : null,
      p_route: event.route ?? null,
      p_group_key: event.groupKey ?? null,
      p_actor_user_id: event.actorUserId ?? null,
      p_athlete_id: event.athleteId ?? null,
      p_collapse_key: event.collapseKey ?? null,
    });
    if (error && !isMissingTable(error)) {
      console.error("[notifications] record failed", error);
    }
  } catch (err) {
    console.error("[notifications] record failed", err instanceof Error ? err.message : err);
  }
}
