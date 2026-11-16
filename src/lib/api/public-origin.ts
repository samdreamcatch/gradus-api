/**
 * The address the caller reached this server at, for links it hands back to
 * open in a browser: Stripe Checkout's return page and the web sign-in
 * handoff. Behind a dev tunnel or proxy the server only sees the forwarded
 * request, http://localhost:<port>, which Safari on the caller's device can't
 * open; the tunnel's `X-Forwarded-Host` / `-Proto` say where the caller really
 * is. Those headers are only trusted when the server sees localhost, so a
 * deployed site always answers with its own address.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "0.0.0.0"]);

export function publicOrigin(request: Request): string {
  const url = new URL(request.url);
  if (!LOCAL_HOSTS.has(url.hostname)) return url.origin;
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  if (!host || !/^[a-z0-9.-]+(:\d{1,5})?$/i.test(host)) return url.origin;
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  return `${proto === "http" ? "http" : "https"}://${host}`;
}
