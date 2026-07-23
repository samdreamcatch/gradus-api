import { createServerFn } from "@tanstack/react-start";
import { getRequestIP, getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { dbError } from "./db-error";

const codeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .length(8, "Invite code must be 8 characters")
  .regex(/^[A-Z2-9]+$/, "Invalid characters in code");

const RATE_WINDOW_SECONDS = 60;
const RATE_MAX_PER_WINDOW = 15;

function clientIp(): string {
  try {
    const ip = getRequestIP({ xForwardedFor: true });
    if (ip) return ip;
  } catch {
    // ignore
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

export type InviteKind = "coach" | "parent" | "athlete" | "adult-athlete";

/**
 * Public: identify whether an 8-char code belongs to a coach, parent, or
 * athlete invite table. Rate-limited per IP to prevent enumeration. Used by
 * the universal `/i/$code` entry to decide where to send the recipient.
 *
 * `kind`:
 *  - "coach"   → coach_invite_codes: the coach owns it; recipient is a
 *                parent or adult athlete about to link this coach.
 *  - "parent"  → parent_invite_codes: the parent owns it; recipient is a
 *                coach about to be rostered onto that parent's athletes.
 *  - "athlete" → athlete_invite_codes: the parent generated it for a
 *                specific under-18 athlete to claim their own account.
 */
export const resolveInviteCode = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ code: codeSchema }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const limit = await supabaseAdmin.rpc("record_invite_lookup_attempt", {
      _ip: clientIp(),
      _code: `r:${data.code}`,
      _max_per_window: RATE_MAX_PER_WINDOW,
      _window_seconds: RATE_WINDOW_SECONDS,
    });
    if (limit.error) dbError(limit.error);
    if (limit.data === -1) {
      throw new Error("Too many attempts. Please wait a minute and try again.");
    }

    const [coach, parent, athlete, adultAthlete] = await Promise.all([
      supabaseAdmin
        .from("coach_invite_codes")
        .select("code")
        .eq("code", data.code)
        .maybeSingle(),
      supabaseAdmin
        .from("parent_invite_codes")
        .select("code")
        .eq("code", data.code)
        .maybeSingle(),
      supabaseAdmin
        .from("athlete_invite_codes")
        .select("code, used_at, expires_at")
        .eq("code", data.code)
        .maybeSingle(),
      supabaseAdmin
        .from("adult_athlete_invite_codes")
        .select("code")
        .eq("code", data.code)
        .maybeSingle(),
    ]);
    if (coach.error) dbError(coach.error);
    if (parent.error) dbError(parent.error);
    if (athlete.error) dbError(athlete.error);
    if (adultAthlete.error) dbError(adultAthlete.error);

    if (coach.data) return { kind: "coach" as const, valid: true };
    if (parent.data) return { kind: "parent" as const, valid: true };
    if (adultAthlete.data) return { kind: "adult-athlete" as const, valid: true };
    if (athlete.data) {
      const expired = athlete.data.expires_at ? new Date(athlete.data.expires_at) < new Date() : false;
      return {
        kind: "athlete" as const,
        valid: !athlete.data.used_at && !expired,
        used: !!athlete.data.used_at,
        expired,
      };
    }
    return { kind: null, valid: false };
  });
