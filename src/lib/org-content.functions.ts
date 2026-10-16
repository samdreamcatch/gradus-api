import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { dbError } from "./db-error";

type Client = SupabaseClient<Database>;

async function assertOrgAdmin(supabase: Client, userId: string, orgId: string) {
  const { data, error } = await supabase.rpc("has_org_admin", {
    _user_id: userId,
    _org_id: orgId,
  });
  if (error) dbError(error);
  if (!data) throw new Error("Not authorized for this organization");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function assertGradusAdmin(supabase: Client, userId: string) {
  const { data, error } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (error) dbError(error);
  if (!data) throw new Error("Forbidden");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

const orgOnly = z.object({ organizationId: z.string().uuid() });
const audienceSchema = z.enum(["coach", "parent", "athlete"]);

/* ============================ Sports ============================ */

export const getOrgSports = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => orgOnly.parse(i))
  .handler(async ({ data, context }) => {
    const admin = await assertOrgAdmin(context.supabase as Client, context.userId, data.organizationId);
    const { orgSports } = await import("./org-content.server");
    return { sports: await orgSports(admin, data.organizationId) };
  });

/** Internal admin: which sports a club has. */
export const adminGetOrganizationSports = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => orgOnly.parse(i))
  .handler(async ({ data, context }) => {
    const admin = await assertGradusAdmin(context.supabase as Client, context.userId);
    const { orgSports } = await import("./org-content.server");
    return { sports: await orgSports(admin, data.organizationId) };
  });

export const adminSetOrganizationSports = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    orgOnly.extend({ sports: z.array(z.string().min(1).max(64)).max(40) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const admin = await assertGradusAdmin(context.supabase as Client, context.userId);
    const { setOrgSports } = await import("./org-content.server");
    await setOrgSports(admin, data.organizationId, data.sports);
    return { ok: true };
  });

/* ============================ Resources ============================ */

export type OrgResourceRow = {
  id: string;
  sport: string;
  title: string;
  description: string;
  kind: "pdf" | "image" | "link";
  externalUrl: string | null;
  storagePath: string | null;
  source: "gradus" | "club";
  archived: boolean;
  reviewState: string;
  edited: boolean;
  ack: { audiences: string[]; version: number; done: number; total: number } | null;
};

export const listOrgResources = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => orgOnly.parse(i))
  .handler(async ({ data, context }): Promise<{ sports: string[]; resources: OrgResourceRow[] }> => {
    const orgId = data.organizationId;
    const admin = await assertOrgAdmin(context.supabase as Client, context.userId, orgId);
    const { orgSports, ackRoster } = await import("./org-content.server");
    const sports = await orgSports(admin, orgId);
    if (!sports.length) return { sports, resources: [] };

    const [lib, club, overrides, reqs] = await Promise.all([
      admin
        .from("resources")
        .select("id, sport, title, description, kind, external_url, storage_path, review_state")
        .is("coach_id", null)
        .is("organization_id", null)
        .eq("published", true)
        .in("sport", sports)
        .order("display_order")
        .order("title"),
      admin
        .from("resources")
        .select("id, sport, title, description, kind, external_url, storage_path, review_state")
        .eq("organization_id", orgId)
        .eq("is_org_template", true)
        .is("coach_id", null)
        .in("sport", sports)
        .order("created_at", { ascending: false }),
      admin
        .from("org_resource_overrides")
        .select("resource_id, title, description, archived_at")
        .eq("organization_id", orgId),
      admin
        .from("resource_ack_requirements")
        .select("resource_id, audiences, version")
        .eq("organization_id", orgId),
    ]);
    for (const r of [lib, club, overrides, reqs]) if (r.error) dbError(r.error);
    const ov = new Map((overrides.data ?? []).map((o) => [o.resource_id, o]));
    const req = new Map((reqs.data ?? []).map((r) => [r.resource_id, r]));

    const rows: OrgResourceRow[] = [];
    for (const [source, list] of [
      ["club", club.data ?? []],
      ["gradus", lib.data ?? []],
    ] as const) {
      for (const r of list) {
        const o = ov.get(r.id);
        const rq = req.get(r.id);
        let ack: OrgResourceRow["ack"] = null;
        if (rq && rq.audiences.length) {
          const roster = await ackRoster(admin, orgId, r.id, rq.audiences as never, rq.version);
          ack = {
            audiences: rq.audiences,
            version: rq.version,
            done: roster.filter((s) => s.acknowledgedAt).length,
            total: roster.length,
          };
        }
        rows.push({
          id: r.id,
          sport: r.sport,
          title: o?.title ?? r.title,
          description: o?.description ?? r.description ?? "",
          kind: (r.kind as OrgResourceRow["kind"]) ?? "pdf",
          externalUrl: r.external_url,
          storagePath: r.storage_path,
          source,
          archived: !!o?.archived_at,
          reviewState: r.review_state,
          edited: source === "gradus" && !!(o?.title || o?.description),
          ack,
        });
      }
    }
    return { sports, resources: rows };
  });

export const createOrgResourceUploadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    orgOnly.extend({ contentType: z.string().max(100) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const admin = await assertOrgAdmin(context.supabase as Client, context.userId, data.organizationId);
    if (data.contentType.split(";")[0].trim().toLowerCase() !== "application/pdf") {
      throw new Error("Choose a PDF file.");
    }
    const path = `org/${data.organizationId}/${crypto.randomUUID()}.pdf`;
    const { data: signed, error } = await admin.storage
      .from("resource-pdfs")
      .createSignedUploadUrl(path);
    if (error || !signed) throw new Error("Could not start the upload. Try again.");
    return { path, token: signed.token };
  });

const saveResourceInput = orgOnly.extend({
  id: z.string().uuid().optional(),
  sport: z.string().min(1).max(64),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(2000).default(""),
  kind: z.enum(["pdf", "link"]).optional(),
  storagePath: z.string().max(300).optional(),
  externalUrl: z.string().url().max(1000).optional(),
});

export const saveOrgResource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => saveResourceInput.parse(i))
  .handler(async ({ data, context }) => {
    const orgId = data.organizationId;
    const admin = await assertOrgAdmin(context.supabase as Client, context.userId, orgId);
    const { orgSports, bumpContentVersion } = await import("./org-content.server");
    if (!(await orgSports(admin, orgId)).includes(data.sport)) {
      throw new Error("That sport isn't part of your club.");
    }
    if (data.storagePath && !data.storagePath.startsWith(`org/${orgId}/`)) {
      throw new Error("Upload not found.");
    }

    let resourceId = data.id;
    let fileChanged = false;
    if (resourceId) {
      const { data: row, error } = await admin
        .from("resources")
        .select("id, coach_id, organization_id, is_org_template, storage_path")
        .eq("id", resourceId)
        .maybeSingle();
      if (error) dbError(error);
      if (!row || row.coach_id) throw new Error("Resource not found.");
      if (!row.organization_id) {
        // Gradus document: the club's edit is an override.
        const up = await admin.from("org_resource_overrides").upsert(
          {
            organization_id: orgId,
            resource_id: resourceId,
            title: data.title,
            description: data.description,
            updated_at: new Date().toISOString(),
            updated_by: context.userId,
          },
          { onConflict: "organization_id,resource_id" },
        );
        if (up.error) dbError(up.error);
      } else {
        if (row.organization_id !== orgId || !row.is_org_template) {
          throw new Error("Resource not found.");
        }
        fileChanged = !!data.storagePath && data.storagePath !== row.storage_path;
        const patch: Database["public"]["Tables"]["resources"]["Update"] = {
          title: data.title,
          description: data.description,
          sport: data.sport,
          updated_by: context.userId,
          updated_at: new Date().toISOString(),
        };
        if (data.kind === "link" && data.externalUrl) {
          patch.kind = "link";
          patch.external_url = data.externalUrl;
          patch.storage_path = null;
          patch.review_state = "released";
        } else if (fileChanged) {
          patch.kind = "pdf";
          patch.storage_path = data.storagePath;
          patch.external_url = null;
          patch.review_state = "pending_check";
        }
        const up = await admin.from("resources").update(patch).eq("id", resourceId);
        if (up.error) dbError(up.error);
      }
    } else {
      if (data.kind === "link" ? !data.externalUrl : !data.storagePath) {
        throw new Error(data.kind === "link" ? "Add a link." : "Choose a PDF.");
      }
      const ins = await admin
        .from("resources")
        .insert({
          sport: data.sport,
          title: data.title,
          description: data.description,
          kind: data.kind ?? "pdf",
          storage_path: data.kind === "link" ? null : data.storagePath!,
          external_url: data.kind === "link" ? data.externalUrl! : null,
          organization_id: orgId,
          is_org_template: true,
          coach_id: null,
          // Club items reach members only through the club merge.
          published: false,
          rights: "licensed",
          review_state: data.kind === "link" ? "released" : "pending_check",
          display_order: 0,
          updated_by: context.userId,
        })
        .select("id")
        .single();
      if (ins.error) dbError(ins.error);
      resourceId = ins.data.id;
      fileChanged = data.kind !== "link";
    }

    let reviewState: string | null = null;
    if (fileChanged && data.storagePath) {
      const { checkStoredUpload } = await import("./coach-upload-review.server");
      const outcome = await checkStoredUpload(admin, data.storagePath);
      if (outcome.outcome === "not_pdf") {
        await admin.storage.from("resource-pdfs").remove([data.storagePath]);
        if (!data.id) await admin.from("resources").delete().eq("id", resourceId!);
        throw new Error("That file isn't a PDF. Choose a PDF file.");
      }
      reviewState = outcome.outcome === "released" ? "released" : "held";
      const up = await admin
        .from("resources")
        .update({
          review_state: reviewState,
          review_reason: outcome.outcome === "held" ? outcome.reason : null,
        })
        .eq("id", resourceId!);
      if (up.error) dbError(up.error);
    }
    await bumpContentVersion(admin, orgId);
    return { id: resourceId!, reviewState, fileChanged };
  });

export const setOrgResourcesArchived = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    orgOnly
      .extend({ resourceIds: z.array(z.string().uuid()).min(1).max(500), archived: z.boolean() })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const orgId = data.organizationId;
    const admin = await assertOrgAdmin(context.supabase as Client, context.userId, orgId);
    const { data: rows, error } = await admin
      .from("resources")
      .select("id, organization_id, coach_id")
      .in("id", data.resourceIds);
    if (error) dbError(error);
    const allowed = (rows ?? []).filter(
      (r) => !r.coach_id && (r.organization_id === null || r.organization_id === orgId),
    );
    const now = new Date().toISOString();
    for (const r of allowed) {
      const up = await admin.from("org_resource_overrides").upsert(
        {
          organization_id: orgId,
          resource_id: r.id,
          archived_at: data.archived ? now : null,
          updated_at: now,
          updated_by: context.userId,
        },
        { onConflict: "organization_id,resource_id" },
      );
      if (up.error) dbError(up.error);
    }
    const { bumpContentVersion } = await import("./org-content.server");
    await bumpContentVersion(admin, orgId);
    return { count: allowed.length };
  });

/* ============================ Acknowledgements ============================ */

async function loadClubResource(admin: Awaited<ReturnType<typeof assertOrgAdmin>>, orgId: string, id: string) {
  const { data, error } = await admin
    .from("resources")
    .select("id, title, organization_id, is_org_template, coach_id")
    .eq("id", id)
    .maybeSingle();
  if (error) dbError(error);
  if (!data || data.coach_id || data.organization_id !== orgId || !data.is_org_template) {
    throw new Error("Acknowledgement can be required on your club's own documents.");
  }
  return data;
}

export const setResourceAckRequirement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    orgOnly
      .extend({
        resourceId: z.string().uuid(),
        audiences: z.array(audienceSchema).max(3),
        askAgain: z.boolean().default(false),
        notify: z.boolean().default(true),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const orgId = data.organizationId;
    const admin = await assertOrgAdmin(context.supabase as Client, context.userId, orgId);
    const res = await loadClubResource(admin, orgId, data.resourceId);
    const { data: existing, error } = await admin
      .from("resource_ack_requirements")
      .select("version, audiences")
      .eq("resource_id", res.id)
      .maybeSingle();
    if (error) dbError(error);
    const audiences = Array.from(new Set(data.audiences));
    const version = existing ? existing.version + (data.askAgain ? 1 : 0) : 1;
    const up = await admin.from("resource_ack_requirements").upsert(
      {
        resource_id: res.id,
        organization_id: orgId,
        audiences,
        version,
        required_at: !existing || data.askAgain ? new Date().toISOString() : undefined,
        updated_by: context.userId,
      },
      { onConflict: "resource_id" },
    );
    if (up.error) dbError(up.error);

    let notified = 0;
    if (data.notify && audiences.length) {
      notified = await notifyOutstanding(admin, orgId, res.id, res.title, audiences, version);
    }
    return { version, notified };
  });

async function notifyOutstanding(
  admin: Awaited<ReturnType<typeof assertOrgAdmin>>,
  orgId: string,
  resourceId: string,
  title: string,
  audiences: string[],
  version: number,
): Promise<number> {
  const { ackRoster, outstandingUserIds } = await import("./org-content.server");
  const roster = await ackRoster(admin, orgId, resourceId, audiences as never, version);
  const ids = await outstandingUserIds(admin, roster);
  if (!ids.length) return 0;
  try {
    const { notifyUsers } = await import("./push-notify.server");
    await notifyUsers(admin, ids, {
      type: "resource_ack",
      route: "resources",
      title: "Please acknowledge",
      body: `Your club asks you to read and acknowledge "${title}".`,
      collapseId: `ack:${resourceId}:${version}`,
    });
  } catch (err) {
    console.error("[ack] push failed", err);
  }
  return ids.length;
}

export const getResourceAckStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => orgOnly.extend({ resourceId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const orgId = data.organizationId;
    const admin = await assertOrgAdmin(context.supabase as Client, context.userId, orgId);
    await loadClubResource(admin, orgId, data.resourceId);
    const { data: req, error } = await admin
      .from("resource_ack_requirements")
      .select("audiences, version, required_at")
      .eq("resource_id", data.resourceId)
      .maybeSingle();
    if (error) dbError(error);
    if (!req) return { requirement: null, signers: [], history: [] };
    const { ackRoster } = await import("./org-content.server");
    const signers = await ackRoster(
      admin,
      orgId,
      data.resourceId,
      req.audiences as never,
      req.version,
    );
    const { data: hist, error: hErr } = await admin
      .from("resource_acknowledgements")
      .select("version, signer_name, role, acknowledged_at, acted_for_athlete_id")
      .eq("resource_id", data.resourceId)
      .lt("version", req.version)
      .order("acknowledged_at", { ascending: false })
      .limit(500);
    if (hErr) dbError(hErr);
    return {
      requirement: { audiences: req.audiences, version: req.version, requiredAt: req.required_at },
      signers,
      history: hist ?? [],
    };
  });

export const remindOutstandingAcks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => orgOnly.extend({ resourceId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const orgId = data.organizationId;
    const admin = await assertOrgAdmin(context.supabase as Client, context.userId, orgId);
    const res = await loadClubResource(admin, orgId, data.resourceId);
    const { data: req, error } = await admin
      .from("resource_ack_requirements")
      .select("audiences, version")
      .eq("resource_id", res.id)
      .maybeSingle();
    if (error) dbError(error);
    if (!req) throw new Error("This document doesn't require acknowledgement.");
    return { notified: await notifyOutstanding(admin, orgId, res.id, res.title, req.audiences, req.version) };
  });

/** Signed-in member: club documents waiting for their acknowledgement. */
export const listMyPendingAcknowledgements = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { resolveMembership, pendingAcksFor } = await import("./org-content.server");
    const m = await resolveMembership(supabaseAdmin, context.userId);
    if (!m) return { pending: [] };
    return { pending: await pendingAcksFor(supabaseAdmin, m) };
  });

export const acknowledgeResource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        resourceId: z.string().uuid(),
        version: z.number().int().min(1),
        forAthleteId: z.string().uuid().nullable(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { resolveMembership, pendingAcksFor } = await import("./org-content.server");
    const m = await resolveMembership(supabaseAdmin, context.userId);
    if (!m) throw new Error("Nothing to acknowledge.");
    const pending = await pendingAcksFor(supabaseAdmin, m);
    const item = pending.find(
      (p) =>
        p.resourceId === data.resourceId &&
        p.version === data.version &&
        p.forAthleteId === data.forAthleteId,
    );
    if (!item) return { ok: true, already: true };
    const { data: req, error } = await supabaseAdmin
      .from("resource_ack_requirements")
      .select("organization_id")
      .eq("resource_id", data.resourceId)
      .single();
    if (error) dbError(error);
    const ins = await supabaseAdmin.from("resource_acknowledgements").insert({
      resource_id: data.resourceId,
      organization_id: req.organization_id,
      version: data.version,
      user_id: context.userId,
      role: m.role,
      signer_name: m.name,
      acted_for_athlete_id: data.forAthleteId,
    });
    if (ins.error && ins.error.code !== "23505") dbError(ins.error);
    return { ok: true, already: false };
  });

/** Signed URL for a club document a member is acknowledging. */
export const getClubResourceUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ resourceId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { callerCanOpenClubResource } = await import("./org-content.server");
    if (!(await callerCanOpenClubResource(supabaseAdmin, context.userId, data.resourceId))) {
      throw new Error("Resource not found");
    }
    const { data: row, error } = await supabaseAdmin
      .from("resources")
      .select("kind, storage_path, external_url")
      .eq("id", data.resourceId)
      .single();
    if (error) dbError(error);
    if (row.kind === "link" && row.external_url) return { url: row.external_url };
    if (!row.storage_path) throw new Error("Resource not found");
    const { data: signed, error: sErr } = await supabaseAdmin.storage
      .from("resource-pdfs")
      .createSignedUrl(row.storage_path, 60 * 5);
    if (sErr || !signed) throw new Error("Could not open the document.");
    return { url: signed.signedUrl };
  });

/* ============================ Moves ============================ */

export type OrgMoveRow = {
  /** `seed:<id>` or `club:<id>`. */
  key: string;
  source: "gradus" | "club";
  sport: string;
  category: string;
  name: string;
  description: string;
  cue: string;
  why: string;
  defaultTargetKind: "reps" | "mins";
  defaultTargetValue: number;
  archived: boolean;
  edited: boolean;
};

export const listOrgMoves = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => orgOnly.parse(i))
  .handler(async ({ data, context }): Promise<{ sports: string[]; moves: OrgMoveRow[] }> => {
    const orgId = data.organizationId;
    const admin = await assertOrgAdmin(context.supabase as Client, context.userId, orgId);
    const { orgSports } = await import("./org-content.server");
    const sports = await orgSports(admin, orgId);
    if (!sports.length) return { sports, moves: [] };
    const [seeds, ovs, club] = await Promise.all([
      admin.from("seed_moves").select("*").in("sport", sports),
      admin.from("org_move_overrides").select("*").eq("organization_id", orgId),
      admin
        .from("moves")
        .select("*")
        .eq("organization_id", orgId)
        .eq("is_org_template", true)
        .is("coach_id", null)
        .in("sport", sports),
    ]);
    for (const r of [seeds, ovs, club]) if (r.error) dbError(r.error);
    const ov = new Map((ovs.data ?? []).map((o) => [o.seed_move_id, o]));
    const moves: OrgMoveRow[] = [
      ...(club.data ?? []).map((m) => ({
        key: `club:${m.id}`,
        source: "club" as const,
        sport: m.sport,
        category: m.category,
        name: m.name,
        description: m.description,
        cue: m.cue,
        why: m.why,
        defaultTargetKind: m.default_target_kind as "reps" | "mins",
        defaultTargetValue: Number(m.default_target_value),
        archived: !!m.archived_at,
        edited: false,
      })),
      ...(seeds.data ?? []).map((s) => {
        const o = ov.get(s.id);
        return {
          key: `seed:${s.id}`,
          source: "gradus" as const,
          sport: s.sport,
          category: o?.category ?? s.category,
          name: o?.name ?? s.name,
          description: o?.description ?? s.description,
          cue: o?.cue ?? s.cue,
          why: o?.why ?? s.why,
          defaultTargetKind: (o?.default_target_kind ?? s.default_target_kind) as "reps" | "mins",
          defaultTargetValue: Number(o?.default_target_value ?? s.default_target_value),
          archived: !!o?.archived_at,
          edited: !!o && !!(o.name || o.category || o.description || o.cue || o.why || o.default_target_kind),
        };
      }),
    ];
    moves.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
    return { sports, moves };
  });

const movePatch = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  category: z.string().trim().min(1).max(64).optional(),
  description: z.string().max(2000).optional(),
  cue: z.string().max(1000).optional(),
  why: z.string().max(1000).optional(),
  defaultTargetKind: z.enum(["reps", "mins"]).optional(),
  defaultTargetValue: z.number().min(0).max(10000).optional(),
  archived: z.boolean().optional(),
});

export const updateOrgMoves = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    orgOnly.extend({ keys: z.array(z.string()).min(1).max(1000), patch: movePatch }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const orgId = data.organizationId;
    const admin = await assertOrgAdmin(context.supabase as Client, context.userId, orgId);
    const p = data.patch;
    const now = new Date().toISOString();
    const fields = {
      ...(p.name !== undefined && { name: p.name }),
      ...(p.category !== undefined && { category: p.category }),
      ...(p.description !== undefined && { description: p.description }),
      ...(p.cue !== undefined && { cue: p.cue }),
      ...(p.why !== undefined && { why: p.why }),
      ...(p.defaultTargetKind !== undefined && { default_target_kind: p.defaultTargetKind }),
      ...(p.defaultTargetValue !== undefined && { default_target_value: p.defaultTargetValue }),
    };
    const archive = p.archived === undefined ? {} : { archived_at: p.archived ? now : null };
    const seedIds = data.keys.filter((k) => k.startsWith("seed:")).map((k) => k.slice(5));
    const clubIds = data.keys.filter((k) => k.startsWith("club:")).map((k) => k.slice(5));

    if (seedIds.length) {
      const { data: existing, error } = await admin
        .from("org_move_overrides")
        .select("seed_move_id")
        .eq("organization_id", orgId)
        .in("seed_move_id", seedIds);
      if (error) dbError(error);
      const have = new Set((existing ?? []).map((e) => e.seed_move_id));
      const toUpdate = seedIds.filter((id) => have.has(id));
      const toInsert = seedIds.filter((id) => !have.has(id));
      if (toUpdate.length) {
        const r = await admin
          .from("org_move_overrides")
          .update({ ...fields, ...archive, updated_at: now, updated_by: context.userId })
          .eq("organization_id", orgId)
          .in("seed_move_id", toUpdate);
        if (r.error) dbError(r.error);
      }
      if (toInsert.length) {
        const r = await admin.from("org_move_overrides").insert(
          toInsert.map((id) => ({
            organization_id: orgId,
            seed_move_id: id,
            ...fields,
            ...archive,
            updated_by: context.userId,
          })),
        );
        if (r.error) dbError(r.error);
      }
    }
    if (clubIds.length) {
      const r = await admin
        .from("moves")
        .update({ ...fields, ...archive, updated_at: now })
        .eq("organization_id", orgId)
        .eq("is_org_template", true)
        .is("coach_id", null)
        .in("id", clubIds);
      if (r.error) dbError(r.error);
    }
    const { bumpContentVersion } = await import("./org-content.server");
    await bumpContentVersion(admin, orgId);
    return { count: data.keys.length };
  });

const importRow = z.object({
  sport: z.string().min(1).max(64),
  category: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).default(""),
  cue: z.string().max(1000).default(""),
  why: z.string().max(1000).default(""),
  defaultTargetKind: z.enum(["reps", "mins"]).default("reps"),
  defaultTargetValue: z.number().min(0).max(10000).default(10),
});

/** Bulk upload: a name matching a club or Gradus move in that sport updates it; others are added. */
export const importOrgMoves = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    orgOnly.extend({ moves: z.array(importRow).min(1).max(500) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const orgId = data.organizationId;
    const admin = await assertOrgAdmin(context.supabase as Client, context.userId, orgId);
    const { orgSports, bumpContentVersion } = await import("./org-content.server");
    const sports = await orgSports(admin, orgId);
    const [seeds, club] = await Promise.all([
      admin.from("seed_moves").select("id, sport, name").in("sport", sports),
      admin
        .from("moves")
        .select("id, sport, name")
        .eq("organization_id", orgId)
        .eq("is_org_template", true)
        .is("coach_id", null),
    ]);
    if (seeds.error) dbError(seeds.error);
    if (club.error) dbError(club.error);
    const n = (s: string) => s.trim().toLowerCase();
    let created = 0;
    let updated = 0;
    let skipped = 0;
    const seen = new Set<string>();
    const now = new Date().toISOString();
    for (const m of data.moves) {
      const k = `${m.sport}|${n(m.name)}`;
      if (!sports.includes(m.sport) || seen.has(k)) {
        skipped++;
        continue;
      }
      seen.add(k);
      const fields = {
        category: m.category,
        name: m.name,
        description: m.description,
        cue: m.cue,
        why: m.why,
        default_target_kind: m.defaultTargetKind,
        default_target_value: m.defaultTargetValue,
      };
      const c = (club.data ?? []).find((x) => x.sport === m.sport && n(x.name) === n(m.name));
      const s = (seeds.data ?? []).find((x) => x.sport === m.sport && n(x.name) === n(m.name));
      if (c) {
        const r = await admin.from("moves").update({ ...fields, updated_at: now }).eq("id", c.id);
        if (r.error) dbError(r.error);
        updated++;
      } else if (s) {
        const r = await admin.from("org_move_overrides").upsert(
          { organization_id: orgId, seed_move_id: s.id, ...fields, updated_at: now, updated_by: context.userId },
          { onConflict: "organization_id,seed_move_id" },
        );
        if (r.error) dbError(r.error);
        updated++;
      } else {
        const r = await admin.from("moves").insert({
          ...fields,
          sport: m.sport,
          organization_id: orgId,
          is_org_template: true,
          coach_id: null,
        });
        if (r.error) dbError(r.error);
        created++;
      }
    }
    if (created || updated) await bumpContentVersion(admin, orgId);
    return { created, updated, skipped };
  });

/* ============================ Levels ============================ */

export type OrgLevelRow = {
  sport: string;
  levelKey: string;
  label: string;
  sortOrder: number;
  practiceHoursPerWeek: number;
  isCustom: boolean;
  archived: boolean;
};

export const listOrgLevels = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => orgOnly.parse(i))
  .handler(async ({ data, context }): Promise<{ sports: string[]; levels: OrgLevelRow[] }> => {
    const orgId = data.organizationId;
    const admin = await assertOrgAdmin(context.supabase as Client, context.userId, orgId);
    const { orgSports } = await import("./org-content.server");
    const { SPORTS } = await import("./coach-sports");
    const sports = await orgSports(admin, orgId);
    const { data: rows, error } = await admin
      .from("org_levels")
      .select("*")
      .eq("organization_id", orgId);
    if (error) dbError(error);
    const levels: OrgLevelRow[] = [];
    for (const sport of sports) {
      const catalog = SPORTS.find((s) => s.key === sport)?.levels ?? [];
      const mine = (rows ?? []).filter((r) => r.sport === sport);
      catalog.forEach((l, i) => {
        const r = mine.find((x) => x.level_key === l.key);
        levels.push({
          sport,
          levelKey: l.key,
          label: r?.label ?? l.label,
          sortOrder: r?.sort_order ?? i * 10,
          practiceHoursPerWeek: r ? Number(r.practice_hours_per_week) : l.suggestedHours,
          isCustom: false,
          archived: !!r?.archived_at,
        });
      });
      for (const r of mine.filter((x) => x.is_custom)) {
        levels.push({
          sport,
          levelKey: r.level_key,
          label: r.label,
          sortOrder: r.sort_order,
          practiceHoursPerWeek: Number(r.practice_hours_per_week),
          isCustom: true,
          archived: !!r.archived_at,
        });
      }
    }
    levels.sort((a, b) => a.sport.localeCompare(b.sport) || a.sortOrder - b.sortOrder);
    return { sports, levels };
  });

export const saveOrgLevels = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    orgOnly
      .extend({
        sport: z.string().min(1).max(64),
        levels: z
          .array(
            z.object({
              levelKey: z.string().max(80).optional(),
              label: z.string().trim().min(1).max(80),
              practiceHoursPerWeek: z.number().min(0).max(80),
              archived: z.boolean().default(false),
            }),
          )
          .max(60),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const orgId = data.organizationId;
    const admin = await assertOrgAdmin(context.supabase as Client, context.userId, orgId);
    const { orgSports, bumpContentVersion } = await import("./org-content.server");
    const { SPORTS } = await import("./coach-sports");
    if (!(await orgSports(admin, orgId)).includes(data.sport)) {
      throw new Error("That sport isn't part of your club.");
    }
    const catalogKeys = new Set(
      (SPORTS.find((s) => s.key === data.sport)?.levels ?? []).map((l) => l.key),
    );
    const now = new Date().toISOString();
    const rows = data.levels.map((l, i) => {
      const key =
        l.levelKey ||
        `club_${l.label.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40)}_${crypto
          .randomUUID()
          .slice(0, 5)}`;
      return {
        organization_id: orgId,
        sport: data.sport,
        level_key: key,
        label: l.label,
        sort_order: i * 10,
        practice_hours_per_week: l.practiceHoursPerWeek,
        is_custom: !catalogKeys.has(key),
        archived_at: l.archived ? now : null,
        updated_at: now,
      };
    });
    if (rows.length) {
      const r = await admin
        .from("org_levels")
        .upsert(rows, { onConflict: "organization_id,sport,level_key" });
      if (r.error) dbError(r.error);
    }
    await bumpContentVersion(admin, orgId);
    return { ok: true };
  });
