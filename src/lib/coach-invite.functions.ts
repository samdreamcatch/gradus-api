import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { dbError } from "./db-error";

type Client = SupabaseClient<Database>;

// Crockford-style base32, minus I, L, O, 0, 1 to avoid lookalikes.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;
const MAX_ATTEMPTS = 12;

function generateCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

async function ensureCoachId(supabase: Client, userId: string): Promise<string> {
  const existing = await supabase
    .from("coach_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (existing.error) dbError(existing.error);
  if (existing.data) return existing.data.id;

  const created = await supabase
    .from("coach_profiles")
    .insert({ user_id: userId })
    .select("id")
    .single();
  if (created.error) dbError(created.error);
  return created.data.id;
}

async function insertUniqueCode(supabase: Client, coachId: string): Promise<string> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const code = generateCode();
    const { error } = await supabase.from("coach_invite_codes").insert({ coach_id: coachId, code });
    if (!error) return code;
    // 23505 = unique_violation — collision on either coach_id or code.
    // If it's the coach_id, fall through; the caller re-reads.
    if (error.code !== "23505") dbError(error);
    const existing = await supabase
      .from("coach_invite_codes")
      .select("code")
      .eq("coach_id", coachId)
      .maybeSingle();
    if (existing.data) return existing.data.code;
    // Otherwise it was a code collision — retry.
  }
  throw new Error("Could not generate a unique invite code");
}

async function updateUniqueCode(supabase: Client, coachId: string): Promise<string> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const code = generateCode();
    const { error } = await supabase
      .from("coach_invite_codes")
      .update({ code })
      .eq("coach_id", coachId);
    if (!error) return code;
    if (error.code !== "23505") dbError(error);
    // code collision — retry
  }
  throw new Error("Could not generate a unique invite code");
}

export const getCoachInviteCode = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const supabase = context.supabase as Client;
    const coachId = await ensureCoachId(supabase, context.userId);

    const existing = await supabase
      .from("coach_invite_codes")
      .select("code")
      .eq("coach_id", coachId)
      .maybeSingle();
    if (existing.error) dbError(existing.error);
    if (existing.data) return { code: existing.data.code };

    const code = await insertUniqueCode(supabase, coachId);
    return { code };
  });

export const rotateCoachInviteCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const supabase = context.supabase as Client;
    const coachId = await ensureCoachId(supabase, context.userId);

    // Ensure a row exists first so UPDATE has something to hit.
    const existing = await supabase
      .from("coach_invite_codes")
      .select("id")
      .eq("coach_id", coachId)
      .maybeSingle();
    if (existing.error) dbError(existing.error);
    if (!existing.data) {
      const code = await insertUniqueCode(supabase, coachId);
      return { code };
    }

    const code = await updateUniqueCode(supabase, coachId);
    return { code };
  });
