import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/twilio";
const ATHLETE_EMAIL_DOMAIN = "athletes.gradus.local";
const OTP_TTL_MIN = 10;
const MAX_ATTEMPTS = 5;

const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{6,14}$/, "Phone must be in E.164 format like +15551234567");

const codeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .length(8)
  .regex(/^[A-Z2-9]+$/);

const otpSchema = z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code");

function gen6(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const n = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
  return String(n % 1_000_000).padStart(6, "0");
}

function genPassword(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function sendSms(to: string, body: string): Promise<void> {
  const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
  const TWILIO_API_KEY = process.env.TWILIO_API_KEY;
  const FROM = process.env.TWILIO_FROM_NUMBER;
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");
  if (!TWILIO_API_KEY) throw new Error("TWILIO_API_KEY is not configured");
  if (!FROM) throw new Error("TWILIO_FROM_NUMBER is not configured");

  const res = await fetch(`${GATEWAY_URL}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": TWILIO_API_KEY,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: to, From: FROM, Body: body }),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error("Twilio send failed", res.status, text);
    throw new Error("Could not send the verification code. Please try again.");
  }
}

async function createChallenge(phone: string, inviteCode: string | null): Promise<void> {
  const otp = gen6();
  const code_hash = await sha256(otp);
  const expires_at = new Date(Date.now() + OTP_TTL_MIN * 60_000).toISOString();
  const ins = await supabaseAdmin.from("athlete_otp_challenges").insert({
    phone,
    code_hash,
    invite_code: inviteCode,
    expires_at,
  });
  if (ins.error) throw new Error(ins.error.message);
  await sendSms(phone, `Your Gradus code is ${otp}. It expires in ${OTP_TTL_MIN} minutes.`);
}

/**
 * Step 1 of joining via invite code: validate the code and send an SMS OTP.
 */
export const requestAthleteJoinOtp = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ code: codeSchema, phone: phoneSchema }).parse(input),
  )
  .handler(async ({ data }) => {
    const invite = await supabaseAdmin
      .from("athlete_invite_codes")
      .select("athlete_id, parent_id, expires_at, claimed_at")
      .eq("code", data.code)
      .maybeSingle();
    if (invite.error) throw new Error(invite.error.message);
    if (!invite.data) throw new Error("That invite code isn't valid.");
    if (invite.data.claimed_at) {
      throw new Error("This invite has already been used. Use the login page instead.");
    }
    if (new Date(invite.data.expires_at) < new Date()) {
      throw new Error("This invite has expired. Ask your parent for a new code.");
    }

    // Block if another athlete already owns this phone.
    const conflict = await supabaseAdmin
      .from("athletes")
      .select("id")
      .eq("phone", data.phone)
      .neq("id", invite.data.athlete_id)
      .maybeSingle();
    if (conflict.error) throw new Error(conflict.error.message);
    if (conflict.data) {
      throw new Error("That phone number is already in use by another athlete.");
    }

    await createChallenge(data.phone, data.code);
    return { ok: true };
  });

/**
 * Step 1 of returning login: send an SMS OTP to a phone that already belongs
 * to a linked athlete.
 */
export const requestAthleteLoginOtp = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ phone: phoneSchema }).parse(input))
  .handler(async ({ data }) => {
    const athlete = await supabaseAdmin
      .from("athletes")
      .select("id, user_id")
      .eq("phone", data.phone)
      .maybeSingle();
    if (athlete.error) throw new Error(athlete.error.message);
    if (!athlete.data || !athlete.data.user_id) {
      // Don't reveal whether the phone is registered — generic message.
      throw new Error("We couldn't find an account for that number.");
    }
    await createChallenge(data.phone, null);
    return { ok: true };
  });

const verifyInput = z.object({
  phone: phoneSchema,
  otp: otpSchema,
  code: codeSchema.optional(),
});

/**
 * Step 2: verify OTP. If `code` is provided, claims the invite and links the
 * athlete to a new auth user. Otherwise re-authenticates the existing athlete.
 * Returns Supabase session tokens for `supabase.auth.setSession`.
 */
export const verifyAthleteOtp = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => verifyInput.parse(input))
  .handler(async ({ data }) => {
    // Latest non-consumed challenge for this phone.
    const ch = await supabaseAdmin
      .from("athlete_otp_challenges")
      .select("id, code_hash, expires_at, attempts, invite_code, consumed_at")
      .eq("phone", data.phone)
      .is("consumed_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (ch.error) throw new Error(ch.error.message);
    if (!ch.data) throw new Error("No active code. Request a new one.");
    if (new Date(ch.data.expires_at) < new Date()) {
      throw new Error("That code has expired. Request a new one.");
    }
    if (ch.data.attempts >= MAX_ATTEMPTS) {
      throw new Error("Too many attempts. Request a new code.");
    }

    const incomingHash = await sha256(data.otp);
    if (incomingHash !== ch.data.code_hash) {
      await supabaseAdmin
        .from("athlete_otp_challenges")
        .update({ attempts: ch.data.attempts + 1 })
        .eq("id", ch.data.id);
      throw new Error("That code isn't right.");
    }

    // OTP is good — consume it.
    await supabaseAdmin
      .from("athlete_otp_challenges")
      .update({ consumed_at: new Date().toISOString() })
      .eq("id", ch.data.id);

    // Resolve which athlete row this is for.
    let athleteId: string;
    let userId: string | null;

    if (data.code) {
      // Join flow: invite_code on the challenge must match.
      if (ch.data.invite_code !== data.code) {
        throw new Error("Code mismatch. Restart the flow.");
      }
      const invite = await supabaseAdmin
        .from("athlete_invite_codes")
        .select("id, athlete_id, claimed_at, expires_at")
        .eq("code", data.code)
        .maybeSingle();
      if (invite.error) throw new Error(invite.error.message);
      if (!invite.data || invite.data.claimed_at) {
        throw new Error("That invite is no longer valid.");
      }
      if (new Date(invite.data.expires_at) < new Date()) {
        throw new Error("That invite has expired.");
      }
      athleteId = invite.data.athlete_id;

      const athlete = await supabaseAdmin
        .from("athletes")
        .select("id, user_id")
        .eq("id", athleteId)
        .single();
      if (athlete.error) throw new Error(athlete.error.message);
      userId = athlete.data.user_id;
    } else {
      const athlete = await supabaseAdmin
        .from("athletes")
        .select("id, user_id")
        .eq("phone", data.phone)
        .maybeSingle();
      if (athlete.error) throw new Error(athlete.error.message);
      if (!athlete.data || !athlete.data.user_id) {
        throw new Error("No account for that number.");
      }
      athleteId = athlete.data.id;
      userId = athlete.data.user_id;
    }

    // Ensure auth user exists, rotate password to a fresh value, sign in.
    const email = `athlete-${athleteId}@${ATHLETE_EMAIL_DOMAIN}`;
    const password = genPassword();

    if (!userId) {
      const created = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        phone: data.phone,
        user_metadata: { role: "athlete", athlete_id: athleteId },
      });
      if (created.error || !created.data.user) {
        throw new Error(created.error?.message ?? "Could not create account.");
      }
      userId = created.data.user.id;

      const upd = await supabaseAdmin
        .from("athletes")
        .update({ user_id: userId, phone: data.phone })
        .eq("id", athleteId);
      if (upd.error) throw new Error(upd.error.message);

      if (data.code) {
        const claim = await supabaseAdmin
          .from("athlete_invite_codes")
          .update({ claimed_at: new Date().toISOString(), claimed_by: userId })
          .eq("code", data.code);
        if (claim.error) throw new Error(claim.error.message);
      }
    } else {
      const upd = await supabaseAdmin.auth.admin.updateUserById(userId, { password });
      if (upd.error) throw new Error(upd.error.message);
    }

    const signIn = await supabaseAdmin.auth.signInWithPassword({ email, password });
    if (signIn.error || !signIn.data.session) {
      throw new Error(signIn.error?.message ?? "Sign-in failed.");
    }

    return {
      access_token: signIn.data.session.access_token,
      refresh_token: signIn.data.session.refresh_token,
    };
  });
