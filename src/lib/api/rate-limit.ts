/**
 * Fixed-window rate limiter, per docs/ios/PRD.md §6.2. Backed by
 * `api_rate_limits` (supabase/migrations), keyed by route plus IP (and user
 * when authenticated).
 *
 * `api_rate_limits` is not yet in the generated Supabase `Database` type
 * (that codegen runs separately and is out of scope tonight), so table
 * access is cast the same way `src/routes/api/public/board/refresh.ts`
 * already does for ad-hoc table access.
 */
import type { ApiContext } from "./auth";

export interface RateLimitConfig {
  windowSeconds: number;
  max: number;
}

export interface RateLimitKey {
  route: string;
  ip: string | null;
  userId?: string | null;
  /** Extra bucket component for keys that aren't IP/user, e.g. a sign-in identifier. */
  extra?: string | null;
}

export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };

interface RateLimitRow {
  window_start: string;
  count: number;
}

type RateLimitTable = {
  from: (table: "api_rate_limits") => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: string,
      ) => { maybeSingle: () => Promise<{ data: RateLimitRow | null; error: unknown }> };
    };
    update: (patch: { count: number }) => {
      eq: (column: string, value: string) => Promise<{ data: unknown; error: unknown }>;
    };
    upsert: (
      row: { bucket: string; window_start: string; count: number },
      opts: { onConflict: string },
    ) => Promise<{ data: unknown; error: unknown }>;
  };
};

export async function checkRateLimit(
  admin: ApiContext["admin"],
  config: RateLimitConfig,
  key: RateLimitKey,
): Promise<RateLimitResult> {
  const bucket = [key.route, key.userId ?? "anon", key.ip ?? "unknown", key.extra ?? ""].join(":");
  const windowMs = config.windowSeconds * 1000;
  const now = Date.now();
  const windowStartMs = Math.floor(now / windowMs) * windowMs;
  const windowStart = new Date(windowStartMs).toISOString();

  const table = (admin as unknown as RateLimitTable).from("api_rate_limits");

  const { data: existing } = await table
    .select("window_start, count")
    .eq("bucket", bucket)
    .maybeSingle();

  if (existing && new Date(existing.window_start).getTime() === windowStartMs) {
    if (existing.count >= config.max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((windowStartMs + windowMs - now) / 1000));
      return { allowed: false, retryAfterSeconds };
    }
    await table.update({ count: existing.count + 1 }).eq("bucket", bucket);
    return { allowed: true };
  }

  await table.upsert({ bucket, window_start: windowStart, count: 1 }, { onConflict: "bucket" });
  return { allowed: true };
}
