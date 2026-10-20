import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { dbError } from "./db-error";
import { policyClient } from "./club-policy-schema";

type Client = SupabaseClient<Database>;

async function assertOrgAdmin(supabase: Client, userId: string, orgId: string) {
  const { data, error } = await supabase.rpc("has_org_admin", { _user_id: userId, _org_id: orgId });
  if (error) dbError(error);
  if (!data) throw new Error("Not authorized for this organization");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

const orgOnly = z.object({ organizationId: z.string().uuid() });

export const getClubReadiness = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => orgOnly.parse(i))
  .handler(async ({ data, context }) => {
    const admin = await assertOrgAdmin(
      context.supabase as Client,
      context.userId,
      data.organizationId,
    );
    const { clubReadiness } = await import("./trust-center.server");
    return clubReadiness(admin, data.organizationId);
  });

export const listPolicyMatrix = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => orgOnly.parse(i))
  .handler(async ({ data, context }) => {
    const admin = await assertOrgAdmin(
      context.supabase as Client,
      context.userId,
      data.organizationId,
    );
    const { clubRequirements } = await import("./trust-center.server");
    return clubRequirements(admin, data.organizationId);
  });

/* ---------- Policy packs (tables arrive with the staged migration) ---------- */

export const PACK_CATEGORIES = [
  "safe_sport",
  "communication",
  "travel",
  "photo_video",
  "medical",
  "club",
] as const;

export type PolicyPack = {
  id: string;
  name: string;
  category: (typeof PACK_CATEGORIES)[number];
  dueAt: string | null;
  renewMonths: number | null;
  resourceIds: string[];
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;

export const listPolicyPacks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => orgOnly.parse(i))
  .handler(async ({ data, context }): Promise<{ packs: PolicyPack[] }> => {
    const admin = (await assertOrgAdmin(
      context.supabase as Client,
      context.userId,
      data.organizationId,
    )) as Loose;
    const { data: rows, error } = await admin
      .from("policy_packs")
      .select("id, name, category, due_at, renew_months, policy_pack_items(resource_id)")
      .eq("organization_id", data.organizationId)
      .is("archived_at", null)
      .order("name");
    if (error) dbError(error);
    return {
      packs: (rows ?? []).map((r: Loose) => ({
        id: r.id,
        name: r.name,
        category: r.category,
        dueAt: r.due_at,
        renewMonths: r.renew_months,
        resourceIds: (r.policy_pack_items ?? []).map((i: Loose) => i.resource_id),
      })),
    };
  });

export const savePolicyPack = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    orgOnly
      .extend({
        id: z.string().uuid().nullable(),
        name: z.string().trim().min(1).max(120),
        category: z.enum(PACK_CATEGORIES),
        dueAt: z.string().datetime().nullable(),
        renewMonths: z.number().int().min(1).max(60).nullable(),
        resourceIds: z.array(z.string().uuid()).max(50),
        archive: z.boolean().default(false),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const orgId = data.organizationId;
    const admin = (await assertOrgAdmin(
      context.supabase as Client,
      context.userId,
      orgId,
    )) as Loose;
    const row = {
      organization_id: orgId,
      name: data.name,
      category: data.category,
      due_at: data.dueAt,
      renew_months: data.renewMonths,
      archived_at: data.archive ? new Date().toISOString() : null,
      updated_by: context.userId,
    };
    let id = data.id;
    if (id) {
      const up = await admin
        .from("policy_packs")
        .update(row)
        .eq("id", id)
        .eq("organization_id", orgId);
      if (up.error) dbError(up.error);
      const found = await admin
        .from("policy_packs")
        .select("id")
        .eq("id", id)
        .eq("organization_id", orgId)
        .maybeSingle();
      if (found.error) dbError(found.error);
      if (!found.data) throw new Error("Policy pack not found");
    } else {
      const ins = await admin.from("policy_packs").insert(row).select("id").single();
      if (ins.error) dbError(ins.error);
      id = ins.data.id as string;
    }
    // Only documents with a requirement in this club can join a pack.
    const allowed = await policyClient(admin)
      .from("club_resource_ack_requirements")
      .select("resource_id")
      .eq("organization_id", orgId)
      .in(
        "resource_id",
        data.resourceIds.length ? data.resourceIds : ["00000000-0000-0000-0000-000000000000"],
      );
    if (allowed.error) dbError(allowed.error);
    const keep: string[] = (allowed.data ?? []).map((r: Loose) => r.resource_id);
    const del = await admin.from("policy_pack_items").delete().eq("pack_id", id);
    if (del.error) dbError(del.error);
    if (keep.length) {
      const ins = await admin
        .from("policy_pack_items")
        .insert(keep.map((resource_id) => ({ pack_id: id, resource_id })));
      if (ins.error) dbError(ins.error);
    }
    await admin.from("org_admin_actions").insert({
      organization_id: orgId,
      actor_user_id: context.userId,
      action: data.archive
        ? "policy_pack.archived"
        : data.id
          ? "policy_pack.updated"
          : "policy_pack.created",
      payload: { pack_id: id, name: data.name },
    });
    return { id };
  });

export const exportPolicyProof = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => orgOnly.extend({ resourceId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const admin = await assertOrgAdmin(
      context.supabase as Client,
      context.userId,
      data.organizationId,
    );
    const { clubRequirements } = await import("./trust-center.server");
    const { loadPolicyResource } = await import("./org-content.server");
    const res = await loadPolicyResource(admin, data.organizationId, data.resourceId);
    const matrix = await clubRequirements(admin, data.organizationId);
    const doc = matrix.docs.find((d) => d.resourceId === data.resourceId);
    if (!doc) throw new Error("Policy requirement not found");
    const history = await policyClient(admin)
      .from("club_resource_acknowledgements")
      .select("version, signer_name, role, acknowledged_at, acted_for_athlete_id")
      .eq("organization_id", data.organizationId)
      .eq("resource_id", data.resourceId)
      .lt("version", doc.version)
      .order("acknowledged_at");
    if (history.error) dbError(history.error);
    const versions = await (admin as SupabaseClient)
      .from("club_policy_versions")
      .select("version, title, audiences, required_at, external_url")
      .eq("organization_id", data.organizationId)
      .eq("resource_id", data.resourceId)
      .order("version");
    if (versions.error) dbError(versions.error);
    const club = await admin
      .from("organizations")
      .select("name")
      .eq("id", data.organizationId)
      .single();
    if (club.error) dbError(club.error);
    let original: Uint8Array | undefined;
    if (res.kind === "pdf" && res.storage_path) {
      const download = await admin.storage.from("resource-pdfs").download(res.storage_path);
      if (download.error || !download.data)
        throw new Error("Could not include the original document. Try again.");
      original = new Uint8Array(await download.data.arrayBuffer());
    }
    const { buildPolicyProof } = await import("./policy-proof.server");
    const bytes = await buildPolicyProof({
      club: club.data.name,
      title: doc.title,
      version: doc.version,
      audiences: doc.audiences,
      dueAt: doc.dueAt,
      requiredAt: doc.requiredAt,
      sourceUrl: res.external_url,
      signers: matrix.signers[data.resourceId] ?? [],
      history: history.data ?? [],
      versions: versions.data ?? [],
      original,
    });
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192)
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return { base64: btoa(binary), filename: `policy-v${doc.version}-proof.pdf` };
  });
