import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { generateText } from "ai";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";
import { getSport } from "./coach-sports";

const input = z.object({
  sport: z.string().min(1).max(64),
  question: z.string().trim().min(2).max(2000),
  audience: z.enum(["parent", "athlete"]).default("parent"),
});

export const askGradus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => input.parse(data))
  .handler(async ({ data }): Promise<{ answer: string }> => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");

    const sportLabel = getSport(data.sport)?.label ?? data.sport;
    const gateway = createLovableAiGatewayProvider(key);
    const model = gateway("google/gemini-3-flash-preview");

    const system =
      data.audience === "athlete"
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
