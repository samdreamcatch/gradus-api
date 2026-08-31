import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dbError } from "./db-error";
import { REPORT_REASONS, type ReportReason } from "./safety-types";

export type { ReportReason };
export { REPORT_REASONS };

/* eslint-disable @typescript-eslint/no-explicit-any */

async function assertAdmin(context: { userId: string; supabase: any }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) dbError(error);
  if (!data) throw new Error("Forbidden");
}

export type BlockedUser = {
  userId: string;
  name: string;
  role: "coach" | "parent" | "athlete" | "unknown";
  blockedAt: string;
};

/* ---------------- blockUser ---------------- */

export const blockUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ targetUserId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    if (data.targetUserId === context.userId) throw new Error("You can't block yourself.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { resolveIdentity, severRelationships } = await import("./safety.server");

    const [me, them] = await Promise.all([
      resolveIdentity(supabaseAdmin, context.userId),
      resolveIdentity(supabaseAdmin, data.targetUserId),
    ]);

    const { error } = await supabaseAdmin
      .from("user_blocks")
      .upsert(
        { blocker_user_id: context.userId, blocked_user_id: data.targetUserId },
        { onConflict: "blocker_user_id,blocked_user_id" },
      );
    if (error) dbError(error, "Couldn't block this person");

    await severRelationships(supabaseAdmin, me, them);
    return { ok: true as const };
  });

/* ---------------- unblockUser ---------------- */

export const unblockUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ targetUserId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("user_blocks")
      .delete()
      .eq("blocker_user_id", context.userId)
      .eq("blocked_user_id", data.targetUserId);
    if (error) dbError(error, "Couldn't unblock this person");
    return { ok: true as const };
  });

/* ---------------- listMyBlocks ---------------- */

export const listMyBlocks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { resolveIdentity } = await import("./safety.server");

    const { data: rows, error } = await supabaseAdmin
      .from("user_blocks")
      .select("blocked_user_id, created_at")
      .eq("blocker_user_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) dbError(error);

    const blocks: BlockedUser[] = [];
    for (const row of rows ?? []) {
      const who = await resolveIdentity(supabaseAdmin, row.blocked_user_id);
      blocks.push({
        userId: row.blocked_user_id,
        name: who.name,
        role: who.role,
        blockedAt: row.created_at,
      });
    }
    return { blocks };
  });

/* ---------------- submitReport ---------------- */

export const submitReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        targetUserId: z.string().uuid(),
        messageId: z.string().uuid().nullish(),
        reason: z.enum(REPORT_REASONS),
        note: z.string().trim().max(2000).default(""),
        alsoBlock: z.boolean().default(true),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    if (data.targetUserId === context.userId) throw new Error("You can't report yourself.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { resolveIdentity, severRelationships, sendReportAlert } = await import(
      "./safety.server"
    );

    const [me, them] = await Promise.all([
      resolveIdentity(supabaseAdmin, context.userId),
      resolveIdentity(supabaseAdmin, data.targetUserId),
    ]);

    let messageBody: string | null = null;
    if (data.messageId) {
      const { data: msg } = await supabaseAdmin
        .from("messages")
        .select("body, kind")
        .eq("id", data.messageId)
        .maybeSingle();
      if (msg) messageBody = msg.kind === "voice" ? "(voice note)" : (msg.body ?? "");
    }

    const { data: inserted, error } = await supabaseAdmin
      .from("user_reports")
      .insert({
        reporter_user_id: context.userId,
        reported_user_id: data.targetUserId,
        message_id: data.messageId ?? null,
        reason: data.reason,
        note: data.note,
      })
      .select("id")
      .single();
    if (error) dbError(error, "Couldn't submit this report");

    if (data.alsoBlock) {
      await supabaseAdmin
        .from("user_blocks")
        .upsert(
          { blocker_user_id: context.userId, blocked_user_id: data.targetUserId },
          { onConflict: "blocker_user_id,blocked_user_id" },
        );
      await severRelationships(supabaseAdmin, me, them);
    }

    await sendReportAlert(supabaseAdmin, {
      reportId: inserted!.id,
      reason: data.reason,
      note: data.note,
      reporter: me,
      reported: them,
      messageBody,
      blocked: data.alsoBlock,
    });

    return { ok: true as const, blocked: data.alsoBlock };
  });

/* ---------------- admin queue ---------------- */

export type AdminReport = {
  id: string;
  reason: ReportReason;
  note: string;
  status: "open" | "reviewed" | "actioned" | "dismissed";
  adminNotes: string;
  createdAt: string;
  reporter: { userId: string; name: string; role: string };
  reported: { userId: string; name: string; role: string };
  messageBody: string | null;
  urgent: boolean;
};

export const adminListReports = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ openOnly: z.boolean().default(false) })
      .default({ openOnly: false })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { resolveIdentity } = await import("./safety.server");

    let q = supabaseAdmin
      .from("user_reports")
      .select(
        "id, reporter_user_id, reported_user_id, message_id, reason, note, status, admin_notes, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(200);
    if (data.openOnly) q = q.eq("status", "open");
    const { data: rows, error } = await q;
    if (error) dbError(error);

    const cache = new Map<string, { name: string; role: string }>();
    const who = async (uid: string) => {
      const hit = cache.get(uid);
      if (hit) return hit;
      const id = await resolveIdentity(supabaseAdmin, uid);
      const val = { name: id.name, role: id.role };
      cache.set(uid, val);
      return val;
    };

    const messageIds = (rows ?? []).map((r: any) => r.message_id).filter(Boolean) as string[];
    const bodyById = new Map<string, string>();
    if (messageIds.length) {
      const { data: msgs } = await supabaseAdmin
        .from("messages")
        .select("id, body, kind")
        .in("id", messageIds);
      for (const m of msgs ?? []) {
        bodyById.set(m.id, m.kind === "voice" ? "(voice note)" : (m.body ?? ""));
      }
    }

    const items: AdminReport[] = [];
    for (const r of rows ?? []) {
      const [reporter, reported] = await Promise.all([
        who(r.reporter_user_id),
        who(r.reported_user_id),
      ]);
      items.push({
        id: r.id,
        reason: r.reason as ReportReason,
        note: r.note ?? "",
        status: r.status as AdminReport["status"],
        adminNotes: r.admin_notes ?? "",
        createdAt: r.created_at,
        reporter: { userId: r.reporter_user_id, ...reporter },
        reported: { userId: r.reported_user_id, ...reported },
        messageBody: r.message_id ? (bodyById.get(r.message_id) ?? null) : null,
        urgent: r.reason === "minor_safety",
      });
    }

    // Safety concerns about a minor float to the top, then newest first.
    items.sort((a, b) => {
      if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
      return a.createdAt < b.createdAt ? 1 : -1;
    });

    return { items };
  });

export const adminUpdateReportStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(["open", "reviewed", "actioned", "dismissed"]),
        adminNotes: z.string().max(2000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: Record<string, unknown> = { status: data.status };
    if (data.adminNotes !== undefined) patch['admin_notes'] = data.adminNotes;
    const { error } = await supabaseAdmin.from("user_reports").update(patch).eq("id", data.id);
    if (error) dbError(error);
    return { ok: true as const };
  });
