// Public + admin server functions for error tracking.
//
// reportClientError is intentionally PUBLIC (no auth middleware) so that
// errors on unauthenticated pages, including auth/signup pages, can still
// report. The handler reads the bearer token best-effort to attribute the
// error to a user when one is signed in.

import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dbError } from "./db-error";

async function assertAdmin(context: { userId: string; supabase: any }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) dbError(error);
  if (!data) throw new Error("Forbidden");
}

/**
 * Normalize an error message so semantically-identical errors collapse into
 * one group: strip UUIDs, hex ids, decimals, URLs, quoted strings, and
 * whitespace. Keep it deterministic so hashing yields a stable signature.
 */
function normalizeErrorMessage(msg: string): string {
  return msg
    .replace(/https?:\/\/\S+/g, "<url>")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>")
    .replace(/\b[0-9a-f]{16,}\b/gi, "<hex>")
    .replace(/"[^"]{1,120}"/g, '"<str>"')
    .replace(/'[^']{1,120}'/g, "'<str>'")
    .replace(/\b\d+(?:\.\d+)?\b/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function signatureFor(source: string, normalized: string): string {
  return createHash("sha256").update(`${source}::${normalized}`).digest("hex").slice(0, 32);
}

const reportInput = z.object({
  message: z.string().min(1).max(4000),
  stack: z.string().max(16000).optional().nullable(),
  route: z.string().max(1000).optional().nullable(),
  userAgent: z.string().max(1000).optional().nullable(),
  metadata: z.record(z.unknown()).optional(),
});

export const reportClientError = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => reportInput.parse(input))
  .handler(async ({ data }) => {
    // Best-effort: resolve the user from the Authorization header if present.
    let userId: string | null = null;
    try {
      const auth = getRequestHeader("authorization");
      if (auth?.startsWith("Bearer ")) {
        const token = auth.slice("Bearer ".length);
        const { createClient } = await import("@supabase/supabase-js");
        const supabaseUrl = process.env.SUPABASE_URL ?? import.meta.env.VITE_SUPABASE_URL;
        const publishable =
          process.env.SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        if (supabaseUrl && publishable) {
          const client = createClient(supabaseUrl, publishable, {
            auth: { persistSession: false, autoRefreshToken: false },
            global: { headers: { Authorization: `Bearer ${token}` } },
          });
          const { data: u } = await client.auth.getUser();
          userId = u?.user?.id ?? null;
        }
      }
    } catch {
      // best-effort only
    }

    let environment: "production" | "preview" = "production";
    try {
      const host = getRequestHeader("host") ?? "";
      if (host.includes("id-preview") || host.includes("-dev.lovable.app")) {
        environment = "preview";
      }
    } catch {
      // best-effort
    }

    const { logError } = await import("./error-tracking.server");
    await logError({
      source: "client",
      message: data.message,
      stack: data.stack ?? null,
      route: data.route ?? null,
      userId,
      userAgent: data.userAgent ?? null,
      metadata: data.metadata,
      environment,
    });
    return { ok: true };
  });

export const listAdminErrors = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        limit: z.number().int().min(1).max(500).optional().default(200),
        includeTest: z.boolean().optional().default(false),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: rows, error } = await supabaseAdmin
      .from("client_errors")
      .select("id,source,message,route,user_id,user_email,user_role,user_name,created_at")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (error) dbError(error);

    if (data.includeTest || !rows?.length) {
      return { items: rows ?? [] };
    }

    // Filter test users (best-effort) by looking up is_test flags.
    const userIds = Array.from(
      new Set(rows.map((r: any) => r.user_id).filter(Boolean)),
    ) as string[];
    if (!userIds.length) return { items: rows };

    const [coaches, parents] = await Promise.all([
      supabaseAdmin
        .from("coach_profiles")
        .select("user_id")
        .in("user_id", userIds)
        .eq("is_test", true),
      supabaseAdmin
        .from("parent_profiles")
        .select("user_id")
        .in("user_id", userIds)
        .eq("is_test", true),
    ]);
    const testIds = new Set<string>([
      ...(coaches.data ?? []).map((r: any) => r.user_id),
      ...(parents.data ?? []).map((r: any) => r.user_id),
    ]);

    return {
      items: rows.filter((r: any) => !r.user_id || !testIds.has(r.user_id)),
    };
  });

export const getAdminError = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("client_errors")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) dbError(error);
    return { error: row };
  });

/**
 * List errors grouped by (source + normalized message). Newest occurrence first.
 * Filters out test-user occurrences unless includeTest is set.
 */
export const listAdminErrorGroups = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        limit: z.number().int().min(50).max(2000).optional().default(1000),
        includeTest: z.boolean().optional().default(false),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: rows, error } = await supabaseAdmin
      .from("client_errors")
      .select("id,source,message,route,user_id,user_email,user_name,user_role,created_at")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (error) dbError(error);

    let filtered = rows ?? [];
    if (!data.includeTest && filtered.length) {
      const userIds = Array.from(
        new Set(filtered.map((r: any) => r.user_id).filter(Boolean)),
      ) as string[];
      if (userIds.length) {
        const [coaches, parents] = await Promise.all([
          supabaseAdmin
            .from("coach_profiles")
            .select("user_id")
            .in("user_id", userIds)
            .eq("is_test", true),
          supabaseAdmin
            .from("parent_profiles")
            .select("user_id")
            .in("user_id", userIds)
            .eq("is_test", true),
        ]);
        const testIds = new Set<string>([
          ...(coaches.data ?? []).map((r: any) => r.user_id),
          ...(parents.data ?? []).map((r: any) => r.user_id),
        ]);
        filtered = filtered.filter((r: any) => !r.user_id || !testIds.has(r.user_id));
      }
    }

    type UserRef = {
      userId: string;
      name: string | null;
      email: string | null;
      role: string | null;
      count: number;
      lastSeen: string;
    };
    type Group = {
      signature: string;
      source: string;
      sampleMessage: string;
      count: number;
      lastSeen: string;
      firstSeen: string;
      routes: Set<string>;
      users: Map<string, UserRef>;
      anonCount: number;
      latestId: string;
    };

    const groups = new Map<string, Group>();
    for (const r of filtered as any[]) {
      const normalized = normalizeErrorMessage(r.message ?? "");
      const sig = signatureFor(r.source ?? "unknown", normalized);
      let g = groups.get(sig);
      if (!g) {
        g = {
          signature: sig,
          source: r.source ?? "unknown",
          sampleMessage: r.message ?? "",
          count: 0,
          lastSeen: r.created_at,
          firstSeen: r.created_at,
          routes: new Set(),
          users: new Map(),
          anonCount: 0,
          latestId: r.id,
        };
        groups.set(sig, g);
      }
      g.count += 1;
      if (r.created_at > g.lastSeen) {
        g.lastSeen = r.created_at;
        g.latestId = r.id;
        g.sampleMessage = r.message ?? g.sampleMessage;
      }
      if (r.created_at < g.firstSeen) g.firstSeen = r.created_at;
      if (r.route) g.routes.add(r.route);
      if (r.user_id) {
        const existing = g.users.get(r.user_id);
        if (existing) {
          existing.count += 1;
          if (r.created_at > existing.lastSeen) existing.lastSeen = r.created_at;
          if (!existing.name && r.user_name) existing.name = r.user_name;
          if (!existing.email && r.user_email) existing.email = r.user_email;
          if (!existing.role && r.user_role) existing.role = r.user_role;
        } else {
          g.users.set(r.user_id, {
            userId: r.user_id,
            name: r.user_name ?? null,
            email: r.user_email ?? null,
            role: r.user_role ?? null,
            count: 1,
            lastSeen: r.created_at,
          });
        }
      } else {
        g.anonCount += 1;
      }
    }

    // Fetch cached explanations for all signatures present.
    const sigs = Array.from(groups.keys());
    const explanations = new Map<string, string>();
    if (sigs.length) {
      const { data: cached } = await supabaseAdmin
        .from("error_group_explanations")
        .select("signature, explanation")
        .in("signature", sigs);
      for (const c of cached ?? []) explanations.set(c.signature, c.explanation);
    }

    const items = Array.from(groups.values())
      .map((g) => ({
        signature: g.signature,
        source: g.source,
        sampleMessage: g.sampleMessage,
        count: g.count,
        uniqueUsers: g.users.size,
        anonCount: g.anonCount,
        users: Array.from(g.users.values()).sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : -1)),
        lastSeen: g.lastSeen,
        firstSeen: g.firstSeen,
        routes: Array.from(g.routes).slice(0, 5),
        latestId: g.latestId,
        explanation: explanations.get(g.signature) ?? null,
      }))
      .sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : -1));

    return { groups: items, totalOccurrences: filtered.length };
  });

/**
 * Generate (or return cached) a plain-English AI explanation for one error group.
 * On-demand: only runs when an admin clicks "Explain" in the UI.
 */
export const explainErrorGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        signature: z.string().min(8).max(64),
        force: z.boolean().optional().default(false),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (!data.force) {
      const { data: existing } = await supabaseAdmin
        .from("error_group_explanations")
        .select("explanation, updated_at, model")
        .eq("signature", data.signature)
        .maybeSingle();
      if (existing)
        return { explanation: existing.explanation, cached: true, model: existing.model };
    }

    // Pull up to 3 recent samples that hash to this signature so the model
    // sees real messages + stack + route context.
    const { data: recent } = await supabaseAdmin
      .from("client_errors")
      .select("source, message, stack, route, created_at")
      .order("created_at", { ascending: false })
      .limit(500);
    const samples = (recent ?? [])
      .filter(
        (r: any) =>
          signatureFor(r.source ?? "unknown", normalizeErrorMessage(r.message ?? "")) ===
          data.signature,
      )
      .slice(0, 3);

    if (samples.length === 0) {
      throw new Error("No occurrences found for this signature.");
    }

    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");

    const { createLovableAiGatewayProvider } = await import("./ai-gateway.server");
    const { generateText } = await import("ai");
    const gateway = createLovableAiGatewayProvider(key);
    const model = "google/gemini-2.5-flash";

    const prompt = [
      "You are helping the Gradus engineering team triage errors from their web app.",
      "Below are one to three occurrences of the SAME error (grouped by normalized message).",
      "In 3-6 short sentences, explain in plain English:",
      "  1) What this error most likely means.",
      "  2) The most likely root cause given the message/stack/route.",
      "  3) A concrete first thing to check or fix.",
      "Be concrete and technical but avoid jargon dumps. No headings, no lists — just prose.",
      "",
      ...samples.map((s: any, i: number) =>
        [
          `--- Occurrence ${i + 1} (${s.source}, route: ${s.route ?? "n/a"}) ---`,
          `Message: ${s.message}`,
          s.stack ? `Stack (truncated):\n${String(s.stack).slice(0, 1200)}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      ),
    ].join("\n");

    let explanation: string;
    try {
      const res = await generateText({ model: gateway(model), prompt });
      explanation = (res.text ?? "").trim();
    } catch (err: any) {
      const msg = String(err?.message ?? err);
      if (msg.includes("429")) throw new Error("AI rate limit hit. Try again in a moment.");
      if (msg.includes("402"))
        throw new Error("AI credits exhausted. Add credits in workspace billing.");
      throw new Error("AI explainer failed. Try again.");
    }
    if (!explanation) throw new Error("AI returned an empty explanation.");

    await supabaseAdmin.from("error_group_explanations").upsert(
      {
        signature: data.signature,
        sample_message: samples[0]!.message ?? "",
        explanation,
        model,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "signature" },
    );

    return { explanation, cached: false, model };
  });
