import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { dbError } from "./db-error";

type Client = SupabaseClient<Database>;

// Same Crockford-style alphabet used elsewhere in the app for invite codes.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function generateInviteCode(len = 10): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}
function generateToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Returns the orgs where the signed-in user is an admin. Throws if none. */
async function loadAdminOrgs(supabase: Client, userId: string) {
  const { data, error } = await supabase
    .from("org_admins")
    .select("organization_id, organizations!inner(id, name, logo_url, city, region)")
    .eq("user_id", userId);
  if (error) dbError(error);
  const rows = (data ?? []).map((r) => {
    const org = r.organizations as {
      id: string;
      name: string;
      logo_url: string | null;
      city: string | null;
      region: string | null;
    };
    return {
      id: org.id,
      name: org.name,
      logoUrl: org.logo_url,
      city: org.city,
      region: org.region,
    };
  });
  return rows;
}

async function assertOrgAdmin(supabase: Client, userId: string, orgId: string): Promise<void> {
  const { data, error } = await supabase.rpc("has_org_admin", {
    _user_id: userId,
    _org_id: orgId,
  });
  if (error) dbError(error);
  if (!data) throw new Error("Not authorized for this organization");
}

/* ============================ Context ============================ */

export const getOrgAdminContext = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const supabase = context.supabase as Client;
    const orgs = await loadAdminOrgs(supabase, context.userId);
    return { organizations: orgs };
  });

/* ============================ Roster ============================ */

export type RosterCoach = {
  coachId: string;
  userId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  athleteCount: number;
  parentCount: number;
  adultAthleteCount: number;
  joinedAt: string | null;
};

export const listOrgRoster = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ organizationId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ coaches: RosterCoach[] }> => {
    const supabase = context.supabase as Client;
    await assertOrgAdmin(supabase, context.userId, data.organizationId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const coaches = await supabaseAdmin
      .from("coach_profiles")
      .select("id, user_id, first_name, last_name, created_at")
      .eq("organization_id", data.organizationId)
      .order("created_at", { ascending: true });
    if (coaches.error) dbError(coaches.error);

    const coachIds = (coaches.data ?? []).map((c) => c.id);
    const userIds = (coaches.data ?? []).map((c) => c.user_id);

    // Athlete + parent counts per coach
    const links = await supabaseAdmin
      .from("coach_athletes")
      .select("coach_id, athlete_id, athletes!inner(parent_id, self_managed)")
      .in("coach_id", coachIds.length ? coachIds : ["00000000-0000-0000-0000-000000000000"]);
    if (links.error) dbError(links.error);

    const athleteByCoach = new Map<string, number>();
    const parentSetByCoach = new Map<string, Set<string>>();
    const adultByCoach = new Map<string, number>();
    for (const l of links.data ?? []) {
      const a = l.athletes as { parent_id: string | null; self_managed: boolean };
      athleteByCoach.set(l.coach_id, (athleteByCoach.get(l.coach_id) ?? 0) + 1);
      if (a.self_managed) {
        adultByCoach.set(l.coach_id, (adultByCoach.get(l.coach_id) ?? 0) + 1);
      }
      if (a.parent_id) {
        if (!parentSetByCoach.has(l.coach_id)) parentSetByCoach.set(l.coach_id, new Set());
        parentSetByCoach.get(l.coach_id)!.add(a.parent_id);
      }
    }

    // Emails from auth.users
    const emails = new Map<string, string>();
    if (userIds.length) {
      const users = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
      for (const u of users.data?.users ?? []) {
        if (userIds.includes(u.id) && u.email) emails.set(u.id, u.email);
      }
    }

    return {
      coaches: (coaches.data ?? []).map((c) => ({
        coachId: c.id,
        userId: c.user_id,
        firstName: c.first_name ?? "",
        lastName: c.last_name ?? "",
        email: emails.get(c.user_id) ?? null,
        athleteCount: athleteByCoach.get(c.id) ?? 0,
        parentCount: parentSetByCoach.get(c.id)?.size ?? 0,
        adultAthleteCount: adultByCoach.get(c.id) ?? 0,
        joinedAt: c.created_at,
      })),
    };
  });

/** Detach a coach from the org — reverts them to individual plan. */
export const removeCoachFromOrg = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        organizationId: z.string().uuid(),
        coachId: z.string().uuid(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Client;
    await assertOrgAdmin(supabase, context.userId, data.organizationId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const coach = await supabaseAdmin
      .from("coach_profiles")
      .select("id, user_id, organization_id, entitlement")
      .eq("id", data.coachId)
      .eq("organization_id", data.organizationId)
      .maybeSingle();
    if (coach.error) dbError(coach.error);
    if (!coach.data) throw new Error("Coach not in this organization");

    // Detach + revert entitlement; stash WELCOME_BACK promo (matches
    // leaveOrganization flow — Coach Pro paywall auto-applies it).
    const upd = await supabaseAdmin
      .from("coach_profiles")
      .update({
        organization_id: null,
        entitlement: "pending",
        promo_code: "WELCOME_BACK",
      })
      .eq("id", coach.data.id);
    if (upd.error) dbError(upd.error);

    // Audit
    await supabaseAdmin.from("org_admin_actions").insert({
      actor_user_id: context.userId,
      organization_id: data.organizationId,
      target_coach_id: coach.data.id,
      action: "coach.removed",
      payload: {},
    });

    return { ok: true };
  });

/* ============================ Invites ============================ */

export type OrgCoachInvite = {
  id: string;
  email: string | null;
  phone: string | null;
  code: string;
  token: string;
  status: "pending" | "accepted" | "revoked" | "expired";
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
};

export const listOrgCoachInvites = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ organizationId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ invites: OrgCoachInvite[] }> => {
    const supabase = context.supabase as Client;
    await assertOrgAdmin(supabase, context.userId, data.organizationId);

    const { data: rows, error } = await supabase
      .from("org_coach_invites")
      .select(
        "id, email, phone, invite_code, invite_token, status, created_at, expires_at, accepted_at",
      )
      .eq("organization_id", data.organizationId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) dbError(error);

    return {
      invites: (rows ?? []).map((r) => ({
        id: r.id,
        email: r.email,
        phone: r.phone,
        code: r.invite_code,
        token: r.invite_token,
        status: r.status as OrgCoachInvite["status"],
        createdAt: r.created_at,
        expiresAt: r.expires_at,
        acceptedAt: r.accepted_at,
      })),
    };
  });

export const createOrgCoachInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        organizationId: z.string().uuid(),
        email: z.string().trim().email().optional().or(z.literal("")),
        phone: z.string().trim().max(32).optional().or(z.literal("")),
      })
      .refine((v) => (v.email && v.email.length > 0) || (v.phone && v.phone.length > 0), {
        message: "Provide an email or phone",
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Client;
    await assertOrgAdmin(supabase, context.userId, data.organizationId);

    const code = generateInviteCode();
    const token = generateToken();

    const { data: row, error } = await supabase
      .from("org_coach_invites")
      .insert({
        organization_id: data.organizationId,
        email: data.email && data.email.length > 0 ? data.email : null,
        phone: data.phone && data.phone.length > 0 ? data.phone : null,
        invite_code: code,
        invite_token: token,
        invited_by: context.userId,
      })
      .select("id, invite_code, invite_token")
      .single();
    if (error) dbError(error);

    return { id: row.id, code: row.invite_code, token: row.invite_token };
  });

export const revokeOrgCoachInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ organizationId: z.string().uuid(), inviteId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Client;
    await assertOrgAdmin(supabase, context.userId, data.organizationId);
    const { error } = await supabase
      .from("org_coach_invites")
      .update({ status: "revoked" })
      .eq("id", data.inviteId)
      .eq("organization_id", data.organizationId)
      .eq("status", "pending");
    if (error) dbError(error);
    return { ok: true };
  });

/* ================= Public: resolve + accept coach invite ================= */

/** Called from /i/<code> pathway. No auth required — just resolves the org. */
export const resolveOrgCoachInvite = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ code: z.string().trim().toUpperCase() }).parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("org_coach_invites")
      .select("id, status, expires_at, organization_id, organizations!inner(id, name)")
      .eq("invite_code", data.code)
      .maybeSingle();
    if (error) dbError(error);
    if (!row) return { found: false as const };
    const org = row.organizations as { id: string; name: string };
    const expired = new Date(row.expires_at) < new Date();
    return {
      found: true as const,
      inviteId: row.id,
      organizationId: org.id,
      organizationName: org.name,
      status: row.status as OrgCoachInvite["status"],
      expired,
    };
  });

/** Signed-in coach accepts an invite: links them to the org, flips entitlement. */
export const acceptOrgCoachInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ code: z.string().trim().toUpperCase() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Client;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const invite = await supabaseAdmin
      .from("org_coach_invites")
      .select("id, organization_id, status, expires_at")
      .eq("invite_code", data.code)
      .maybeSingle();
    if (invite.error) dbError(invite.error);
    if (!invite.data) throw new Error("Invite not found");
    if (invite.data.status === "revoked") throw new Error("This invite has been revoked");
    if (invite.data.status === "accepted") throw new Error("This invite has already been used");
    if (new Date(invite.data.expires_at) < new Date()) {
      throw new Error("This invite has expired");
    }

    const coach = await supabase
      .from("coach_profiles")
      .select("id, organization_id")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (coach.error) dbError(coach.error);
    if (!coach.data) throw new Error("Coach profile missing — finish coach signup first");

    const upd = await supabase
      .from("coach_profiles")
      .update({
        organization_id: invite.data.organization_id,
        entitlement: "club_covered",
      })
      .eq("id", coach.data.id);
    if (upd.error) dbError(upd.error);

    const markAccepted = await supabaseAdmin
      .from("org_coach_invites")
      .update({
        status: "accepted",
        accepted_at: new Date().toISOString(),
        accepted_user_id: context.userId,
      })
      .eq("id", invite.data.id);
    if (markAccepted.error) dbError(markAccepted.error);

    await supabaseAdmin.from("org_admin_actions").insert({
      actor_user_id: context.userId,
      organization_id: invite.data.organization_id,
      target_coach_id: coach.data.id,
      action: "coach.joined_via_invite",
      payload: { inviteId: invite.data.id },
    });

    return { ok: true, organizationId: invite.data.organization_id };
  });
