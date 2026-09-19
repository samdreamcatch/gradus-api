import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

/**
 * `structuredOutputs` makes the provider send a real `json_schema` response
 * format, so the model is *required* to answer in our shape instead of merely
 * being asked to. Callers that need a guaranteed shape (voice slotting) opt in;
 * free-text callers leave it off.
 */
export function createLovableAiGatewayProvider(
  lovableApiKey: string,
  opts?: { structuredOutputs?: boolean },
) {
  return createOpenAICompatible({
    name: "lovable",
    baseURL: "https://ai.gateway.lovable.dev/v1",
    headers: {
      "Lovable-API-Key": lovableApiKey,
      "X-Lovable-AIG-SDK": "vercel-ai-sdk",
    },
    ...(opts?.structuredOutputs ? { supportsStructuredOutputs: true } : {}),
  });
}
