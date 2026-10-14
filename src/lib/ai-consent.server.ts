/**
 * Permission to use third-party AI (App Review 2026-10-12, Guidelines 5.1.1(i)
 * and 5.1.2(i)). The app names each AI provider and what it receives, and asks
 * once during setup; the answer lives in `ai_consents` (migration
 * 20261012160000).
 *
 * The API refuses every AI request from the app until the account has said
 * yes (`assertAiConsent`), so an old build without the screen can't skip it.
 * A voice note sent from the app without permission is never transcribed
 * (`sendMessage`). The web app doesn't ask yet and is unchanged.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { ApiError } from "./api/errors";
import { dbError } from "./db-error";
import { athleteVoiceAllowed } from "./minor-voice.server";

/**
 * Bump when the providers, or what they receive, change: every account is
 * then asked again. Keep the app's permission screen in step.
 */
export const CURRENT_AI_CONSENT_VERSION = "2026-10-12";

export type AiConsentState = "granted" | "declined" | "unasked";

export interface AiConsent {
  state: AiConsentState;
  version: string;
  decidedAt: string | null;
}

/** `ai_consents` isn't in the generated types until Lovable regenerates them. */
type Untyped = { from: (table: string) => any };
type Admin = SupabaseClient<Database>;

/** Postgres `undefined_table`, or PostgREST's schema-cache miss for a table that isn't there yet. */
function isMissingTable(error: { code?: string } | null | undefined): boolean {
  return error?.code === "42P01" || error?.code === "PGRST205";
}

/**
 * The account's answer for the current version. Before the migration is
 * applied nobody can have answered, so it reads as "unasked" (and the API
 * refuses AI requests from the app: fail closed).
 */
export async function getAiConsent(admin: Admin, userId: string): Promise<AiConsent> {
  const row = await (admin as unknown as Untyped)
    .from("ai_consents")
    .select("granted, version, decided_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (row.error && !isMissingTable(row.error)) dbError(row.error);
  const data = row.data as { granted: boolean; version: string; decided_at: string } | null;
  if (!data || data.version !== CURRENT_AI_CONSENT_VERSION) {
    return { state: "unasked", version: CURRENT_AI_CONSENT_VERSION, decidedAt: null };
  }
  return {
    state: data.granted ? "granted" : "declined",
    version: CURRENT_AI_CONSENT_VERSION,
    decidedAt: data.decided_at,
  };
}

/** Records the account's answer for the current version. Idempotent. */
export async function setAiConsent(
  admin: Admin,
  userId: string,
  granted: boolean,
): Promise<AiConsent> {
  if (granted) await assertNotMinor(admin, userId);
  const decidedAt = new Date().toISOString();
  const { error } = await (admin as unknown as Untyped).from("ai_consents").upsert(
    {
      user_id: userId,
      granted,
      version: CURRENT_AI_CONSENT_VERSION,
      decided_at: decidedAt,
    },
    { onConflict: "user_id" },
  );
  if (error && isMissingTable(error)) {
    throw new ApiError({
      code: "unavailable",
      status: 503,
      message: "Please try again in a moment.",
    });
  }
  if (error) dbError(error);
  return {
    state: granted ? "granted" : "declined",
    version: CURRENT_AI_CONSENT_VERSION,
    decidedAt,
  };
}

/** The refusal the app answers by showing the permission screen again. */
export function aiConsentRequired(): ApiError {
  return new ApiError({
    code: "ai_consent_required",
    status: 403,
    message: "Turn on AI features to use this.",
  });
}

/**
 * Athletes under 18, or with no birthdate on file, never get AI features
 * (the app never asks them): they can't allow it and every gate refuses them.
 * A login with no athlete row (coach, parent) passes.
 */
async function assertNotMinor(admin: Admin, userId: string): Promise<void> {
  if ((await athleteVoiceAllowed(admin, userId)) === false) {
    throw new ApiError({
      code: "ai_unavailable_for_minors",
      status: 403,
      message: "AI features aren't available for athletes under 18.",
    });
  }
}

/** Throws unless the account has allowed AI features and isn't an athlete under 18. */
export async function assertAiConsent(admin: Admin, userId: string): Promise<void> {
  const consent = await getAiConsent(admin, userId);
  if (consent.state !== "granted") throw aiConsentRequired();
  await assertNotMinor(admin, userId);
}

/**
 * Whether this sender's voice notes may be transcribed: not after they chose
 * "Not now" in the app. Someone never asked (a web-only account) is unchanged.
 * A failed read counts as no.
 */
export async function voiceTranscriptAllowed(admin: Admin, userId: string): Promise<boolean> {
  try {
    return (await getAiConsent(admin, userId)).state !== "declined";
  } catch {
    return false;
  }
}
