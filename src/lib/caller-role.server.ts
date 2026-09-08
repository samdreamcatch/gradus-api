/**
 * Shared caller-role resolution for `/api/v1` routes that need to know
 * *which* profile the authenticated caller actually has, not just that
 * they're authenticated.
 *
 * Reproduces the precedence `GET /api/v1/me` and the web's `getMyRole`
 * (`src/lib/parent-signup.functions.ts`) use, onboarding included: an
 * *onboarded* coach wins outright, otherwise parent, then athlete, then an
 * un-onboarded coach still counts as "coach" (there's no other feed/persona
 * for them). A caller with no profile at all resolves to `null`.
 *
 * Extracted out of `resources.server.ts` (`GET /api/v1/resources`'s
 * dispatcher) without behavior change, so `resources.server.ts` and any
 * other caller — e.g. the `POST /api/v1/ask` audience resolver — agree on
 * who the caller is instead of each keeping its own copy.
 */
import type { supabaseAdmin } from "@/integrations/supabase/client.server";
import { dbError } from "./db-error";

type Admin = typeof supabaseAdmin;

export type CallerRole = "coach" | "parent" | "athlete";

export async function resolveCallerRole(admin: Admin, userId: string): Promise<CallerRole | null> {
  const [coach, parent, athlete] = await Promise.all([
    admin.from("coach_profiles").select("id, onboarded_at").eq("user_id", userId).maybeSingle(),
    admin.from("parent_profiles").select("id").eq("user_id", userId).maybeSingle(),
    admin.from("athletes").select("id").eq("user_id", userId).maybeSingle(),
  ]);
  const failed = [coach, parent, athlete].find((r) => r.error);
  if (failed?.error) dbError(failed.error);

  if (coach.data?.onboarded_at) return "coach";
  if (parent.data) return "parent";
  if (athlete.data) return "athlete";
  if (coach.data) return "coach";
  return null;
}
