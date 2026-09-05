/**
 * `/api/v1` request authentication.
 *
 * Mirrors `requireSupabaseAuth` in
 * `src/integrations/supabase/auth-middleware.ts` (Bearer token, user-scoped
 * client, `auth.getClaims`) without importing or changing that
 * auto-generated middleware, which is wired for TanStack server functions,
 * not raw file routes.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ApiError } from "./errors";

export interface ApiContext {
  userId: string;
  /** User-scoped client (RLS applies), authenticated as the caller. */
  supabase: SupabaseClient<Database>;
  /** Service-role client (RLS bypassed). */
  admin: typeof supabaseAdmin;
}

/**
 * Resolves the caller's identity from the `Authorization` header.
 * Returns `null` when no header is present. Throws `ApiError` (401) when a
 * bearer token is present but malformed or invalid.
 */
export async function authenticateRequest(request: Request): Promise<ApiContext | null> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return null;

  if (!authHeader.startsWith("Bearer ")) {
    throw ApiError.unauthenticated("Only Bearer tokens are supported.");
  }

  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) {
    throw ApiError.unauthenticated("No token provided.");
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    console.error("[api] missing SUPABASE_URL/SUPABASE_PUBLISHABLE_KEY");
    throw new ApiError({
      code: "internal",
      status: 500,
      message: "Something went wrong. Please try again.",
    });
  }

  const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims?.sub) {
    throw ApiError.unauthenticated("Invalid token.");
  }

  return { userId: data.claims.sub, supabase, admin: supabaseAdmin };
}

/** Narrows `ApiContext | null` to `ApiContext`, throwing 401 if absent. */
export function requireContext(ctx: ApiContext | null): ApiContext {
  if (!ctx) throw ApiError.unauthenticated();
  return ctx;
}
