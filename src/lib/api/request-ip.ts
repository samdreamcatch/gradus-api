import { getClientIp } from "./define-route";

/**
 * The per-IP key the invite lookup throttle uses. Falls back to the user
 * agent when no client IP header is present (local dev), as the web's
 * `clientIp()` helpers do.
 */
export function lookupIpKey(request: Request): string {
  const ip = getClientIp(request);
  if (ip) return ip;
  return `ua:${(request.headers.get("user-agent") ?? "").slice(0, 64)}`;
}
