import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { generateObject } from "ai";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";
import { dbError } from "./db-error";
import { isAdminSocialPlan } from "./social-plan-rules";
import { checkPlanStyle } from "./plan-writing-style";
import { planDraftPrompt, planImprovePrompt } from "./plan-draft-prompt";
import { applyLibrary, type LibraryMove } from "./plan-draft-library";
import { sportDisplayLabel } from "./coach-sports";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";

// Draft-local schema extension; generated database types remain untouched.
type SocialDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables" | "Functions"> & {
    Tables: Omit<Database["public"]["Tables"], "plans"> & {
      plans: Omit<Database["public"]["Tables"]["plans"], "Row" | "Insert" | "Update"> & {
        Row: Database["public"]["Tables"]["plans"]["Row"] & { social_coach_name: string };
        Insert: Database["public"]["Tables"]["plans"]["Insert"] & { social_coach_name?: string };
        Update: Database["public"]["Tables"]["plans"]["Update"] & { social_coach_name?: string };
      };
    };
    Functions: Database["public"]["Functions"] & {
      admin_update_social_plan: {
        Args: {
          _plan_id: string;
          _title: string;
          _notes: string;
          _coach_name: string;
          _moves: Json;
        };
        Returns: undefined;
      };
    };
  };
};
const socialClient = (client: unknown) => client as SupabaseClient<SocialDatabase>;

/**
 * Logs the fields of a draft that use banned jargon, so a draft that slips
 * shows up in the server log next to its prompt's name. The draft is
 * returned as is: the admin edits it before it is published.
 */
function warnOnStyle(
  where: string,
  plan: {
    title: string;
    notes: string;
    moves: { name: string; description: string; cue: string; why: string }[];
  },
) {
  const violations = checkPlanStyle(plan);
  if (violations.length) {
    console.warn(
      `[social-plans ${where}] draft uses jargon`,
      violations.map((v) => `${v.field}: ${v.problem}`).join("; "),
    );
  }
}

/**
 * The sport's Gradus library (`seed_moves`, the curriculum every coach's
 * library is seeded from). Best effort: a failed read drafts without it. The
 * count is logged every time, so a sport that silently matches no rows (a
 * key that drifted from the seed data) shows up next to its draft.
 */
async function loadLibrary(supabase: any, sportKey: string): Promise<LibraryMove[]> {
  try {
    const { data, error } = await supabase
      .from("seed_moves")
      .select("name, category, description, cue, why, default_target_kind, default_target_value")
      .eq("sport", sportKey)
      .limit(500);
    if (error) {
      console.error("[social-plans] seed_moves read failed", error.message);
      return [];
    }
    console.info(`[social-plans] library ${sportKey}: ${(data ?? []).length} moves`);
    return (data ?? []).map((r: any) => ({
      name: String(r.name ?? ""),
      category: String(r.category ?? ""),
      description: String(r.description ?? ""),
      cue: String(r.cue ?? ""),
      why: String(r.why ?? ""),
      defaultTargetKind: /^min/i.test(String(r.default_target_kind ?? "")) ? "mins" : "reps",
      defaultTargetValue: Number(r.default_target_value) > 0 ? Number(r.default_target_value) : 10,
    }));
  } catch (err) {
    console.error("[social-plans] seed_moves read failed", err);
    return [];
  }
}

const clip = (n: number) =>
  z
    .string()
    .default("")
    .transform((s) => s.slice(0, n));

/** A move as the model returns it: lenient on shape, a library name when it matched, no target when the source gave none. */
const draftedMoveSchema = z.object({
  libraryName: z.preprocess((v) => (typeof v === "string" ? v : null), z.string().nullable()),
  name: z
    .string()
    .min(1)
    .transform((s) => s.slice(0, 120)),
  description: clip(600),
  cue: clip(300),
  why: clip(300),
  targetKind: z.preprocess(
    (v) => (/^min/i.test(String(v ?? "")) ? "mins" : "reps"),
    z.enum(["reps", "mins"]),
  ),
  targetValue: z.preprocess((v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n > 0 ? Math.min(600, n) : null;
  }, z.number().nullable()),
});

const draftedPlanSchema = z.object({
  title: z
    .string()
    .min(1)
    .transform((s) => s.slice(0, 120)),
  notes: clip(600),
  // No minimum: a source with no drills in it (a "next time" note, an unreadable
  // photo) comes back as a title and a note, not as a failed read.
  moves: z.array(draftedMoveSchema).transform((a) => a.slice(0, 8)),
});

/** Throws if the caller is not an admin. */
async function assertAdmin(context: { userId: string; supabase: any }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) dbError(error);
  if (!data) throw new Error("Forbidden");
}

const moveSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(600).default(""),
  cue: z.string().max(300).default(""),
  why: z.string().max(300).default(""),
  targetKind: z.enum(["reps", "mins"]),
  targetValue: z.number().min(1).max(600),
});

export type SocialPlanMoveInput = z.infer<typeof moveSchema>;

export interface SocialPlanRow {
  id: string;
  title: string;
  notes: string;
  moveCount: number;
  shareToken: string | null;
  createdAt: string;
}

/** AI first draft of a shareable plan for any sport. */
export const adminDraftSocialPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        sport: z.string().min(1).max(60),
        level: z.string().max(80).optional().default(""),
        focus: z.string().max(200).optional().default(""),
        moveCount: z.number().int().min(2).max(8).default(4),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    await assertAdmin(context);
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("AI service is unavailable. Please try again later.");
    const gateway = createLovableAiGatewayProvider(apiKey);

    const library = await loadLibrary(context.supabase, data.sport);
    const prompt = planDraftPrompt({
      sportLabel: sportDisplayLabel(data.sport),
      library,
      source: { kind: "brief", level: data.level, focus: data.focus, moveCount: data.moveCount },
    });

    try {
      const { object } = await generateObject({
        model: gateway("google/gemini-2.5-flash"),
        schema: draftedPlanSchema,
        prompt,
      });
      const plan = {
        title: object.title,
        notes: object.notes,
        moves: applyLibrary(object.moves, library),
      };
      warnOnStyle("draft", plan);
      return plan;
    } catch (err) {
      console.error("[social-plans draft]", err);
      throw new Error("Could not draft the plan. Please try again.");
    }
  });

const RESULT_FILE_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;

/** AI first draft of a shareable plan from a competition result (image, PDF, or pasted text). */
export const adminDraftSocialPlanFromResult = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        sport: z.string().min(1).max(60),
        text: z.string().max(20000).optional().default(""),
        fileDataUrl: z
          .string()
          .max(14_000_000)
          .refine((v) => v.startsWith("data:"), "Upload an image or PDF")
          .optional(),
        moveCount: z.number().int().min(2).max(8).default(4),
      })
      .refine((v) => v.text.trim() || v.fileDataUrl, "Add a result file or paste the result text")
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    await assertAdmin(context);
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("AI service is unavailable. Please try again later.");
    const gateway = createLovableAiGatewayProvider(apiKey);

    let file: { bytes: Uint8Array; mediaType: string } | null = null;
    if (data.fileDataUrl) {
      const m = /^data:([^;,]+);base64,(.*)$/s.exec(data.fileDataUrl);
      const mediaType = m?.[1]?.toLowerCase() ?? "";
      if (!m || !(RESULT_FILE_TYPES as readonly string[]).includes(mediaType)) {
        throw new Error("Upload a JPG, PNG, WebP, or PDF.");
      }
      const encoded = m[2];
      if (!encoded) throw new Error("Upload a valid image or PDF.");
      file = { bytes: Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)), mediaType };
    }

    const library = await loadLibrary(context.supabase, data.sport);
    const prompt = planDraftPrompt({
      sportLabel: sportDisplayLabel(data.sport),
      library,
      source: { kind: "source", pastedText: data.text, maxMoves: data.moveCount },
    });

    const content: any[] = [{ type: "text", text: prompt }];
    if (file) {
      content.push(
        file.mediaType === "application/pdf"
          ? { type: "file", data: file.bytes, mediaType: file.mediaType }
          : { type: "image", image: file.bytes, mediaType: file.mediaType },
      );
    }

    try {
      const { object } = await generateObject({
        model: gateway("google/gemini-3.8-flash"),
        schema: draftedPlanSchema,
        messages: [{ role: "user", content }],
      });
      const plan = {
        title: object.title,
        notes: object.notes,
        moves: applyLibrary(object.moves, library),
      };
      warnOnStyle("source draft", plan);
      return plan;
    } catch (err) {
      console.error("[social-plans result draft]", err);
      throw new Error("Could not read that result. Try a clearer image or paste the text.");
    }
  });

/** Create a shareable Gradus plan (not assigned to any athlete) and mint its share link. */
export const adminCreateSocialPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        title: z.string().min(1).max(140),
        notes: z.string().max(1000).default(""),
        coachName: z.string().max(120).default(""),
        moves: z.array(moveSchema).min(1).max(12),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const buf = new Uint8Array(12);
    crypto.getRandomValues(buf);
    const token = Array.from(buf, (b) => b.toString(36).padStart(2, "0")).join("");

    const ins = await socialClient(supabaseAdmin)
      .from("plans")
      .insert({
        kind: "template",
        source: "gradus",
        status: "draft",
        coach_id: null,
        athlete_id: null,
        title: data.title.trim(),
        notes: data.notes.trim(),
        social_coach_name: data.coachName.trim(),
        share_token: token,
        shared_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (ins.error) dbError(ins.error);

    if (!ins.data) throw new Error("Could not create the plan.");
    const planId = ins.data.id;
    const rows = data.moves.map((m, i) => ({
      plan_id: planId,
      position: i + 1,
      name: m.name.trim(),
      description: m.description.trim(),
      cue: m.cue.trim(),
      why: m.why.trim(),
      target_kind: m.targetKind,
      target_value: m.targetValue,
    }));
    const mv = await supabaseAdmin.from("plan_moves").insert(rows);
    if (mv.error) {
      await supabaseAdmin.from("plans").delete().eq("id", planId);
      dbError(mv.error);
    }

    return { planId, token };
  });

/** List the shareable social plans created from the admin panel. */
export const adminListSocialPlans = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ plans: SocialPlanRow[] }> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const res = await supabaseAdmin
      .from("plans")
      .select("id, title, notes, share_token, created_at")
      .eq("kind", "template")
      .eq("source", "gradus")
      .is("coach_id", null)
      .not("share_token", "is", null)
      .order("created_at", { ascending: false })
      .limit(100);
    if (res.error) dbError(res.error);

    const plans = res.data ?? [];
    const ids = plans.map((p) => p.id);
    const counts = new Map<string, number>();
    if (ids.length) {
      const mv = await supabaseAdmin.from("plan_moves").select("plan_id").in("plan_id", ids);
      if (mv.error) dbError(mv.error);
      for (const row of mv.data ?? []) {
        counts.set(row.plan_id, (counts.get(row.plan_id) ?? 0) + 1);
      }
    }

    return {
      plans: plans.map((p) => ({
        id: p.id,
        title: p.title || "Untitled plan",
        notes: p.notes ?? "",
        moveCount: counts.get(p.id) ?? 0,
        shareToken: p.share_token,
        createdAt: p.created_at,
      })),
    };
  });

/** Delete a shareable social plan. */
export const adminDeleteSocialPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ planId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const plan = await supabaseAdmin
      .from("plans")
      .select("id, kind, source, coach_id, athlete_id, share_token")
      .eq("id", data.planId)
      .maybeSingle();
    if (plan.error) dbError(plan.error);
    if (!plan.data) throw new Error("Plan not found.");
    if (!isAdminSocialPlan(plan.data)) {
      throw new Error("Only admin-created social plans can be deleted here.");
    }

    await supabaseAdmin.from("plan_moves").delete().eq("plan_id", data.planId);
    const del = await supabaseAdmin.from("plans").delete().eq("id", data.planId);
    if (del.error) dbError(del.error);
    return { ok: true };
  });

export const adminGetSocialPlan = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ planId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const baseCols = "id, title, notes, kind, source, coach_id, athlete_id, share_token";
    let plan = await socialClient(supabaseAdmin)
      .from("plans")
      .select(`${baseCols}, social_coach_name`)
      .eq("id", data.planId)
      .maybeSingle();
    // Coach-name column may not exist until the staged update is applied.
    if (plan.error?.code === "42703") {
      const fallback = await supabaseAdmin
        .from("plans")
        .select(baseCols)
        .eq("id", data.planId)
        .maybeSingle();
      plan = {
        ...fallback,
        data: fallback.data ? { ...fallback.data, social_coach_name: "" } : null,
      } as typeof plan;
    }
    if (plan.error) dbError(plan.error);
    if (!plan.data || !isAdminSocialPlan(plan.data)) throw new Error("Plan not found.");
    const moves = await supabaseAdmin
      .from("plan_moves")
      .select("name, description, cue, why, target_kind, target_value")
      .eq("plan_id", data.planId)
      .order("position");
    if (moves.error) dbError(moves.error);
    return {
      title: plan.data.title,
      notes: plan.data.notes,
      coachName: plan.data.social_coach_name ?? "",
      token: plan.data.share_token,
      moves: (moves.data ?? []).map((m) =>
        moveSchema.parse({
          name: m.name,
          description: m.description ?? "",
          cue: m.cue ?? "",
          why: m.why ?? "",
          targetKind: m.target_kind,
          targetValue: m.target_value,
        }),
      ),
    };
  });

export const adminUpdateSocialPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        planId: z.string().uuid(),
        title: z.string().trim().min(1).max(140),
        notes: z.string().max(1000),
        coachName: z.string().trim().max(120),
        moves: z.array(moveSchema).min(1).max(12),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    await assertAdmin(context);
    const { error } = await socialClient(context.supabase).rpc("admin_update_social_plan", {
      _plan_id: data.planId,
      _title: data.title,
      _notes: data.notes,
      _coach_name: data.coachName,
      _moves: data.moves,
    });
    if (!error) return { ok: true };
    // The staged update function may not exist yet; save directly instead.
    if (error.code !== "PGRST202") dbError(error);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const existing = await supabaseAdmin
      .from("plans")
      .select("id, kind, source, coach_id, athlete_id, share_token")
      .eq("id", data.planId)
      .maybeSingle();
    if (existing.error) dbError(existing.error);
    if (!existing.data || !isAdminSocialPlan(existing.data)) throw new Error("Plan not found.");
    const upd = await supabaseAdmin
      .from("plans")
      .update({ title: data.title.trim(), notes: data.notes.trim() })
      .eq("id", data.planId);
    if (upd.error) dbError(upd.error);
    // Best effort: only succeeds once the coach-name column exists.
    await socialClient(supabaseAdmin)
      .from("plans")
      .update({ social_coach_name: data.coachName.trim() })
      .eq("id", data.planId);
    const del = await supabaseAdmin.from("plan_moves").delete().eq("plan_id", data.planId);
    if (del.error) dbError(del.error);
    const ins = await supabaseAdmin.from("plan_moves").insert(
      data.moves.map((m, i) => ({
        plan_id: data.planId,
        position: i + 1,
        name: m.name.trim(),
        description: m.description.trim(),
        cue: m.cue.trim(),
        why: m.why.trim(),
        target_kind: m.targetKind,
        target_value: m.targetValue,
      })),
    );
    if (ins.error) dbError(ins.error);
    return { ok: true };
  });

/** AI rewrite of every move in a social plan, following an admin prompt. */
export const adminImproveSocialPlanMoves = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        sport: z.string().min(1).max(60),
        level: z.string().max(60).default(""),
        title: z.string().max(140).default(""),
        notes: z.string().max(1000).default(""),
        prompt: z.string().trim().min(1).max(1000),
        moves: z.array(moveSchema).min(1).max(12),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    await assertAdmin(context);
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("AI service is unavailable. Please try again later.");
    const gateway = createLovableAiGatewayProvider(apiKey);
    // The draft move shape without the library match, and a target that is
    // always a number: an improve starts from moves that already have one.
    const improvedMoveSchema = draftedMoveSchema.omit({ libraryName: true }).extend({
      targetValue: z.preprocess((v) => {
        const n = Math.round(Number(v));
        return Number.isFinite(n) ? Math.min(600, Math.max(1, n)) : 10;
      }, z.number()),
    });
    const schema = z.object({
      moves: z
        .array(improvedMoveSchema)
        .min(1)
        .transform((a) => a.slice(0, 12)),
    });
    const prompt = planImprovePrompt({
      sportLabel: sportDisplayLabel(data.sport),
      library: await loadLibrary(context.supabase, data.sport),
      level: data.level,
      title: data.title,
      notes: data.notes,
      instruction: data.prompt,
      moves: data.moves,
    });
    try {
      const { object } = await generateObject({
        model: gateway("google/gemini-3.8-flash"),
        schema,
        prompt,
      });
      warnOnStyle("improve", { title: "", notes: "", moves: object.moves });
      return { moves: object.moves as SocialPlanMoveInput[] };
    } catch (err) {
      console.error("[social-plans improve]", err);
      throw new Error("Could not improve the moves. Please try again.");
    }
  });
