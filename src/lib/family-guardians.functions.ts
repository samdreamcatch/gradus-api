/**
 * Family plan — co-guardian management.
 *
 * A primary parent on an active Family plan can invite additional parents or
 * guardians to an athlete. Invitees accept by link (token) or by entering the
 * invite code in their own settings. Co-guardians get full parity with the
 * primary parent while the plan is active, and go view-only if it lapses.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dbError } from "./db-error";

const INVITE_TTL_DAYS = 30;

async function getAdmin() {
  const m = await import("@/integrations/supabase/client.server");
  return m.supabaseAdmin;
}

async function parentProfile(userId: string) {
  const admin = await getAdmin();
  const res = await admin
    .from("parent_profiles")
    .select("id, first_name, last_name")
    .eq("user_id", userId)
    .maybeSingle();
  if (res.error) dbError(res.error);
  if (!res.data) throw new Error("Parent profile not found.");
  return res.data as { id: string; first_name: string; last_name: string };
}

async function assertPrimary(parentId: string, athleteId: string) {
  const admin = await getAdmin();
  const res = await admin
    .from("athletes")
    .select("id, first_name, last_name, parent_id")
    .eq("id", athleteId)
    .maybeSingle();
  if (res.error) dbError(res.error);
  const row = res.data as
    | { id: string; first_name: string; last_name: string; parent_id: string | null }
    | null;
  if (!row || row.parent_id !== parentId) {
    throw new Error("Only the primary parent can manage guardians for this athlete.");
  }
  return row;
}

/** Guardians + pending invites for each athlete the caller is primary on. */
export const listFamilyGuardians = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = await getAdmin();
    const { familyPlanActive } = await import("./family.server");
    const parent = await parentProfile(context.userId);
    const planActive = await familyPlanActive(admin, parent.id);

    const athletesRes = await admin
      .from("athletes")
      .select("id, first_name, last_name")
      .eq("parent_id", parent.id)
      .order("created_at", { ascending: true });
    if (athletesRes.error) dbError(athletesRes.error);
    const athletes = (athletesRes.data ?? []) as {
      id: string;
      first_name: string;
      last_name: string;
    }[];
    const ids = athletes.length ? athletes.map((a) => a.id) : ["00000000-0000-0000-0000-000000000000"];

    const [linksRes, invitesRes] = await Promise.all([
      admin
        .from("athlete_guardians")
        .select("id, athlete_id, parent_id, role, created_at")
        .in("athlete_id", ids),
      admin
        .from("guardian_invites")
        .select("id, athlete_id, email, code, status, created_at, expires_at")
        .in("athlete_id", ids)
        .eq("status", "pending"),
    ]);
    if (linksRes.error) dbError(linksRes.error);
    if (invitesRes.error) dbError(invitesRes.error);

    const links = (linksRes.data ?? []) as {
      id: string;
      athlete_id: string;
      parent_id: string;
      role: string;
      created_at: string;
    }[];
    const parentIds = Array.from(new Set(links.map((l) => l.parent_id)));
    const profilesRes = parentIds.length
      ? await admin.from("parent_profiles").select("id, first_name, last_name").in("id", parentIds)
      : { data: [], error: null };
    const nameById = new Map(
      ((profilesRes.data ?? []) as { id: string; first_name: string; last_name: string }[]).map(
        (p) => [p.id, `${p.first_name} ${p.last_name}`.trim()],
      ),
    );

    return {
      planActive,
      athletes: athletes.map((a) => ({
        id: a.id,
        firstName: a.first_name,
        lastName: a.last_name,
        guardians: links
          .filter((l) => l.athlete_id === a.id)
          .map((l) => ({
            id: l.id,
            parentId: l.parent_id,
            name: nameById.get(l.parent_id) ?? "Guardian",
            role: l.role as "primary" | "co",
            isSelf: l.parent_id === parent.id,
          }))
          .sort((x, y) => (x.role === "primary" ? -1 : y.role === "primary" ? 1 : 0)),
        invites: (invitesRes.data ?? [])
          .filter((i: any) => i.athlete_id === a.id)
          .map((i: any) => ({
            id: i.id as string,
            email: (i.email as string | null) ?? null,
            code: i.code as string,
            createdAt: i.created_at as string,
            expiresAt: (i.expires_at as string | null) ?? null,
          })),
      })),
    };
  });

/** Create a guardian invite (optionally emailing it). Requires an active plan. */
export const inviteGuardian = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        athleteId: z.string().uuid(),
        email: z.string().trim().email().max(200).optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const admin = await getAdmin();
    const { familyPlanActive, newInviteCode, newInviteToken } = await import("./family.server");
    const parent = await parentProfile(context.userId);
    const athlete = await assertPrimary(parent.id, data.athleteId);

    if (!(await familyPlanActive(admin, parent.id))) {
      throw new Error("Start the Family plan to add another parent or guardian.");
    }

    const token = newInviteToken();
    let code = "";
    let inviteId = "";
    for (let attempt = 0; attempt < 5; attempt++) {
      code = newInviteCode(8);
      const ins = await admin
        .from("guardian_invites")
        .insert({
          athlete_id: data.athleteId,
          invited_by_parent_id: parent.id,
          email: data.email ?? null,
          code,
          token,
          status: "pending",
          expires_at: new Date(Date.now() + INVITE_TTL_DAYS * 86400_000).toISOString(),
        })
        .select("id")
        .maybeSingle();
      if (!ins.error && ins.data) {
        inviteId = ins.data.id as string;
        break;
      }
      if (attempt === 4) dbError(ins.error ?? new Error("Could not create invite."));
    }

    if (data.email) {
      const { sendFamilyInvite } = await import("./family-emails.server");
      await sendFamilyInvite({
        to: data.email,
        athleteName: `${athlete.first_name} ${athlete.last_name}`.trim(),
        inviterName: `${parent.first_name} ${parent.last_name}`.trim(),
        token,
        code,
      });
    }

    return { ok: true, inviteId, code, token };
  });

export const revokeGuardianInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ inviteId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const admin = await getAdmin();
    const parent = await parentProfile(context.userId);
    const upd = await admin
      .from("guardian_invites")
      .update({ status: "revoked", updated_at: new Date().toISOString() })
      .eq("id", data.inviteId)
      .eq("invited_by_parent_id", parent.id)
      .eq("status", "pending");
    if (upd.error) dbError(upd.error);
    return { ok: true };
  });

/** Remove a co-guardian. Primary parents cannot be removed. */
export const removeGuardian = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ athleteId: z.string().uuid(), parentId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const admin = await getAdmin();
    const parent = await parentProfile(context.userId);
    // Either the primary parent removes someone, or a co-guardian removes themselves.
    if (data.parentId !== parent.id) await assertPrimary(parent.id, data.athleteId);
    const del = await admin
      .from("athlete_guardians")
      .delete()
      .eq("athlete_id", data.athleteId)
      .eq("parent_id", data.parentId)
      .eq("role", "co");
    if (del.error) dbError(del.error);
    return { ok: true };
  });

/** Public-ish preview of an invite (token or code) so the claim page can render. */
export const previewGuardianInvite = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        token: z.string().trim().min(6).max(120).optional(),
        code: z.string().trim().min(4).max(20).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    if (!data.token && !data.code) throw new Error("Missing invite.");
    const admin = await getAdmin();
    let q = admin
      .from("guardian_invites")
      .select("id, athlete_id, status, expires_at, invited_by_parent_id")
      .eq("status", "pending");
    q = data.token ? q.eq("token", data.token) : q.eq("code", (data.code ?? "").toUpperCase());
    const res = await q.maybeSingle();
    if (res.error) dbError(res.error);
    const invite = res.data as
      | {
          id: string;
          athlete_id: string;
          status: string;
          expires_at: string | null;
          invited_by_parent_id: string;
        }
      | null;
    if (!invite) return { found: false as const };
    if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
      return { found: false as const };
    }

    const [athleteRes, inviterRes] = await Promise.all([
      admin.from("athletes").select("first_name, last_name").eq("id", invite.athlete_id).maybeSingle(),
      admin
        .from("parent_profiles")
        .select("first_name, last_name")
        .eq("id", invite.invited_by_parent_id)
        .maybeSingle(),
    ]);
    const a = athleteRes.data as { first_name: string; last_name: string } | null;
    const p = inviterRes.data as { first_name: string; last_name: string } | null;
    return {
      found: true as const,
      athleteName: a ? `${a.first_name} ${a.last_name}`.trim() : "an athlete",
      inviterName: p ? `${p.first_name} ${p.last_name}`.trim() : "A parent",
    };
  });

/** Accept an invite as the signed-in parent. Creates a parent profile if needed. */
export const claimGuardianInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        token: z.string().trim().min(6).max(120).optional(),
        code: z.string().trim().min(4).max(20).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    if (!data.token && !data.code) throw new Error("Missing invite.");
    const admin = await getAdmin();

    let q = admin
      .from("guardian_invites")
      .select("id, athlete_id, status, expires_at, invited_by_parent_id")
      .eq("status", "pending");
    q = data.token ? q.eq("token", data.token) : q.eq("code", (data.code ?? "").toUpperCase());
    const res = await q.maybeSingle();
    if (res.error) dbError(res.error);
    const invite = res.data as
      | { id: string; athlete_id: string; expires_at: string | null; invited_by_parent_id: string }
      | null;
    if (!invite) throw new Error("That invite is no longer valid.");
    if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
      throw new Error("That invite has expired. Ask them to send a new one.");
    }

    // Resolve (or create) the claimer's parent profile.
    const existing = await admin
      .from("parent_profiles")
      .select("id")
      .eq("user_id", context.userId)
      .maybeSingle();
    let parentId = (existing.data as { id: string } | null)?.id ?? null;
    if (!parentId) {
      const meta = (context.claims as Record<string, any> | undefined) ?? {};
      const fullName: string = meta["name"] ?? meta["user_metadata"]?.full_name ?? "";
      const [first, ...rest] = fullName.trim().split(/\s+/);
      const ins = await admin
        .from("parent_profiles")
        .insert({
          user_id: context.userId,
          first_name: first || "Parent",
          last_name: rest.join(" ") || "",
        })
        .select("id")
        .maybeSingle();
      if (ins.error) dbError(ins.error);
      parentId = (ins.data as { id: string }).id;
    }

    if (parentId === invite.invited_by_parent_id) {
      throw new Error("You're already the primary parent for this athlete.");
    }

    const link = await admin
      .from("athlete_guardians")
      .upsert(
        { athlete_id: invite.athlete_id, parent_id: parentId, role: "co" },
        { onConflict: "athlete_id,parent_id" },
      );
    if (link.error) dbError(link.error);

    const upd = await admin
      .from("guardian_invites")
      .update({
        status: "claimed",
        claimed_by: parentId,
        claimed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", invite.id);
    if (upd.error) dbError(upd.error);

    return { ok: true, athleteId: invite.athlete_id };
  });
