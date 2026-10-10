/**
 * Reset and email-change emails link to gradus.training itself (beta
 * feedback 2026-10-07: email links open the app). The backend's own link,
 * `…supabase.co/auth/v1/verify?token=<hash>&type=recovery&redirect_to=…`,
 * reached the site through a redirect, and iPhones open a link that arrives
 * by redirect in Safari, not the app. A `gradus://` redirect isn't possible
 * either: the backend's redirect allow-list takes only web addresses, and
 * any app could claim that scheme.
 *
 * So the email gets `https://gradus.training/auth/confirm?token_hash=<hash>&type=…`
 * built from the same one-time code. With the app installed it opens there
 * (a universal link, see apple-app-site-association.ts) and the app
 * exchanges the code; otherwise `/auth/confirm` does it in the browser.
 */
export const AUTH_CONFIRM_PATH = "/auth/confirm";

/** The email actions whose links become `/auth/confirm`. */
export const AUTH_CONFIRM_TYPES = ["recovery", "email_change"] as const;
export type AuthConfirmType = (typeof AUTH_CONFIRM_TYPES)[number];

export function isAuthConfirmType(value: unknown): value is AuthConfirmType {
  return typeof value === "string" && (AUTH_CONFIRM_TYPES as readonly string[]).includes(value);
}

/**
 * The gradus.training link for a backend verify URL, or the URL unchanged
 * when it isn't one this knows how to rewrite (another action type, or a
 * shape it doesn't recognize), so an email never loses its working link.
 */
export function authConfirmUrl(verifyUrl: string | undefined, siteUrl: string): string | undefined {
  if (!verifyUrl) return verifyUrl;
  let parsed: URL;
  try {
    parsed = new URL(verifyUrl);
  } catch {
    return verifyUrl;
  }
  if (!parsed.pathname.endsWith("/auth/v1/verify")) return verifyUrl;
  const tokenHash = parsed.searchParams.get("token");
  const type = parsed.searchParams.get("type");
  if (!tokenHash || !isAuthConfirmType(type)) return verifyUrl;
  const out = new URL(AUTH_CONFIRM_PATH, siteUrl);
  out.searchParams.set("token_hash", tokenHash);
  out.searchParams.set("type", type);
  return out.toString();
}
