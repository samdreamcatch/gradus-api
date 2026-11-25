/**
 * The website this server is, for links it puts in emails and auth redirects: the `SITE_URL`
 * env variable (`http://localhost:8081` locally, the Vercel dev URL on dev), else production.
 * Without it a dev sign-up's confirmation email sent the coach to gradus.training, or (since
 * Supabase refuses a redirect that isn't on the project's allow list) to its Site URL.
 */
export const PRODUCTION_SITE_URL = "https://gradus.training";

export function siteUrl(): string {
  const raw = (typeof process !== "undefined" ? process.env.SITE_URL : undefined)?.trim() ?? "";
  const trimmed = raw.replace(/\/+$/, "");
  if (!/^https?:\/\/[^/\s]+/i.test(trimmed)) return PRODUCTION_SITE_URL;
  return trimmed;
}
