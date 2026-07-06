import { createServerFn } from "@tanstack/react-start";
import { getRequestIP } from "@tanstack/react-start/server";
import { z } from "zod";

/**
 * Verifies a Cloudflare Turnstile token server-side against the siteverify
 * endpoint. Call this before kicking off Google OAuth (which cannot pass a
 * captcha token through the Lovable broker). Supabase email/password calls
 * already verify the token natively when CAPTCHA is enabled in auth settings.
 */
export const verifyTurnstileToken = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ token: z.string().min(1, "Missing captcha token").max(4096) }).parse(input),
  )
  .handler(async ({ data }) => {
    const secret = process.env.TURNSTILE_SECRET_KEY;
    if (!secret) {
      throw new Error("Server captcha is not configured. Contact support.");
    }

    let remoteIp: string | undefined;
    try {
      remoteIp = getRequestIP({ xForwardedFor: true }) ?? undefined;
    } catch {
      remoteIp = undefined;
    }

    const body = new URLSearchParams({ secret, response: data.token });
    if (remoteIp) body.set("remoteip", remoteIp);

    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    const payload = (await res.json()) as {
      success: boolean;
      "error-codes"?: string[];
    };

    if (!payload.success) {
      throw new Error("Captcha check failed. Please try again.");
    }

    return { ok: true as const };
  });
