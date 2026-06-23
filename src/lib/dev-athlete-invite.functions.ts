// DEV-ONLY helper. Creates a throwaway athlete under the signed-in parent
// and mints a fresh athlete_invite_codes row so DevTools can walk through
// /signup/athlete/confirm and /signup/athlete/account, which both require a
// valid ?code= search param.
//
// Safe in prod: requires auth, only creates rows the parent could create
// themselves through the normal signup flow, never returns other users' data.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dbError } from "./db-error";

const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function genCode(len = 8): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < len; i++) out += INVITE_ALPHABET[bytes[i] % INVITE_ALPHABET.length];
  return out;
}

export const mintDevAthleteInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const parent = await supabaseAdmin
      .from("parent_profiles")
      .select("id, first_name")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (parent.error) dbError(parent.error);
    if (!parent.data) {
      throw new Error("Sign in as a parent to mint a dev athlete invite code");
    }
    const parentId = parent.data.id;

    // Create a fresh unclaimed athlete so the unique (athlete_id) constraint
    // on athlete_invite_codes never collides.
    const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, "");
    const athlete = await supabaseAdmin
      .from("athletes")
      .insert({
        parent_id: parentId,
        first_name: `Dev ${stamp}`,
        last_name: "Athlete",
      })
      .select("id, first_name, last_name")
      .single();
    if (athlete.error) dbError(athlete.error);

    // Retry on the (rare) 8-char collision.
    let code = "";
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = genCode(8);
      const ins = await supabaseAdmin
        .from("athlete_invite_codes")
        .insert({ parent_id: parentId, athlete_id: athlete.data.id, code: candidate })
        .select("code")
        .maybeSingle();
      if (!ins.error && ins.data) {
        code = ins.data.code;
        break;
      }
    }
    if (!code) throw new Error("Could not generate a unique invite code");

    return {
      code,
      athleteId: athlete.data.id,
      athleteName: `${athlete.data.first_name} ${athlete.data.last_name}`.trim(),
    };
  });
