/**
 * Admin server functions for the message check (PRD decision #64): the
 * flagged-messages list, the messaging pause, and the Message rules audit
 * view. Admin only; the tables are server-only (service role).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dbError } from "./db-error";
import { flagPriority, type FlagOutcome } from "./message-flags";
import { MESSAGE_CATEGORY_INFO, MESSAGE_RULE_SET, type MessageCategory } from "./message-rules";

/* eslint-disable @typescript-eslint/no-explicit-any */

async function assertAdmin(context: { userId: string; supabase: any }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) dbError(error);
  if (!data) throw new Error("Forbidden");
}

/** The migration is applied by hand in Lovable; until then the pages say so instead of failing. */
function missingTable(error: { code?: string | null } | null | undefined): boolean {
  return error?.code === "42P01" || error?.code === "PGRST205";
}

export type FlagStatus = "open" | "reviewed" | "actioned" | "dismissed";

export type AdminMessageFlag = {
  id: string;
  category: MessageCategory;
  ruleId: string;
  matched: string;
  outcome: FlagOutcome;
  status: FlagStatus;
  createdAt: string;
  /** Null once dismissed as a false alarm: the text is deleted then. */
  body: string | null;
  sender: { userId: string; name: string; role: string; minor: boolean; paused: boolean };
  roomHasMinor: boolean;
};

export const adminListMessageFlags = createServerFn({ method: "POST" })
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
    const admin = supabaseAdmin as any;

    let q = admin
      .from("message_flags")
      .select(
        "id, sender_user_id, sender_role, sender_minor, room_has_minor, body, category, rule_id, matched, outcome, status, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(200);
    if (data.openOnly) q = q.eq("status", "open");
    const { data: rows, error } = await q;
    if (error) {
      if (missingTable(error)) return { items: [] as AdminMessageFlag[], migrationPending: true };
      dbError(error);
    }

    const senderIds: string[] = [
      ...new Set<string>((rows ?? []).map((r: any) => r.sender_user_id as string)),
    ];
    const paused = new Set<string>();
    if (senderIds.length) {
      const { data: susp } = await admin
        .from("messaging_suspensions")
        .select("user_id")
        .in("user_id", senderIds);
      for (const s of susp ?? []) paused.add(s.user_id);
    }
    const names = new Map<string, string>();
    await Promise.all(
      senderIds.map(async (id) => names.set(id, (await resolveIdentity(admin, id)).name)),
    );

    const items: AdminMessageFlag[] = (rows ?? []).map((r: any) => ({
      id: r.id,
      category: r.category,
      ruleId: r.rule_id,
      matched: r.matched ?? "",
      outcome: r.outcome,
      status: r.status,
      createdAt: r.created_at,
      body: r.body ?? null,
      sender: {
        userId: r.sender_user_id,
        name: names.get(r.sender_user_id) ?? "Unknown user",
        role: r.sender_role,
        minor: !!r.sender_minor,
        paused: paused.has(r.sender_user_id),
      },
      roomHasMinor: !!r.room_has_minor,
    }));

    // Open first; then sent anyway, then anything a sender under 18 typed, then newest.
    items.sort((a, b) => {
      if ((a.status === "open") !== (b.status === "open")) return a.status === "open" ? -1 : 1;
      const pa = flagPriority({
        outcome: a.outcome,
        senderMinor: a.sender.minor,
        category: a.category,
      });
      const pb = flagPriority({
        outcome: b.outcome,
        senderMinor: b.sender.minor,
        category: b.category,
      });
      if (pa !== pb) return pa - pb;
      return a.createdAt < b.createdAt ? 1 : -1;
    });
    return { items, migrationPending: false };
  });

/** Dismissing a flag as a false alarm deletes its text (PRD #64, §12 #41). */
export const adminUpdateMessageFlag = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(["open", "reviewed", "actioned", "dismissed"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch = {
      status: data.status,
      ...(data.status === "dismissed" ? { body: null, matched: "" } : {}),
    };
    const { error } = await (supabaseAdmin as any)
      .from("message_flags")
      .update(patch)
      .eq("id", data.id);
    if (error) dbError(error);
    return { ok: true as const };
  });

/** Pause or resume one user's messaging. A delivered message is never removed. */
export const adminSetMessagingPaused = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ userId: z.string().uuid(), paused: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const table = (supabaseAdmin as any).from("messaging_suspensions");
    const { error } = data.paused
      ? await table.upsert(
          { user_id: data.userId, paused_by: (context as any).userId },
          { onConflict: "user_id" },
        )
      : await table.delete().eq("user_id", data.userId);
    if (error) dbError(error);
    return { ok: true as const };
  });

export type AdminMessageRule = {
  id: string;
  category: MessageCategory;
  label: string;
  pattern: string;
  /** Times it fired, and how many of those were dismissed as false alarms. */
  fired: number;
  falseAlarms: number;
};

/** The audit view: every category, its criteria, every rule, and how each has performed. */
export const adminMessageRules = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await (supabaseAdmin as any)
      .from("message_flags")
      .select("rule_id, status")
      .limit(10000);
    if (error && !missingTable(error)) dbError(error);

    const fired = new Map<string, number>();
    const falseAlarms = new Map<string, number>();
    for (const r of rows ?? []) {
      fired.set(r.rule_id, (fired.get(r.rule_id) ?? 0) + 1);
      if (r.status === "dismissed")
        falseAlarms.set(r.rule_id, (falseAlarms.get(r.rule_id) ?? 0) + 1);
    }
    return {
      version: MESSAGE_RULE_SET.version,
      categories: MESSAGE_CATEGORY_INFO,
      rules: MESSAGE_RULE_SET.rules.map(
        (rule): AdminMessageRule => ({
          ...rule,
          fired: fired.get(rule.id) ?? 0,
          falseAlarms: falseAlarms.get(rule.id) ?? 0,
        }),
      ),
      never: MESSAGE_RULE_SET.never,
      notCounted: MESSAGE_RULE_SET.notCounted,
      migrationPending: !!error,
    };
  });
