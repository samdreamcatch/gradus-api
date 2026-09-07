/**
 * Ask Gradus (PRD §7.9 "Resources and Ask Gradus"): a one-off question to
 * an LLM, answered as a sport-specific coach speaking to a parent or an
 * athlete. Single source of truth for ask-gradus.functions.ts and
 * `POST /api/v1/ask`. Extracted without behavior changes; the missing-key
 * message is kept verbatim on `ApiError` as the new `ai_unavailable` code
 * (PRD §5.1).
 *
 * The actual model call is behind an injectable `ask` parameter, defaulting
 * to the real Lovable AI gateway call — the same technique other extracted
 * modules use to isolate a side effect for tests (there is no way to
 * exercise `generateText` against a real network call in unit tests).
 *
 * The `ask(...)` call itself is wrapped in try/catch and mapped to the same
 * `ai_unavailable` 503 as the missing-key precondition, matching the
 * established convention of every other AI-gateway-calling server module
 * (`pre-lesson-briefing.server.ts`, `coach-athlete-detail.server.ts`,
 * `plan-sessions.server.ts`) — a network error, gateway 5xx, or rate limit
 * becomes a coded, user-safe, retryable error instead of a raw exception.
 * This is a deliberate (small) behavior change from the pre-extraction web
 * handler, which let such an error propagate raw: `POST /api/v1/ask` is a
 * brand-new endpoint with no prior behavior to preserve, and it needs this
 * mapping so the iOS client gets a specific, coded error instead of a
 * generic 500.
 */
import { z } from "zod";
import { generateText } from "ai";
import { ApiError } from "./api/errors";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";
import { getSport } from "./coach-sports";

export const askGradusInput = z.object({
  sport: z.string().min(1).max(64),
  question: z.string().trim().min(2).max(2000),
  audience: z.enum(["parent", "athlete"]).default("parent"),
});

export type AskGradusInput = z.infer<typeof askGradusInput>;

export type AskFn = (args: { model: unknown; system: string; prompt: string }) => Promise<{
  text: string;
}>;

async function defaultAsk(args: { model: unknown; system: string; prompt: string }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return generateText(args as any);
}

export async function askGradus(
  data: AskGradusInput,
  ask: AskFn = defaultAsk,
): Promise<{ answer: string }> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) {
    console.error("[ask-gradus] LOVABLE_API_KEY not set");
    throw new ApiError({
      code: "ai_unavailable",
      status: 503,
      message: "AI service is unavailable. Please try again later.",
    });
  }

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

  let text: string;
  try {
    ({ text } = await ask({ model, system, prompt: data.question }));
  } catch (err) {
    console.error("[ask-gradus] AI gateway error", err);
    throw new ApiError({
      code: "ai_unavailable",
      status: 503,
      message: "AI service is unavailable. Please try again later.",
    });
  }

  return { answer: text };
}
