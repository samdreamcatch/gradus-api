import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dbError } from "./db-error";
import { REPORT_REASONS, reportInput, type ReportReason } from "./safety-types";

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

export type { BlockedUser } from "./safety.server";

/* ---------------- blockUser ---------------- */

/** Thin wrapper over the shared `blockUser` (src/lib/safety.server.ts). */
export const blockUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ targetUserId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { blockUser: block } = await import("./safety.server");
    return block({ userId: context.userId, admin: supabaseAdmin }, data);
  });

/* ---------------- unblockUser ---------------- */

/** Thin wrapper over the shared `unblockUser` (src/lib/safety.server.ts). */
export const unblockUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ targetUserId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { unblockUser: unblock } = await import("./safety.server");
    return unblock({ userId: context.userId, admin: supabaseAdmin }, data);
  });

/* ---------------- listMyBlocks ---------------- */

/** Thin wrapper over the shared `listBlocks` (src/lib/safety.server.ts). */
export const listMyBlocks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { listBlocks } = await import("./safety.server");
    return listBlocks({ userId: context.userId, admin: supabaseAdmin });
  });

/* ---------------- submitReport ---------------- */

/** Thin wrapper over the shared `submitReport` (src/lib/safety.server.ts). */
export const submitReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => reportInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { submitReport: report } = await import("./safety.server");
    return report(
      { userId: context.userId, admin: supabaseAdmin, supabase: context.supabase as any },
      data,
    );
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
  reported: { userId: string | null; name: string; role: string };
  messageBody: string | null;
  resourceTitle: string | null;
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
        "id, reporter_user_id, reported_user_id, message_id, resource_id, reason, note, status, admin_notes, created_at",
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

    const resourceIds = (rows ?? []).map((r: any) => r.resource_id).filter(Boolean) as string[];
    const resourceById = new Map<string, string>();
    if (resourceIds.length) {
      const { data: res } = await supabaseAdmin
        .from("resources")
        .select("id, title, kind")
        .in("id", resourceIds);
      for (const x of res ?? []) {
        resourceById.set(x.id, `${x.title ?? "Untitled"} (${x.kind ?? "file"})`);
      }
    }

    const items: AdminReport[] = [];
    for (const r of rows ?? []) {
      const [reporter, reported] = await Promise.all([
        who(r.reporter_user_id),
        r.reported_user_id
          ? who(r.reported_user_id)
          : Promise.resolve({ name: "Gradus resource", role: "n/a" }),
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
        resourceTitle: r.resource_id
          ? (resourceById.get(r.resource_id) ?? "Deleted resource")
          : null,
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
    const patch = {
      status: data.status,
      ...(data.adminNotes !== undefined ? { admin_notes: data.adminNotes } : {}),
    };
    const { error } = await supabaseAdmin.from("user_reports").update(patch).eq("id", data.id);
    if (error) dbError(error);
    return { ok: true as const };
  });
