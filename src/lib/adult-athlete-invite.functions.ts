import { createServerFn } from "@tanstack/react-start";
import { getRequestIP, getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dbError } from "./db-error";
import { ageInYears } from "./pending-athlete-dob";
import {
  claimAdultAthleteInvite as claimAdultAthleteInviteShared,
  claimInviteInput,
  previewAdultAthleteInvite,
} from "./invites.server";

const codeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .length(8, "Enter the full invite code")
  .regex(/^[A-Z2-9]+$/, "Invalid characters in code");

const RATE_WINDOW_SECONDS = 60;
const RATE_MAX_PER_WINDOW = 10;

// Crockford-style base32, minus I, L, O, 0, 1.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function generateCode(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < 8; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

function clientIp(): string {
  try {
    const ip = getRequestIP({ xForwardedFor: true });
    if (ip) return ip;
  } catch {
    /* ignore */
  }
  const ua = (() => {
    try {
      return getRequestHeader("user-agent") ?? "";
    } catch {
      return "";
    }
  })();
  return `ua:${ua.slice(0, 64)}`;
}

/**
 * Returns the signed-in adult (self-managed) athlete's invite code, creating
 * one on first use. Coaches use this code (or link) to roster this athlete.
 */
export const getOrCreateAdultAthleteInviteCode = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const userId = context.userId;

    const me = await supabaseAdmin
      .from("athletes")
      .select("id, promo_code, birthdate, guardian_email, parent_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (me.error) dbError(me.error);
    if (!me.data) {
      throw new Error("Finish setting up your athlete profile first.");
    }
    // Under-18 athletes can invite a coach, but only with a guardian reachable
    // — either an email on file or a linked parent account.
    const bd = me.data.birthdate as string | null;
    if (bd && ageInYears(bd) < 18 && !me.data.guardian_email && !me.data.parent_id) {
      throw new Error("Add a parent or guardian email in Settings before inviting a coach.");
    }

    const athleteId = me.data.id;
    const inviterPromo = me.data.promo_code ?? null;

    const existing = await supabaseAdmin
      .from("adult_athlete_invite_codes")
      .select("code")
      .eq("athlete_id", athleteId)
      .maybeSingle();
    if (existing.error) dbError(existing.error);
    if (existing.data) return { code: existing.data.code };

    for (let attempt = 0; attempt < 8; attempt++) {
      const code = generateCode();
      const ins = await supabaseAdmin
        .from("adult_athlete_invite_codes")
        .insert({ athlete_id: athleteId, code, promo_code: inviterPromo })
        .select("code")
        .maybeSingle();
      if (!ins.error && ins.data) return { code: ins.data.code };
      const reread = await supabaseAdmin
        .from("adult_athlete_invite_codes")
        .select("code")
        .eq("athlete_id", athleteId)
        .maybeSingle();
      if (reread.data) return { code: reread.data.code };
    }
    throw new Error("Could not generate a unique invite code.");
  });

/**
 * Public: preview the athlete an adult-athlete invite belongs to. Rate-limited
 * per IP. Thin wrapper over src/lib/invites.server.ts, shared with
 * `POST /api/v1/invites/adult-athlete/preview`.
 */
export const getAdultAthleteByInviteCode = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ code: codeSchema }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return previewAdultAthleteInvite(supabaseAdmin, clientIp(), data.code);
  });

/**
 * Called by an authenticated, onboarded coach to claim an adult-athlete
 * invite. Thin wrapper over src/lib/invites.server.ts, shared with
 * `POST /api/v1/invites/adult-athlete/claim`. Idempotent.
 */
export const claimAdultAthleteInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => claimInviteInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return claimAdultAthleteInviteShared({ userId: context.userId, admin: supabaseAdmin }, data);
  });
