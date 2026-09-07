import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { generateText } from "ai";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";
import { canAskGradus } from "./athlete-age";
import { getSport } from "./coach-sports";

const input = z.object({
  sport: z.string().min(1).max(64),
  question: z.string().trim().min(2).max(2000),
  audience: z.enum(["parent", "athlete"]).default("parent"),
});

type Admin = typeof supabaseAdmin;
type TrustedAudience = "parent" | "athlete";

/**
 * The persona a caller is actually allowed to reach, resolved server-side
 * from their own athlete profile — never from the client-supplied
 * `audience` field. Ask Gradus is refused outright (thrown, not
 * re-persona'd) for a confirmed-or-unconfirmed-age minor athlete.
 */
export async function resolveAskGradusAudience(
  userId: string,
  admin: Pick<Admin, "from">,
): Promise<TrustedAudience> {
  const { data: athlete, error } = await admin
    .from("athletes")
    .select("id, birthdate")
    .eq("user_id", userId)
    .maybeSingle();

  // Fail closed: a lookup error (e.g. PGRST116 from `.maybeSingle()` when more
  // than one athletes row matches this user) must never be treated as "no
  // athletes row" — that would silently resolve to the parent persona for an
  // account we couldn't actually verify.
  if (error) throw new Error("Ask Gradus isn't available for this account.");
  if (!athlete) return "parent";
  if (canAskGradus(athlete.birthdate)) return "athlete";
  throw new Error("Ask Gradus isn't available for this account.");
}

export const askGradus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => input.parse(data))
  .handler(async ({ data, context }): Promise<{ answer: string }> => {
    const audience = await resolveAskGradusAudience(context.userId, supabaseAdmin);

    const key = process.env.LOVABLE_API_KEY;
    if (!key) {
      console.error("[ask-gradus] LOVABLE_API_KEY not set");
      throw new Error("AI service is unavailable. Please try again later.");
    }

    const sportLabel = getSport(data.sport)?.label ?? data.sport;
    const gateway = createLovableAiGatewayProvider(key);
    const model = gateway("google/gemini-3-flash-preview");

    const system =
      audience === "athlete"
        ? `You are Gradus, an experienced ${sportLabel} coach speaking directly to a young athlete (roughly ages 10–18). ` +
          `Talk to them, not about them — use "you" and "your". Never address a parent or refer to "your child." ` +
          `Be encouraging, age-appropriate, and concrete: give cues, drills, and what to focus on in practice. ` +
          `Keep language plain and direct, short paragraphs, no jargon without a quick explanation. ` +
          `Use markdown (bold, bullets) when it helps clarity. ` +
          `Prioritize safety — if a question involves pain, injury, weight/food, or anything unsafe, tell them to talk to a trusted adult or coach. ` +
          `If the question is outside ${sportLabel}, politely redirect.`
        : `You are Gradus, an experienced ${sportLabel} coach speaking to a parent of a developing athlete. ` +
          `Give concise, practical answers grounded in real ${sportLabel} coaching. ` +
          `Use plain language and short paragraphs. Use markdown for structure (bold, bullets) when it helps. ` +
          `If a question is outside ${sportLabel}, politely redirect.`;

    const { text } = await generateText({
      model,
      system,
      prompt: data.question,
    });

    return { answer: text };
  });
