import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dbError } from "./db-error";
import { notificationRollup, type ClubNotification } from "./club-notifications";

const orgInput = z.object({ organizationId: z.string().uuid() });
async function authorize(client: SupabaseClient, userId: string, orgId: string) {
  const check = await client.rpc("has_org_admin", { _user_id: userId, _org_id: orgId });
  if (check.error) dbError(check.error);
  if (!check.data) throw new Error("Not authorized for this club");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as SupabaseClient;
}

async function readFeed(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
): Promise<ClubNotification[]> {
  const refreshed = await admin.rpc("refresh_club_notifications", { p_org_id: orgId });
  if (refreshed.error) dbError(refreshed.error);
  const [items, reads] = await Promise.all([
    admin
      .from("club_notifications")
      .select(
        "id, kind, about, title, subject, coach, status, opened_at, resolved_at, resolution, go_to",
      )
      .eq("organization_id", orgId)
      .order("opened_at", { ascending: false }),
    admin
      .from("club_notification_reads")
      .select("notification_id, read_at")
      .eq("organization_id", orgId)
      .eq("user_id", userId),
  ]);
  if (items.error) dbError(items.error);
  if (reads.error) dbError(reads.error);
  const readIds = new Set((reads.data ?? []).map((r) => r.notification_id));
  return (items.data ?? []).map((r) => ({
    id: r.id,
    kind: r.kind,
    about: r.about,
    title: r.title,
    subject: r.subject,
    coach: r.coach,
    status: r.status,
    openedAt: r.opened_at,
    resolvedAt: r.resolved_at,
    resolution: r.resolution,
    goTo: r.go_to,
    unread: !readIds.has(r.id),
  }));
}

export const listClubNotifications = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => orgInput.parse(input))
  .handler(async ({ data, context }) => {
    const admin = await authorize(context.supabase, context.userId, data.organizationId);
    return { items: await readFeed(admin, data.organizationId, context.userId) };
  });

export const getClubNotificationCounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => orgInput.parse(input))
  .handler(async ({ data, context }) => {
    const admin = await authorize(context.supabase, context.userId, data.organizationId);
    const rows = await readFeed(admin, data.organizationId, context.userId);
    return {
      unread: rows.filter((r) => r.unread).length,
      open: rows.filter((r) => r.status !== "resolved").length,
      breakdown: notificationRollup(rows),
    };
  });

export const markClubNotificationsRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    orgInput.extend({ notificationId: z.string().uuid().optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const admin = await authorize(context.supabase, context.userId, data.organizationId);
    let q = admin
      .from("club_notifications")
      .select("id")
      .eq("organization_id", data.organizationId);
    if (data.notificationId) q = q.eq("id", data.notificationId);
    const found = await q;
    if (found.error) dbError(found.error);
    if (data.notificationId && !found.data?.length) throw new Error("Notification not found");
    if (found.data?.length) {
      const saved = await admin.from("club_notification_reads").upsert(
        found.data.map((r) => ({
          organization_id: data.organizationId,
          notification_id: r.id,
          user_id: context.userId,
          read_at: new Date().toISOString(),
        })),
        { onConflict: "notification_id,user_id" },
      );
      if (saved.error) dbError(saved.error);
    }
    return { ok: true };
  });

export const getClubNotificationNotes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    orgInput.extend({ notificationId: z.string().uuid() }).parse(input),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{ notes: { id: string; body: string; createdAt: string }[] }> => {
      const admin = await authorize(context.supabase, context.userId, data.organizationId);
      const result = await admin
        .from("club_safeguarding_notes")
        .select("id, body, created_at")
        .eq("organization_id", data.organizationId)
        .eq("notification_id", data.notificationId)
        .order("created_at");
      if (result.error) dbError(result.error);
      return {
        notes: (result.data ?? []).map((r) => ({
          id: r.id,
          body: r.body,
          createdAt: r.created_at,
        })),
      };
    },
  );

export const addClubNotificationNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    orgInput
      .extend({ notificationId: z.string().uuid(), body: z.string().trim().min(1).max(4000) })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const admin = await authorize(context.supabase, context.userId, data.organizationId);
    const result = await admin
      .from("club_safeguarding_notes")
      .insert({
        organization_id: data.organizationId,
        notification_id: data.notificationId,
        author_user_id: context.userId,
        body: data.body,
      });
    if (result.error) dbError(result.error);
    return { ok: true };
  });
