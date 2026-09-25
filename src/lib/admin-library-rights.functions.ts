/**
 * Admin panel server functions for the curated library's rights status
 * (`resources.rights`, migration 20260924120000). Internal admins only
 * (`has_role(admin)`), like the rest of admin.functions.ts.
 *
 * Why this exists: App Store Connect asks whether the app shows third-party
 * content and whether Gradus holds the rights (PRD §12 #16). The iOS app's
 * `GET /api/v1/resources` lists a curated row only when its rights are
 * `gradus` or `licensed`; the web library is unchanged. This page is where
 * Mariah marks each document.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dbError } from "./db-error";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

async function assertAdmin(context: { userId: string; supabase: AnyClient }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) dbError(error);
  if (!data) throw new Error("Forbidden");
  return context.userId;
}

async function adminClient(): Promise<AnyClient> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as AnyClient;
}

export const LIBRARY_RIGHTS = ["gradus", "licensed", "pending"] as const;
export type LibraryRights = (typeof LIBRARY_RIGHTS)[number];
export const libraryRightsSchema = z.enum(LIBRARY_RIGHTS);

export const LIBRARY_RIGHTS_LABEL: Record<LibraryRights, string> = {
  gradus: "Gradus-authored",
  licensed: "Licensed / public licence",
  pending: "Pending (web only)",
};

export type LibraryRightsRowDTO = {
  id: string;
  sport: string;
  title: string;
  kind: "pdf" | "image" | "link";
  published: boolean;
  rights: LibraryRights;
  updatedAt: string;
};

/** Every curated library row (coach_id IS NULL), published or not, with its rights status. */
export const adminListLibraryRights = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ rows: LibraryRightsRowDTO[] }> => {
    await assertAdmin(context);
    const admin = await adminClient();
    const { data, error } = await admin
      .from("resources")
      .select("id, sport, title, kind, published, rights, updated_at")
      .is("coach_id", null)
      .order("sport", { ascending: true })
      .order("display_order", { ascending: true })
      .order("title", { ascending: true });
    if (error) dbError(error);
    const rows = (data ?? []) as {
      id: string;
      sport: string;
      title: string;
      kind: string;
      published: boolean;
      rights: string;
      updated_at: string;
    }[];
    return {
      rows: rows.map((r) => ({
        id: r.id,
        sport: r.sport,
        title: r.title,
        kind: (r.kind as LibraryRightsRowDTO["kind"]) ?? "pdf",
        published: r.published,
        rights: libraryRightsSchema.catch("pending").parse(r.rights),
        updatedAt: r.updated_at,
      })),
    };
  });

const setRightsInput = z.object({
  id: z.string().uuid(),
  rights: libraryRightsSchema,
});

/** Mark one curated row. Coach uploads are refused: the coach owns those. */
export const adminSetLibraryRights = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => setRightsInput.parse(d))
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    const userId = await assertAdmin(context);
    const admin = await adminClient();
    const { data: changed, error } = await admin
      .from("resources")
      .update({ rights: data.rights, updated_by: userId })
      .eq("id", data.id)
      .is("coach_id", null)
      .select("id");
    if (error) dbError(error);
    if (!(changed ?? []).length) throw new Error("Not a curated library row.");
    return { ok: true };
  });
