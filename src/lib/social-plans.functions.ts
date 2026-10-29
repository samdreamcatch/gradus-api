import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { generateObject } from "ai";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";
import { PROMPT_INJECTION_GUARD, sanitizeUserContent } from "./ai-prompt-safety";
import { dbError } from "./db-error";
import { isAdminSocialPlan } from "./social-plan-rules";
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

    const sport = sanitizeUserContent(data.sport, 60);
    const level = sanitizeUserContent(data.level, 80);
    const focus = sanitizeUserContent(data.focus, 200);

    const prompt = `${PROMPT_INJECTION_GUARD}

You are a ${sport} coach writing a short at-home practice plan that will be shared publicly on social media by Gradus.

Sport: ${sport}
Level: ${level || "general / all levels"}
Focus: ${focus || "well-rounded fundamentals"}

Write exactly ${data.moveCount} moves an athlete can do on their own, in order. For each move give:
- name: short, punchy (max 6 words)
- description: 1-2 sentences on how to do it
- cue: one short coaching cue an athlete can repeat to themselves
- why: one short sentence on why it matters
- targetKind: "reps" or "mins"
- targetValue: a realistic number

Also write a plan title (max 8 words, no emoji) and a 1-2 sentence intro note.
Be specific to ${sport}. Never invent medical claims.`;

    const schema = z.object({
      title: z.string().min(1).max(120),
      notes: z.string().max(600),
      moves: z.array(moveSchema).min(1).max(8),
    });

    try {
      const { object } = await generateObject({
        model: gateway("google/gemini-2.5-flash"),
        schema,
        prompt,
      });
      return object;
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

    const sport = sanitizeUserContent(data.sport, 60);
    const prompt = `${PROMPT_INJECTION_GUARD}

You are a ${sport} coach. Below is a competition result (judges' protocol, score sheet, or results text) — attached as a file and/or pasted. Write a practice plan that will be shared publicly by Gradus as an example of turning results into training.

Write exactly ${data.moveCount} practice moves that target exactly what the result shows lost points or value (e.g. negative GOE, underrotations, falls, low components, missed shots, slow splits). Do not invent problems the result does not show. Never include any athlete's name, club, or other identifying detail — refer to "the athlete".
For each move give:
- name: short and specific (max 6 words)
- description: 1-2 sentences on how to practise it
- cue: one short cue the athlete can repeat
- why: one sentence tying it to the result (name the element or component)
- targetKind: "reps" or "mins"
- targetValue: a realistic number

Also write a plan title (max 8 words, no emoji, no names) and a 1-2 sentence intro note summarising the takeaway.

Respond with ONLY a JSON object with EXACTLY these top-level keys:
- "title": string
- "notes": string
- "moves": array of objects, each with exactly "name", "description", "cue", "why" (strings), "targetKind" ("reps" or "mins"), "targetValue" (number)
${data.text.trim() ? `\nPasted result:\n${sanitizeUserContent(data.text, 12000)}` : ""}`;

    const lenientMove = z.object({
      name: z
        .string()
        .min(1)
        .transform((s) => s.slice(0, 120)),
      description: z
        .string()
        .default("")
        .transform((s) => s.slice(0, 600)),
      cue: z
        .string()
        .default("")
        .transform((s) => s.slice(0, 300)),
      why: z
        .string()
        .default("")
        .transform((s) => s.slice(0, 300)),
      targetKind: z.preprocess(
        (v) => (/^min/i.test(String(v ?? "")) ? "mins" : "reps"),
        z.enum(["reps", "mins"]),
      ),
      targetValue: z.preprocess((v) => {
        const n = Math.round(Number(v));
        return Number.isFinite(n) ? Math.min(600, Math.max(1, n)) : 10;
      }, z.number()),
    });
    const schema = z.object({
      title: z
        .string()
        .min(1)
        .transform((s) => s.slice(0, 120)),
      notes: z
        .string()
        .default("")
        .transform((s) => s.slice(0, 600)),
      moves: z
        .array(lenientMove)
        .min(1)
        .transform((a) => a.slice(0, 8)),
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
        schema,
        messages: [{ role: "user", content }],
      });
      return object;
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
    const plan = await socialClient(supabaseAdmin)
      .from("plans")
      .select(
        "id, title, notes, social_coach_name, kind, source, coach_id, athlete_id, share_token",
      )
      .eq("id", data.planId)
      .maybeSingle();
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
      coachName: plan.data.social_coach_name,
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
    if (error) dbError(error);
    return { ok: true };
  });
