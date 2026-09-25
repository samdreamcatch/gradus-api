/**
 * Team plan — co-guardian management.
 *
 * A primary parent on an active Team plan can invite additional parents or
 * guardians to an athlete. Invitees accept by link (token) or by entering the
 * invite code in their own settings. Co-guardians get full parity with the
 * primary parent while the plan is active, and go view-only if it lapses.
 *
 * Single source of truth for `team-guardians.functions.ts` and the
 * `/api/v1/parent/team/guardians*` and `/api/v1/team-invites/*` routes (PRD
 * §7.7, Appendix A "Team plan and guardians"). Extracted without behavior
 * changes; the web wrapper turns `ApiError`s back into their original plain
 * messages via `rethrowPlain`.
 *
 * API-only behavior sits behind `opts.apiContract` (the web wrapper never
 * sets it):
 *   - `listTeamGuardians`: pending invites are shown only for athletes the
 *     caller is primary on (co-guardians get `invites: []`).
 *   - `revokeGuardianInvite` / `removeGuardianById`: 404 `not_found` when
 *     nothing matched, where the web answers a silent `{ ok: true }`.
 * `resendTeamGuardianInvite` is new server logic (I13 decision D2) with no
 * web caller yet.
 */
import { z } from "zod";
import type { ApiContext } from "./api/auth";
import { ApiError } from "./api/errors";
import { inBackground } from "./background";
import { dbError } from "./db-error";
import { notifyUsers, parentUserId } from "./push-notify.server";
import { throttleLookup } from "./invites.server";
import {
  guardianAthleteAccess,
  newInviteCode,
  newInviteToken,
  teamPlanActive,
} from "./team.server";

type Admin = ApiContext["admin"];

export const INVITE_TTL_DAYS = 30;
/** Team plan allows up to three guardians per athlete (primary + two co-guardians). */
export const MAX_GUARDIANS_PER_ATHLETE = 3;
/** Public preview lookups per IP per minute (`record_invite_lookup_attempt` window). */
const PREVIEW_MAX_PER_WINDOW = 30;

const NIL_UUID = "00000000-0000-0000-0000-000000000000";

const notFound = (message: string) => new ApiError({ code: "not_found", status: 404, message });
const forbidden = (message: string) => new ApiError({ code: "forbidden", status: 403, message });
const wrongRole = (message: string) => new ApiError({ code: "wrong_role", status: 403, message });
const conflict = (message: string) => new ApiError({ code: "conflict", status: 409, message });
const unprocessable = (message: string) =>
  new ApiError({ code: "unprocessable", status: 422, message });
const planRequired = (message: string) =>
  new ApiError({ code: "plan_required", status: 403, message });
const validation = (message: string) =>
  new ApiError({ code: "validation_failed", status: 400, message });

export type TeamGuardiansOptions = { apiContract?: boolean };

/* ------------------------------------------------------------------ DTOs */

export interface TeamGuardianDTO {
  /** `athlete_guardians.id` — what `DELETE /parent/team/guardians/{id}` takes. */
  id: string;
  parentId: string;
  name: string;
  role: "primary" | "co";
  isSelf: boolean;
}

export interface TeamGuardianInviteDTO {
  id: string;
  email: string | null;
  code: string;
  createdAt: string;
  expiresAt: string | null;
}

export interface TeamGuardianAthleteDTO {
  id: string;
  firstName: string;
  lastName: string;
  isPrimary: boolean;
  guardians: TeamGuardianDTO[];
  invites: TeamGuardianInviteDTO[];
  /** True for a co-guardian once the primary parent's Team plan has lapsed — `guardians`/`invites` are empty. */
  locked: boolean;
}

export interface TeamGuardiansDTO {
  /** Payer OR covered by another primary's plan (differs from `GET /parent/team.active`, which is payer-only). */
  planActive: boolean;
  isPayer: boolean;
  athletes: TeamGuardianAthleteDTO[];
}

export interface InviteGuardianResultDTO {
  ok: true;
  inviteId: string;
  code: string;
  /** The claim-link secret (`https://gradus.training/team/<token>`), as on the web. */
  token: string;
}

export interface TeamInvitePreviewDTO {
  found: boolean;
  athleteName: string | null;
  inviterName: string | null;
}

export interface ClaimTeamInviteResultDTO {
  ok: true;
  athleteId: string;
}

/* --------------------------------------------------------------- helpers */

type ParentRow = { id: string; first_name: string; last_name: string };
type AthleteRow = { id: string; first_name: string; last_name: string; parent_id: string | null };

async function parentProfile(admin: Admin, userId: string): Promise<ParentRow> {
  const res = await admin
    .from("parent_profiles")
    .select("id, first_name, last_name")
    .eq("user_id", userId)
    .maybeSingle();
  if (res.error) dbError(res.error);
  if (!res.data) throw wrongRole("Parent profile not found.");
  return res.data as ParentRow;
}

async function assertPrimary(
  admin: Admin,
  parentId: string,
  athleteId: string,
): Promise<AthleteRow> {
  const res = await admin
    .from("athletes")
    .select("id, first_name, last_name, parent_id")
    .eq("id", athleteId)
    .maybeSingle();
  if (res.error) dbError(res.error);
  const row = res.data as AthleteRow | null;
  if (!row || row.parent_id !== parentId) {
    throw forbidden("Only the primary parent can manage guardians for this athlete.");
  }
  return row;
}

/**
 * Seats already taken for an athlete: linked guardians plus, optionally,
 * outstanding pending invites (which will become guardians when claimed).
 */
async function guardianSeatsUsed(
  admin: Admin,
  athleteId: string,
  opts: { includePending: boolean },
): Promise<number> {
  const links = await admin
    .from("athlete_guardians")
    .select("id", { count: "exact", head: true })
    .eq("athlete_id", athleteId);
  if (links.error) dbError(links.error);
  let used = links.count ?? 0;

  if (opts.includePending) {
    const pending = await admin
      .from("guardian_invites")
      .select("id", { count: "exact", head: true })
      .eq("athlete_id", athleteId)
      .eq("status", "pending");
    if (pending.error) dbError(pending.error);
    used += pending.count ?? 0;
  }
  return used;
}

const fullName = (first: string, last: string) => `${first} ${last}`.trim();

type PendingInviteRow = {
  id: string;
  athlete_id: string;
  status: string;
  expires_at: string | null;
  invited_by_parent_id: string;
};

/** The pending invite behind a token or code, or null. Codes are matched uppercase. */
async function findPendingInvite(
  admin: Admin,
  input: { token?: string; code?: string },
): Promise<PendingInviteRow | null> {
  let q = admin
    .from("guardian_invites")
    .select("id, athlete_id, status, expires_at, invited_by_parent_id")
    .eq("status", "pending");
  q = input.token ? q.eq("token", input.token) : q.eq("code", (input.code ?? "").toUpperCase());
  const res = await q.maybeSingle();
  if (res.error) dbError(res.error);
  return (res.data as PendingInviteRow | null) ?? null;
}

const isExpired = (expiresAt: string | null) =>
  !!expiresAt && new Date(expiresAt).getTime() < Date.now();

/* ------------------------------------------------------------------ list */

/**
 * `GET /parent/team/guardians` (Appendix A). Guardians + pending invites for
 * each athlete the caller can reach (primary or co-guardian). Expired
 * pending invites are still listed (parity) — clients compare `expiresAt`.
 */
export async function listTeamGuardians(
  admin: Admin,
  userId: string,
  opts: TeamGuardiansOptions = {},
): Promise<TeamGuardiansDTO> {
  const parent = await parentProfile(admin, userId);
  const isPayer = await teamPlanActive(admin, parent.id);

  // Every athlete this parent can reach — as primary parent or co-guardian.
  const access = await guardianAthleteAccess(admin, parent.id);
  const lockedById = new Map(access.map((a) => [a.athleteId, a.locked]));
  const reachableIds = access.length ? access.map((a) => a.athleteId) : [NIL_UUID];
  const athletesRes = await admin
    .from("athletes")
    .select("id, first_name, last_name, parent_id")
    .in("id", reachableIds)
    .order("created_at", { ascending: true });
  if (athletesRes.error) dbError(athletesRes.error);
  const athletes = (athletesRes.data ?? []) as AthleteRow[];
  const ids = athletes.length ? athletes.map((a) => a.id) : [NIL_UUID];

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
  const invites = (invitesRes.data ?? []) as {
    id: string;
    athlete_id: string;
    email: string | null;
    code: string;
    status: string;
    created_at: string;
    expires_at: string | null;
  }[];

  const parentIds = Array.from(new Set(links.map((l) => l.parent_id)));
  const profilesRes = parentIds.length
    ? await admin.from("parent_profiles").select("id, first_name, last_name").in("id", parentIds)
    : { data: [] as ParentRow[], error: null };
  if (profilesRes.error) dbError(profilesRes.error);
  const nameById = new Map(
    ((profilesRes.data ?? []) as ParentRow[]).map((p) => [
      p.id,
      fullName(p.first_name, p.last_name),
    ]),
  );

  // A co-guardian is covered by the primary parent's plan — they're on the
  // Team plan too, just not the payer.
  const otherPrimaryIds = Array.from(
    new Set(athletes.map((a) => a.parent_id).filter((p): p is string => !!p && p !== parent.id)),
  );
  const coveredByOther = isPayer
    ? false
    : (await Promise.all(otherPrimaryIds.map((p) => teamPlanActive(admin, p)))).some(Boolean);
  const planActive = isPayer || coveredByOther;

  return {
    planActive,
    isPayer,
    athletes: athletes.map((a) => {
      const isPrimary = a.parent_id === parent.id;
      if (lockedById.get(a.id)) {
        return {
          id: a.id,
          firstName: a.first_name,
          lastName: a.last_name,
          isPrimary,
          guardians: [],
          invites: [],
          locked: true,
        };
      }
      // D6 (API only): co-guardians never see another parent's pending
      // invite codes. The web keeps listing them (parity).
      const showInvites = isPrimary || !opts.apiContract;
      return {
        id: a.id,
        firstName: a.first_name,
        lastName: a.last_name,
        isPrimary,
        locked: false,
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
        invites: showInvites
          ? invites
              .filter((i) => i.athlete_id === a.id)
              .map((i) => ({
                id: i.id,
                email: i.email ?? null,
                code: i.code,
                createdAt: i.created_at,
                expiresAt: i.expires_at ?? null,
              }))
          : [],
      };
    }),
  };
}

/* ---------------------------------------------------------------- invite */

export const inviteGuardianInput = z.object({
  athleteId: z.string().uuid(),
  email: z.string().trim().email().max(200).optional().nullable(),
});

/**
 * `POST /parent/team/guardians/invites` `[idem]` (Appendix A). Create a
 * guardian invite (optionally emailing it). Requires an active plan on the
 * caller. Email delivery is best-effort: `ok: true` even if the enqueue
 * failed, as on the web.
 */
export async function inviteGuardian(
  admin: Admin,
  userId: string,
  input: z.infer<typeof inviteGuardianInput>,
): Promise<InviteGuardianResultDTO> {
  const parent = await parentProfile(admin, userId);
  const athlete = await assertPrimary(admin, parent.id, input.athleteId);

  if (!(await teamPlanActive(admin, parent.id))) {
    throw planRequired("Start the Team plan to add another parent or guardian.");
  }

  const used = await guardianSeatsUsed(admin, input.athleteId, { includePending: true });
  if (used >= MAX_GUARDIANS_PER_ATHLETE) {
    throw conflict(
      `The Team plan allows up to ${MAX_GUARDIANS_PER_ATHLETE} guardians per athlete. Remove a guardian or revoke a pending invite first.`,
    );
  }

  const token = newInviteToken();
  let code = "";
  let inviteId = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    code = newInviteCode(8);
    const ins = await admin
      .from("guardian_invites")
      .insert({
        athlete_id: input.athleteId,
        invited_by_parent_id: parent.id,
        email: input.email ?? null,
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
    // Same fallback the web used: a plain Error → 500 `internal` on the API.
    if (attempt === 4) dbError(ins.error ?? { message: "Could not create invite." });
  }

  if (input.email) {
    // Dynamic, as on the web: the sender pulls in react-email and copy overrides.
    const { sendTeamInvite } = await import("./team-emails.server");
    await sendTeamInvite({
      to: input.email,
      athleteName: fullName(athlete.first_name, athlete.last_name),
      inviterName: fullName(parent.first_name, parent.last_name),
      token,
      code,
    });
  }

  return { ok: true, inviteId, code, token };
}

/* ---------------------------------------------------------------- resend */

export const resendTeamGuardianInviteInput = z.object({ inviteId: z.string().uuid() });

/**
 * `POST /parent/team/guardians/invites/{id}/resend` `[idem]` (I13 decision
 * D2 — new server logic). Re-sends the SAME code and token to the invite's
 * email; only the inviting parent's own pending invites. An invite that has
 * already expired is extended to now + `INVITE_TTL_DAYS` first so the link
 * being re-sent works.
 */
export async function resendTeamGuardianInvite(
  admin: Admin,
  userId: string,
  input: z.infer<typeof resendTeamGuardianInviteInput>,
): Promise<{ ok: true }> {
  const parent = await parentProfile(admin, userId);

  const res = await admin
    .from("guardian_invites")
    .select("id, athlete_id, email, code, token, status, expires_at")
    .eq("id", input.inviteId)
    .eq("invited_by_parent_id", parent.id)
    .eq("status", "pending")
    .maybeSingle();
  if (res.error) dbError(res.error);
  const invite = res.data as {
    id: string;
    athlete_id: string;
    email: string | null;
    code: string;
    token: string;
    status: string;
    expires_at: string | null;
  } | null;
  if (!invite) throw notFound("Invite not found.");
  if (!invite.email) {
    throw unprocessable("This invite has no email on file — share the code instead.");
  }

  if (isExpired(invite.expires_at)) {
    const upd = await admin
      .from("guardian_invites")
      .update({
        expires_at: new Date(Date.now() + INVITE_TTL_DAYS * 86400_000).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", invite.id);
    if (upd.error) dbError(upd.error);
  }

  const athleteRes = await admin
    .from("athletes")
    .select("first_name, last_name")
    .eq("id", invite.athlete_id)
    .maybeSingle();
  if (athleteRes.error) dbError(athleteRes.error);
  const athlete = athleteRes.data as { first_name: string; last_name: string } | null;

  const { sendTeamInvite } = await import("./team-emails.server");
  await sendTeamInvite({
    to: invite.email,
    athleteName: athlete ? fullName(athlete.first_name, athlete.last_name) : "your athlete",
    inviterName: fullName(parent.first_name, parent.last_name),
    token: invite.token,
    code: invite.code,
  });

  return { ok: true };
}

/* ---------------------------------------------------------------- revoke */

export const revokeGuardianInviteInput = z.object({ inviteId: z.string().uuid() });

/**
 * `DELETE /parent/team/guardians/invites/{id}` (Appendix A). Ownership is
 * `invited_by_parent_id` (parity: a transferred primary cannot revoke the
 * old primary's invites). With `apiContract`, 404 when no pending invite of
 * the caller's matches; the web keeps its silent `{ ok: true }`.
 */
export async function revokeGuardianInvite(
  admin: Admin,
  userId: string,
  input: z.infer<typeof revokeGuardianInviteInput>,
  opts: TeamGuardiansOptions = {},
): Promise<{ ok: true }> {
  const parent = await parentProfile(admin, userId);

  if (opts.apiContract) {
    const existing = await admin
      .from("guardian_invites")
      .select("id")
      .eq("id", input.inviteId)
      .eq("invited_by_parent_id", parent.id)
      .eq("status", "pending")
      .maybeSingle();
    if (existing.error) dbError(existing.error);
    if (!existing.data) throw notFound("Invite not found.");
  }

  const upd = await admin
    .from("guardian_invites")
    .update({ status: "revoked", updated_at: new Date().toISOString() })
    .eq("id", input.inviteId)
    .eq("invited_by_parent_id", parent.id)
    .eq("status", "pending");
  if (upd.error) dbError(upd.error);
  return { ok: true };
}

/* ---------------------------------------------------------------- remove */

export const removeGuardianInput = z.object({
  athleteId: z.string().uuid(),
  parentId: z.string().uuid(),
});

/**
 * The web's shape: remove a co-guardian by (athlete, parent). Either the
 * primary parent removes someone, or a co-guardian removes themselves.
 * Primary rows are never deleted (`role = 'co'` filter). Silent `ok` when
 * nothing matched (parity).
 */
export async function removeGuardian(
  admin: Admin,
  userId: string,
  input: z.infer<typeof removeGuardianInput>,
): Promise<{ ok: true }> {
  const parent = await parentProfile(admin, userId);
  if (input.parentId !== parent.id) await assertPrimary(admin, parent.id, input.athleteId);
  const del = await admin
    .from("athlete_guardians")
    .delete()
    .eq("athlete_id", input.athleteId)
    .eq("parent_id", input.parentId)
    .eq("role", "co");
  if (del.error) dbError(del.error);
  return { ok: true };
}

export const removeGuardianByIdInput = z.object({ guardianId: z.string().uuid() });

/**
 * `DELETE /parent/team/guardians/{id}` (Appendix A; `{id}` =
 * `athlete_guardians.id`, the `guardians[].id` from `listTeamGuardians`).
 * Loads the row, requires `role = 'co'` (primaries are never removable →
 * 404), then applies `removeGuardian`'s rules: self-removal is allowed,
 * otherwise the caller must be the athlete's primary (403). No plan gate
 * (parity). 404 when the row is gone.
 */
export async function removeGuardianById(
  admin: Admin,
  userId: string,
  input: z.infer<typeof removeGuardianByIdInput>,
  opts: TeamGuardiansOptions = {},
): Promise<{ ok: true }> {
  const parent = await parentProfile(admin, userId);

  const res = await admin
    .from("athlete_guardians")
    .select("id, athlete_id, parent_id, role")
    .eq("id", input.guardianId)
    .maybeSingle();
  if (res.error) dbError(res.error);
  const row = res.data as {
    id: string;
    athlete_id: string;
    parent_id: string;
    role: string;
  } | null;
  if (!row || row.role !== "co") {
    if (opts.apiContract) throw notFound("Guardian not found.");
    return { ok: true };
  }

  if (row.parent_id !== parent.id) await assertPrimary(admin, parent.id, row.athlete_id);

  const del = await admin.from("athlete_guardians").delete().eq("id", row.id).eq("role", "co");
  if (del.error) dbError(del.error);
  return { ok: true };
}

/* --------------------------------------------------------------- preview */

export const previewTeamInviteInput = z.object({
  token: z.string().trim().min(6).max(120).optional(),
  code: z.string().trim().min(4).max(20).optional(),
});

/**
 * `POST /team-invites/preview` `[pub]` (Appendix A). What the claim page
 * renders before sign-in. Unknown, used, or expired → `found: false` with
 * null names (never a union, per the Swift-codegen rule).
 *
 * `ipKey` (the API passes `lookupIpKey(request)`) adds the web's per-IP
 * lookup throttle on top of the route limiter; the key is a constant so the
 * token never reaches the attempts table. The web wrapper passes null.
 */
export async function previewGuardianInvite(
  admin: Admin,
  ipKey: string | null,
  input: z.infer<typeof previewTeamInviteInput>,
): Promise<TeamInvitePreviewDTO> {
  if (!input.token && !input.code) throw validation("Missing invite.");
  if (ipKey) await throttleLookup(admin, ipKey, "team-invite", PREVIEW_MAX_PER_WINDOW);

  const invite = await findPendingInvite(admin, input);
  if (!invite || isExpired(invite.expires_at)) {
    return { found: false, athleteName: null, inviterName: null };
  }

  const [athleteRes, inviterRes] = await Promise.all([
    admin
      .from("athletes")
      .select("first_name, last_name")
      .eq("id", invite.athlete_id)
      .maybeSingle(),
    admin
      .from("parent_profiles")
      .select("first_name, last_name")
      .eq("id", invite.invited_by_parent_id)
      .maybeSingle(),
  ]);
  const a = athleteRes.data as { first_name: string; last_name: string } | null;
  const p = inviterRes.data as { first_name: string; last_name: string } | null;
  return {
    found: true,
    athleteName: a ? fullName(a.first_name, a.last_name) : "an athlete",
    inviterName: p ? fullName(p.first_name, p.last_name) : "A parent",
  };
}

/* ----------------------------------------------------------------- claim */

export const claimTeamInviteInput = previewTeamInviteInput;

/**
 * `POST /team-invites/claim` `[idem]` (Appendix A). Accept an invite as the
 * signed-in user. Creates a parent profile if the caller has none — for any
 * signed-in role, as on the web (parity, flagged). `displayName` seeds that
 * profile: the route derives it from the token's `user_metadata`, the web
 * wrapper from its claims. The inviter's plan is not re-checked at claim
 * time (parity).
 */
export async function claimGuardianInvite(
  admin: Admin,
  userId: string,
  displayName: string | null,
  input: z.infer<typeof claimTeamInviteInput>,
): Promise<ClaimTeamInviteResultDTO> {
  if (!input.token && !input.code) throw validation("Missing invite.");

  const invite = await findPendingInvite(admin, input);
  if (!invite) throw notFound("That invite is no longer valid.");
  if (isExpired(invite.expires_at)) {
    throw conflict("That invite has expired. Ask them to send a new one.");
  }

  // Resolve (or create) the claimer's parent profile.
  const existing = await admin
    .from("parent_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (existing.error) dbError(existing.error);
  let parentId = (existing.data as { id: string } | null)?.id ?? null;
  if (!parentId) {
    const [first, ...rest] = (displayName ?? "").trim().split(/\s+/);
    const ins = await admin
      .from("parent_profiles")
      .insert({
        user_id: userId,
        first_name: first || "Parent",
        last_name: rest.join(" ") || "",
      })
      .select("id")
      .maybeSingle();
    if (ins.error) dbError(ins.error);
    parentId = (ins.data as { id: string }).id;
  }

  if (parentId === invite.invited_by_parent_id) {
    throw conflict("You're already the primary parent for this athlete.");
  }

  // PRD §6.13 A1: every parent linked to a minor is a verified adult, co-guardians included.
  {
    const { assertParentVerified } = await import("./guardian-verification.server");
    await assertParentVerified(admin, parentId);
  }

  // Cap seats at claim time too (existing links only — this invite is one of them).
  const alreadyLinked = await admin
    .from("athlete_guardians")
    .select("id")
    .eq("athlete_id", invite.athlete_id)
    .eq("parent_id", parentId)
    .maybeSingle();
  if (alreadyLinked.error) dbError(alreadyLinked.error);
  if (!alreadyLinked.data) {
    const used = await guardianSeatsUsed(admin, invite.athlete_id, { includePending: false });
    if (used >= MAX_GUARDIANS_PER_ATHLETE) {
      throw conflict(
        `This athlete already has the maximum of ${MAX_GUARDIANS_PER_ATHLETE} guardians.`,
      );
    }
  }

  const link = await admin
    .from("athlete_guardians")
    .upsert(
      { athlete_id: invite.athlete_id, parent_id: parentId, role: "co" },
      { onConflict: "athlete_id,parent_id" },
    );
  if (link.error) dbError(link.error);

  {
    const { grantGuardianConsent } = await import("./guardian-verification.server");
    await grantGuardianConsent(admin, {
      athleteId: invite.athlete_id,
      parentId,
      method: "guardian_claim",
      evidence: { via: "team_invite", inviteId: invite.id },
    });
  }

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

  // The primary parent sent the invite; tell them it was accepted (PRD §6.6).
  const invitedBy = invite.invited_by_parent_id as string;
  await inBackground("push:team-invite-claimed", async () => {
    const primaryUser = await parentUserId(admin, invitedBy);
    if (!primaryUser) return;
    await notifyUsers(admin, [primaryUser], {
      type: "connection",
      route: "settings/connections",
      title: "Guardian joined",
      body: "A guardian accepted your invite and joined your team.",
    });
  });

  return { ok: true, athleteId: invite.athlete_id };
}
