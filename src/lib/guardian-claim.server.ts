/**
 * Guardian claim flow and the athlete-side guardian-on-file state (PRD §3.5,
 * §7.8 "Parent or guardian", Appendix A "Guardians").
 *
 * A coach, an import, or a minor's own sign-up can leave an athlete row with
 * a guardian email on file and a 48-hex claim token. The emailed link
 * (`/g/<token>`) lets a parent claim the athlete into their own parent
 * profile, merge it into an athlete they already have, or — for an
 * athlete-addressed invite — lets the adult athlete take the row over
 * themselves.
 *
 * Single source of truth for `guardian.functions.ts` and the
 * `/api/v1/guardian/…` routes. Extracted without behavior changes except the
 * ones called out inline (D3: the "already linked" check now runs before the
 * parent profile is created and a self-managed row is un-self-managed in the
 * same update, on the web too; D4 and D8 are API-only behind
 * `opts.apiContract`). The web wrapper turns `ApiError`s back into their
 * original plain messages via `rethrowPlain`.
 *
 * The email helpers stay in `guardian.server.ts` (never throw, best effort).
 * Claim tokens are bearer secrets: never log them, never put them in a
 * rate-limit key or an `ApiError.details`.
 */
import { z } from "zod";
import type { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ApiError } from "./api/errors";
import { inBackground } from "./background";
import { dbError } from "./db-error";
import { coachUserId, notifyUsers } from "./push-notify.server";
import { ageInYears } from "./pending-athlete-dob";
import { assertParentVerified, grantGuardianConsent } from "./guardian-verification.server";

type Admin = typeof supabaseAdmin;

/**
 * API-only strictness (PRD §6.2 stable codes). The web wrappers leave this
 * off and keep their original behavior, per PRD §4.1 rule 1.
 */
export type GuardianClaimOptions = {
  /**
   * `claimGuardianAthlete`: refuse a caller whose own athlete row is a
   * minor (a child account can't become anyone's parent). `claimAthleteSelf`:
   * refuse a token whose invite was addressed to a parent or guardian (D4),
   * apply the calendar age rule the database trigger uses, and map the
   * trigger's refusal to the same 422. `getMyGuardianStatus`: compute
   * `isMinor` with the calendar `ageInYears` and treat a missing or
   * unparseable birthdate as a minor (D8).
   */
  apiContract?: boolean;
};

const notFound = (message: string) => new ApiError({ code: "not_found", status: 404, message });
const forbidden = (message: string) => new ApiError({ code: "forbidden", status: 403, message });
/**
 * An athlete paused by Apple's RESCIND_CONSENT (PRD §6.13 B4): a claim or a
 * fresh invite would hand consent back through Gradus, which only support
 * restores (PRD §12 #29). Same `paused` code the room gates use.
 */
export const PAUSED_ATHLETE_MESSAGE =
  "This athlete's account is paused because consent was withdrawn through Apple. Email support@gradussports.com to restore it.";
const pausedAthlete = () =>
  new ApiError({ code: "paused", status: 403, message: PAUSED_ATHLETE_MESSAGE });
const wrongRole = (message: string) => new ApiError({ code: "wrong_role", status: 403, message });
const conflict = (message: string) => new ApiError({ code: "conflict", status: 409, message });
const unprocessable = (message: string) =>
  new ApiError({ code: "unprocessable", status: 422, message });

/** The 48-hex claim token from the emailed `/g/<token>` link (accepts 16–64 hex). */
export const tokenSchema = z
  .string()
  .trim()
  .regex(/^[a-f0-9]{16,64}$/, "Invalid link");

export const guardianEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Enter a valid email address")
  .max(255, "Email is too long");

const birthdateInput = (message: string) =>
  z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, message);

const INVALID_LINK = "This link is no longer valid. Ask the coach to resend it.";
const UNDER_18_SELF =
  "You're under 18 — ask a parent or guardian to open this link and set the account up.";

/* ------------------------------------------------------------------ DTOs */

export type GuardianInviteRecipient = "guardian" | "athlete";

export interface GuardianClaimSummaryDTO {
  athleteFirstName: string;
  athleteLastName: string;
  coachName: string | null;
  /** The row has no birthdate yet (coach imports often omit it); the claimer supplies it. */
  needsBirthdate: boolean;
  inviteRecipient: GuardianInviteRecipient;
  alreadyClaimed: boolean;
}

export interface GuardianClaimResultDTO {
  ok: true;
  athleteFirstName: string;
}

export interface ResendGuardianInviteResultDTO {
  ok: true;
  guardianEmail: string;
}

export interface GuardianStatusDTO {
  athleteId: string;
  isMinor: boolean;
  guardianEmail: string | null;
  claimed: boolean;
  invitedAt: string | null;
  /** PRD §6.13 A4: `provisional` until a verified guardian claims a 13–17 self-sign-up. */
  accountState: "active" | "provisional" | "paused";
}

export interface GuardianClaimContextDTO {
  hasParentProfile: boolean;
  parentName: string | null;
}

export type GuardianMergeRank = "exact" | "close" | "other";

export interface GuardianMergeOptionDTO {
  athleteId: string;
  name: string;
  rank: GuardianMergeRank;
}

export interface GuardianMergeOptionsDTO {
  options: GuardianMergeOptionDTO[];
}

/* ---------------------------------------------------------------- inputs */

export const getGuardianClaimSummaryInput = z.object({ token: tokenSchema });

export const claimGuardianAthleteInput = z.object({
  token: tokenSchema,
  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: z.string().trim().min(1).max(80).optional(),
  birthdate: birthdateInput("Enter the athlete's date of birth").optional(),
});

export const resendGuardianInviteInput = z.object({
  athleteId: z.string().uuid(),
  guardianEmail: guardianEmailSchema.optional(),
});

/**
 * `POST /guardian/invites/{id}/resend` body: the athlete comes from the
 * path, and every field is optional, so a request with no body at all
 * (what a generated client sends for "re-send to the address on file")
 * parses as `{}` instead of failing validation.
 */
export const resendGuardianInviteBodyInput = resendGuardianInviteInput
  .omit({ athleteId: true })
  .default({});

export const getGuardianClaimMergeOptionsInput = z.object({ token: tokenSchema });

export const mergeGuardianClaimInput = z.object({
  token: tokenSchema,
  /** The caller's EXISTING athlete to merge the pending row INTO. */
  athleteId: z.string().uuid(),
});

export const claimAthleteSelfInput = z.object({
  token: tokenSchema,
  birthdate: birthdateInput("Enter your date of birth"),
});

/* --------------------------------------------------------------- helpers */

const fullName = (first: string, last: string) => `${first} ${last}`.trim();

async function coachDisplayName(admin: Admin, coachId: string | null): Promise<string | null> {
  if (!coachId) return null;
  const coach = await admin
    .from("coach_profiles")
    .select("first_name, last_name")
    .eq("id", coachId)
    .maybeSingle();
  if (!coach.data) return null;
  return fullName(coach.data.first_name, coach.data.last_name);
}

/** A coach account can't double as a parent or athlete account. */
async function isCoachAccount(admin: Admin, userId: string): Promise<boolean> {
  const coach = await admin.from("coach_profiles").select("id").eq("user_id", userId).maybeSingle();
  return Boolean(coach.data);
}

/* --------------------------------------------------------------- summary */

/**
 * `POST /guardian/claim/summary` (public). Returns only what the claim page
 * shows — enough to recognize the athlete, never enough to enumerate
 * accounts. Abuse control is the API route's own per-IP limiter (which
 * fails closed); this function deliberately does not consume the shared
 * `record_invite_lookup_attempt` window, so summary opens never lock out
 * invite-code entry from the same network.
 */
export async function getGuardianClaimSummary(
  admin: Admin,
  input: z.infer<typeof getGuardianClaimSummaryInput>,
): Promise<GuardianClaimSummaryDTO> {
  const res = await admin
    .from("athletes")
    .select(
      "id, first_name, last_name, birthdate, guardian_claimed_at, added_by_coach_id, parent_id, invite_recipient",
    )
    .eq("guardian_claim_token", input.token)
    .maybeSingle();
  if (res.error) dbError(res.error);
  if (!res.data) throw notFound(INVALID_LINK);

  return {
    athleteFirstName: res.data.first_name,
    athleteLastName: res.data.last_name,
    coachName: await coachDisplayName(admin, res.data.added_by_coach_id),
    needsBirthdate: res.data.birthdate == null,
    inviteRecipient: res.data.invite_recipient === "athlete" ? "athlete" : "guardian",
    alreadyClaimed: Boolean(res.data.guardian_claimed_at) || Boolean(res.data.parent_id),
  };
}

/* ----------------------------------------------------------------- claim */

/**
 * `POST /guardian/claim`. Attach the athlete behind a claim token to the
 * signed-in user's parent profile, creating the parent profile when it
 * doesn't exist yet. The athlete keeps their own login (`user_id`); the
 * parent gains full visibility through the normal `parent_id` relationship.
 *
 * D3 (applies to the web too): the "already linked to another parent" check
 * runs BEFORE the parent profile is inserted, so a refused claim no longer
 * leaves an orphan `parent_profiles` row; and a `self_managed` row (a minor
 * who signed up with a guardian email) is flipped to `self_managed = false`
 * in the same update that sets `parent_id`, which the CHECK constraint
 * `athletes_self_managed_shape` requires — before, that claim failed with the
 * generic "Something went wrong".
 *
 * The other half of that fix: the athlete behind the link can never be
 * their own guardian. The only unclaimed row that carries a login is a
 * minor who signed up with a guardian address they typed themselves, and
 * before D3 their own claim happened to fail on that same CHECK constraint.
 * It is now refused explicitly (on the web too), so a child can't turn
 * their session into a parent session over their own row. In `apiContract`
 * mode a caller whose own athlete row is a minor is refused for any token —
 * a child account can't become a sibling's parent either.
 */
export async function claimGuardianAthlete(
  admin: Admin,
  userId: string,
  input: z.infer<typeof claimGuardianAthleteInput>,
  opts: GuardianClaimOptions = {},
): Promise<GuardianClaimResultDTO> {
  const athlete = await admin
    .from("athletes")
    .select(
      "id, first_name, birthdate, parent_id, guardian_claimed_at, self_managed, user_id, account_state",
    )
    .eq("guardian_claim_token", input.token)
    .maybeSingle();
  if (athlete.error) dbError(athlete.error);
  if (!athlete.data) throw notFound(INVALID_LINK);
  if ((athlete.data as { account_state?: string | null }).account_state === "paused") {
    throw pausedAthlete();
  }

  // Coaches import athletes without a birthdate; the guardian supplies it here.
  if (athlete.data.birthdate == null && !input.birthdate) {
    throw unprocessable("Enter the athlete's date of birth to finish setting up their account.");
  }

  if (await isCoachAccount(admin, userId)) {
    throw wrongRole(
      "You're signed in as a coach. Sign out and use a personal email to claim this athlete.",
    );
  }

  // The athlete can't claim themselves as their own parent or guardian.
  if (athlete.data.user_id != null && athlete.data.user_id === userId) {
    throw forbidden("This link is for your parent or guardian — ask them to open it.");
  }

  if (opts.apiContract) {
    const own = await admin
      .from("athletes")
      .select("birthdate")
      .eq("user_id", userId)
      .maybeSingle();
    if (own.error) dbError(own.error);
    if (own.data && isMinorConservative(own.data.birthdate)) {
      throw wrongRole(
        "You're signed in as an athlete under 18. Ask a parent or guardian to open this link.",
      );
    }
  }

  const existing = await admin
    .from("parent_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (existing.error) dbError(existing.error);

  // D3: refuse before creating anything for the caller.
  if (athlete.data.parent_id && athlete.data.parent_id !== existing.data?.id) {
    throw conflict("This athlete is already linked to another parent account.");
  }

  let parentId: string;
  if (!existing.data) {
    const ins = await admin
      .from("parent_profiles")
      .insert({
        user_id: userId,
        first_name: input.firstName ?? "Parent",
        last_name: input.lastName ?? "",
      })
      .select("id")
      .single();
    if (ins.error) dbError(ins.error);
    parentId = ins.data.id;
  } else {
    parentId = existing.data.id;
    if (input.firstName && input.lastName) {
      await admin
        .from("parent_profiles")
        .update({ first_name: input.firstName, last_name: input.lastName })
        .eq("id", parentId);
    }
  }

  // PRD §6.13 A1: with the regime switch on, an unverified parent gets 403
  // `parent_unverified` here. Their profile stays (it is what the KWS email
  // is bound to); the claim page starts verification and retries the claim.
  await assertParentVerified(admin, parentId);

  const upd = await admin
    .from("athletes")
    .update({
      parent_id: parentId,
      ...(athlete.data.birthdate == null && input.birthdate ? { birthdate: input.birthdate } : {}),
      // D3: a parent-linked row can't stay self-managed (CHECK athletes_self_managed_shape).
      ...(athlete.data.self_managed ? { self_managed: false } : {}),
      guardian_claimed_at: new Date().toISOString(),
      guardian_claim_token: null,
      // Decision #31: a provisional 13–17 self-sign-up turns active on the claim.
      account_state: "active",
    })
    .eq("id", athlete.data.id);
  if (upd.error) dbError(upd.error);

  await grantGuardianConsent(admin, {
    athleteId: athlete.data.id,
    parentId,
    method: "guardian_claim",
    evidence: { via: "claim_link" },
  });

  // The coach(es) who roster this athlete invited the guardian; tell them the claim landed.
  const claimedAthleteId = athlete.data.id;
  const claimedFirstName = athlete.data.first_name;
  await inBackground("push:guardian-claimed", async () => {
    const links = await admin
      .from("coach_athletes")
      .select("coach_id")
      .eq("athlete_id", claimedAthleteId);
    const coachIds = Array.from(
      new Set(((links.data ?? []) as { coach_id: string }[]).map((r) => r.coach_id)),
    );
    const users = (await Promise.all(coachIds.map((id) => coachUserId(admin, id)))).filter(
      (u): u is string => !!u,
    );
    await notifyUsers(admin, users, {
      type: "connection",
      route: "settings/connections",
      title: "Guardian connected",
      body: `${claimedFirstName}'s guardian claimed their account.`,
    });
  });

  return { ok: true, athleteFirstName: athlete.data.first_name };
}

/* ---------------------------------------------------------------- resend */

/**
 * `POST /guardian/invites/{id}/resend` — `{id}` is the athlete id (there is
 * no invite row). Re-send the guardian invite (or change the address on
 * file). Callable by the athlete themselves or by any coach with the athlete
 * on their roster; parents are not allowed (parity). The existing token is
 * reused, not rotated (parity).
 *
 * Like `adminResendGuardianInvite`, the email is voiced for
 * `invite_recipient` and carries the adding coach's name, so an
 * athlete-addressed invite is not re-sent in guardian voice.
 */
export async function resendGuardianInvite(
  admin: Admin,
  userId: string,
  input: z.infer<typeof resendGuardianInviteInput>,
): Promise<ResendGuardianInviteResultDTO> {
  const { newGuardianToken, sendGuardianInvite } = await import("./guardian.server");

  const athlete = await admin
    .from("athletes")
    .select(
      "id, user_id, first_name, last_name, parent_id, guardian_email, guardian_claim_token, guardian_claimed_at, invite_recipient, added_by_coach_id, account_state",
    )
    .eq("id", input.athleteId)
    .maybeSingle();
  if (athlete.error) dbError(athlete.error);
  if (!athlete.data) throw notFound("Athlete not found.");
  if (athlete.data.parent_id || athlete.data.guardian_claimed_at) {
    throw conflict("This athlete's parent has already joined.");
  }
  if ((athlete.data as { account_state?: string | null }).account_state === "paused") {
    throw pausedAthlete();
  }

  // Authorization: the athlete themselves, or a coach with them on roster.
  let allowed = athlete.data.user_id === userId;
  if (!allowed) {
    const coach = await admin
      .from("coach_profiles")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();
    if (coach.data) {
      const link = await admin
        .from("coach_athletes")
        .select("id")
        .eq("coach_id", coach.data.id)
        .eq("athlete_id", input.athleteId)
        .maybeSingle();
      allowed = Boolean(link.data);
    }
  }
  if (!allowed) throw forbidden("You don't have access to this athlete.");

  const email = input.guardianEmail ?? athlete.data.guardian_email;
  if (!email) throw unprocessable("Add a parent or guardian email first.");

  const token = athlete.data.guardian_claim_token ?? newGuardianToken();

  const upd = await admin
    .from("athletes")
    .update({
      guardian_email: email,
      guardian_claim_token: token,
      guardian_invited_at: new Date().toISOString(),
    })
    .eq("id", input.athleteId);
  if (upd.error) dbError(upd.error);

  await sendGuardianInvite({
    to: email,
    athleteName: fullName(athlete.data.first_name, athlete.data.last_name),
    coachName: await coachDisplayName(admin, athlete.data.added_by_coach_id),
    token,
    recipient: athlete.data.invite_recipient === "athlete" ? "athlete" : "guardian",
  });

  return { ok: true, guardianEmail: email };
}

/* ---------------------------------------------------------------- status */

/**
 * `GET /guardian/status`. Guardian status for the signed-in athlete's own
 * row; `null` when the caller has no athlete row.
 *
 * D8 (`apiContract`): `isMinor` uses the calendar `ageInYears` the web
 * settings page uses, and a missing or unparseable birthdate counts as a
 * minor — never assume an adult. The web wrapper keeps its original
 * 18 × 365.25-day approximation with "no birthdate → not a minor".
 */
export async function getMyGuardianStatus(
  admin: Admin,
  userId: string,
  opts: GuardianClaimOptions = {},
): Promise<GuardianStatusDTO | null> {
  const res = await admin
    .from("athletes")
    .select(
      "id, birthdate, parent_id, guardian_email, guardian_claimed_at, guardian_invited_at, account_state",
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (res.error) dbError(res.error);
  if (!res.data) return null;

  const birthdate = res.data.birthdate;
  const isMinor = opts.apiContract
    ? isMinorConservative(birthdate)
    : birthdate
      ? new Date(birthdate) > new Date(Date.now() - 18 * 365.25 * 24 * 3600 * 1000)
      : false;

  return {
    athleteId: res.data.id,
    isMinor,
    guardianEmail: res.data.guardian_email ?? null,
    claimed: Boolean(res.data.parent_id) || Boolean(res.data.guardian_claimed_at),
    invitedAt: res.data.guardian_invited_at ?? null,
    accountState:
      ((res.data as { account_state?: string | null }).account_state as
        | "active"
        | "provisional"
        | "paused"
        | null
        | undefined) ?? "active",
  };
}

/** Calendar age under 18, or unknown/unparseable — the conservative reading. */
export function isMinorConservative(birthdate: string | null): boolean {
  if (!birthdate || !/^\d{4}-\d{2}-\d{2}$/.test(birthdate)) return true;
  const age = ageInYears(birthdate);
  if (!Number.isFinite(age)) return true;
  return age < 18;
}

/* --------------------------------------------------------------- context */

/**
 * `GET /guardian/claim/context`. Who the signed-in claimer is, so the page
 * doesn't ask a returning parent to re-introduce themselves.
 */
export async function getGuardianClaimContext(
  admin: Admin,
  userId: string,
): Promise<GuardianClaimContextDTO> {
  const parent = await admin
    .from("parent_profiles")
    .select("first_name, last_name")
    .eq("user_id", userId)
    .maybeSingle();
  if (parent.error) dbError(parent.error);
  return {
    hasParentProfile: Boolean(parent.data),
    parentName: parent.data ? fullName(parent.data.first_name, parent.data.last_name) : null,
  };
}

/* --------------------------------------------------------- merge options */

const normName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** Small edit distance, used to catch nickname/typo variants like Leo / Leopold. */
function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length]!;
}

/**
 * `POST /guardian/claim/merge-options` (read-only; the token travels in the
 * body). The signed-in claimer's OWN athletes, ranked by how closely they
 * match the pending athlete behind this token. Only their own data is
 * returned, so this discloses nothing about anyone else's account. Never
 * throws for an unknown token or a caller without a parent profile — the
 * page simply has nothing to suggest.
 */
export async function getGuardianClaimMergeOptions(
  admin: Admin,
  userId: string,
  input: z.infer<typeof getGuardianClaimMergeOptionsInput>,
): Promise<GuardianMergeOptionsDTO> {
  const pending = await admin
    .from("athletes")
    .select("id, first_name, last_name, parent_id, guardian_claimed_at")
    .eq("guardian_claim_token", input.token)
    .maybeSingle();
  if (pending.error) dbError(pending.error);
  if (!pending.data) return { options: [] };

  const parent = await admin
    .from("parent_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (parent.error) dbError(parent.error);
  if (!parent.data) return { options: [] };

  const mine = await admin
    .from("athletes")
    .select("id, first_name, last_name")
    .eq("parent_id", parent.data.id);
  if (mine.error) dbError(mine.error);

  const pendingId = pending.data.id;
  const targetFirst = normName(pending.data.first_name);
  const targetLast = normName(pending.data.last_name);
  const targetFull = `${targetFirst} ${targetLast}`.trim();

  const rankOrder: Record<GuardianMergeRank, number> = { exact: 0, close: 1, other: 2 };

  const options: GuardianMergeOptionDTO[] = (mine.data ?? [])
    .filter((a) => a.id !== pendingId)
    .map((a) => {
      const first = normName(a.first_name);
      const last = normName(a.last_name);
      const full = `${first} ${last}`.trim();
      let rank: GuardianMergeRank = "other";
      if (full === targetFull) rank = "exact";
      else if (
        last === targetLast &&
        (first.startsWith(targetFirst) ||
          targetFirst.startsWith(first) ||
          levenshtein(first, targetFirst) <= 2)
      ) {
        rank = "close";
      }
      return { athleteId: a.id, name: fullName(a.first_name, a.last_name), rank };
    })
    .sort((x, y) => rankOrder[x.rank] - rankOrder[y.rank] || x.name.localeCompare(y.name));

  return { options };
}

/* ----------------------------------------------------------------- merge */

/**
 * `POST /guardian/claim/merge` — "that's my existing athlete". Move the
 * coach links, sports and lesson slots from the pending athlete onto one of
 * the claimer's own athletes, then delete the pending row so no duplicate
 * survives. DESTRUCTIVE and not transactional (parity): the delete cascades
 * to everything attached to the pending row; only links, sports and lesson
 * slots are carried over, and copied links are inserted with both acks set.
 */
export async function mergeGuardianClaim(
  admin: Admin,
  userId: string,
  input: z.infer<typeof mergeGuardianClaimInput>,
): Promise<GuardianClaimResultDTO> {
  {
    // PRD §6.13 A1: same gate as the plain claim.
    const owner = await admin
      .from("parent_profiles")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();
    if (owner.error) dbError(owner.error);
    if (owner.data) await assertParentVerified(admin, owner.data.id);
  }
  const pending = await admin
    .from("athletes")
    .select("id, first_name, parent_id, guardian_claimed_at")
    .eq("guardian_claim_token", input.token)
    .maybeSingle();
  if (pending.error) dbError(pending.error);
  if (!pending.data) throw notFound(INVALID_LINK);
  if (pending.data.parent_id || pending.data.guardian_claimed_at) {
    throw conflict("This invite has already been claimed.");
  }

  const parent = await admin
    .from("parent_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (parent.error) dbError(parent.error);
  if (!parent.data) throw unprocessable("Create your parent account first.");

  // The target must be the caller's own athlete.
  const target = await admin
    .from("athletes")
    .select("id, first_name, parent_id")
    .eq("id", input.athleteId)
    .maybeSingle();
  if (target.error) dbError(target.error);
  if (!target.data || target.data.parent_id !== parent.data.id) {
    throw forbidden("That athlete isn't on your account.");
  }

  const pendingId = pending.data.id;

  // Move the coach relationships onto the existing athlete, skipping links
  // the coach already has there.
  const links = await admin.from("coach_athletes").select("coach_id").eq("athlete_id", pendingId);
  for (const l of links.data ?? []) {
    const exists = await admin
      .from("coach_athletes")
      .select("id")
      .eq("coach_id", l.coach_id)
      .eq("athlete_id", input.athleteId)
      .maybeSingle();
    if (!exists.data) {
      await admin.from("coach_athletes").insert({
        coach_id: l.coach_id,
        athlete_id: input.athleteId,
        coach_ack_at: new Date().toISOString(),
        other_ack_at: new Date().toISOString(),
      });
    }
  }

  const sports = await admin
    .from("coach_athlete_sports")
    .select("coach_id, sport")
    .eq("athlete_id", pendingId);
  for (const s of sports.data ?? []) {
    const exists = await admin
      .from("coach_athlete_sports")
      .select("id")
      .eq("coach_id", s.coach_id)
      .eq("athlete_id", input.athleteId)
      .eq("sport", s.sport)
      .maybeSingle();
    if (!exists.data) {
      await admin
        .from("coach_athlete_sports")
        .insert({ coach_id: s.coach_id, athlete_id: input.athleteId, sport: s.sport });
    }
  }

  const slots = await admin
    .from("athlete_lesson_slots")
    .update({ athlete_id: input.athleteId })
    .eq("athlete_id", pendingId);
  if (slots.error) dbError(slots.error);

  const del = await admin.from("athletes").delete().eq("id", pendingId);
  if (del.error) dbError(del.error);

  return { ok: true, athleteFirstName: target.data.first_name };
}

/* ------------------------------------------------------------ self-claim */

/**
 * `POST /guardian/claim/self`. Adult-athlete path for a coach invite: the
 * signed-in user IS the athlete, so attach the pending row to their own
 * account instead of a parent's. Keeps the web's 18 × 365.25-day age rule
 * (parity).
 *
 * D4 (`apiContract`): a token whose invite was addressed to a parent or
 * guardian is refused; the web keeps today's behavior (no check). The API
 * also judges "under 18" by calendar age — the rule the
 * `enforce_adult_self_managed` trigger applies — and maps that trigger's
 * refusal (23514) to the same 422, so the two rules can't disagree into a
 * 500 in the last hours before an 18th birthday.
 */
export async function claimAthleteSelf(
  admin: Admin,
  userId: string,
  input: z.infer<typeof claimAthleteSelfInput>,
  opts: GuardianClaimOptions = {},
): Promise<GuardianClaimResultDTO> {
  const dob = new Date(`${input.birthdate}T00:00:00Z`);
  if (Number.isNaN(dob.getTime())) throw unprocessable("Enter your date of birth");
  const underEighteen = opts.apiContract
    ? isMinorConservative(input.birthdate)
    : dob > new Date(Date.now() - 18 * 365.25 * 24 * 3600 * 1000);
  if (underEighteen) throw unprocessable(UNDER_18_SELF);

  const athlete = await admin
    .from("athletes")
    .select("id, first_name, parent_id, user_id, guardian_claimed_at, invite_recipient")
    .eq("guardian_claim_token", input.token)
    .maybeSingle();
  if (athlete.error) dbError(athlete.error);
  if (!athlete.data) throw notFound(INVALID_LINK);
  if (opts.apiContract && athlete.data.invite_recipient !== "athlete") {
    throw forbidden("This link was sent to a parent or guardian.");
  }
  if (athlete.data.user_id || athlete.data.parent_id || athlete.data.guardian_claimed_at) {
    throw conflict("This invite has already been claimed.");
  }

  if (await isCoachAccount(admin, userId)) {
    throw wrongRole("You're signed in as a coach. Sign out and use your athlete account.");
  }

  const mine = await admin.from("athletes").select("id").eq("user_id", userId).maybeSingle();
  if (mine.data) {
    throw conflict("You already have an athlete profile on this account.");
  }

  const upd = await admin
    .from("athletes")
    .update({
      user_id: userId,
      self_managed: true,
      birthdate: input.birthdate,
      guardian_email: null,
      guardian_claim_token: null,
      guardian_claimed_at: new Date().toISOString(),
    })
    .eq("id", athlete.data.id);
  if (upd.error) {
    // 23514 = check_violation: the age trigger refused a self-managed row
    // whose birthday it counts as under 18 (same precedent as
    // athlete-settings.server.ts). The web keeps dbError (parity).
    if (opts.apiContract && (upd.error as { code?: string }).code === "23514") {
      throw unprocessable(UNDER_18_SELF);
    }
    dbError(upd.error);
  }

  return { ok: true, athleteFirstName: athlete.data.first_name };
}
