/**
 * Identity resolution and session minting for the /api/v1/auth/* broker,
 * per docs/ios/PRD.md §6.4. This is the piece that turns a verified Apple
 * or Google identity (see provider-verify.ts) into a Supabase session, and
 * the username <-> synthetic-email helpers shared by password sign-in.
 *
 * `auth_identities` is not yet in the generated Supabase `Database` type
 * (that codegen runs separately and is out of scope here), so table access
 * is cast the same way `src/routes/api/public/board/refresh.ts` already
 * does for ad-hoc table access.
 */
import { z } from "zod";
import { SignJWT, importPKCS8 } from "jose";
import type { ApiContext } from "./auth";
import { ApiError } from "./errors";
import { goTrueRequest } from "./gotrue";

/** Same header precedence used elsewhere in src/lib/api/ (define-route.ts). */
export function getRequestIp(request: Request): string | null {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    null
  );
}

export const SYNTHETIC_EMAIL_DOMAIN = "users.gradus.training";

export function syntheticEmailForAthlete(athleteId: string): string {
  return `athlete-${athleteId}@${SYNTHETIC_EMAIL_DOMAIN}`;
}

// Mirrors the username shape enforced in src/lib/athlete-signup.functions.ts
// (resolveAthleteLogin / checkAthleteUsername) — reproduced, not imported.
export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Username must be at least 3 characters")
  .max(24, "Username must be at most 24 characters")
  .regex(/^[a-z0-9_]+$/, "Use only lowercase letters, numbers, and underscores");

type AthletesUsernameTable = {
  from: (table: "athletes") => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: string,
      ) => { maybeSingle: () => Promise<{ data: { id: string } | null; error: unknown }> };
    };
  };
};

/**
 * Looks up the synthetic login email for a username. Returns `null` (not a
 * thrown error) when the username doesn't exist — callers that must not
 * leak account existence (password sign-in) treat that as an ordinary
 * invalid-credentials failure; the dedicated `/auth/username/resolve`
 * lookup endpoint is the one place that surfaces a specific message.
 */
export async function lookupAthleteEmailByUsername(
  admin: ApiContext["admin"],
  username: string,
): Promise<string | null> {
  const { data, error } = await (admin as unknown as AthletesUsernameTable)
    .from("athletes")
    .select("id")
    .eq("username", username)
    .maybeSingle();
  if (error) {
    console.error("[api] lookupAthleteEmailByUsername", error);
    throw new ApiError({
      code: "internal",
      status: 500,
      message: "Something went wrong. Please try again.",
    });
  }
  if (!data) return null;
  return syntheticEmailForAthlete(data.id);
}

/** Resolves a password-sign-in identifier to an email: passthrough if it already looks like one, otherwise a username lookup. */
export async function resolveSignInEmail(
  admin: ApiContext["admin"],
  identifier: string,
): Promise<string | null> {
  if (identifier.includes("@")) return identifier;
  const parsed = usernameSchema.safeParse(identifier);
  if (!parsed.success) return null;
  return lookupAthleteEmailByUsername(admin, parsed.data);
}

// Mirrors the invite-lookup rate-limit bucket already used by
// resolveAthleteLogin/checkAthleteUsername in
// src/lib/athlete-signup.functions.ts, via the same existing RPC, rather
// than introducing a second mechanism for the same abuse category.
const USERNAME_RATE_WINDOW_SECONDS = 60;
const USERNAME_RATE_MAX_PER_WINDOW = 10;

export async function checkUsernameLookupRate(
  admin: ApiContext["admin"],
  ip: string | null,
  code: string,
): Promise<void> {
  const { data, error } = await admin.rpc("record_invite_lookup_attempt", {
    _ip: ip ?? "unknown",
    _code: code,
    _max_per_window: USERNAME_RATE_MAX_PER_WINDOW,
    _window_seconds: USERNAME_RATE_WINDOW_SECONDS,
  });
  if (error) {
    console.error("[api] record_invite_lookup_attempt", error);
    throw new ApiError({
      code: "internal",
      status: 500,
      message: "Something went wrong. Please try again.",
    });
  }
  if (data === -1) {
    throw new ApiError({
      code: "rate_limited",
      status: 429,
      message: "Too many attempts. Please wait a minute and try again.",
    });
  }
}

export interface IdentityLookupResult {
  userId: string;
  isNewUser: boolean;
}

interface AuthIdentityRow {
  user_id: string;
}

type AuthIdentitiesTable = {
  from: (table: "auth_identities") => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: string,
      ) => {
        eq: (
          column: string,
          value: string,
        ) => { maybeSingle: () => Promise<{ data: AuthIdentityRow | null; error: unknown }> };
      };
    };
    insert: (row: {
      user_id: string;
      provider: string;
      provider_sub: string;
      email: string | null;
      apple_refresh_token?: string | null;
    }) => Promise<{ data: unknown; error: unknown }>;
    update: (patch: { apple_refresh_token: string }) => {
      eq: (
        column: string,
        value: string,
      ) => { eq: (column: string, value: string) => Promise<{ error: unknown }> };
    };
  };
  rpc: (
    fn: "find_confirmed_user_by_email",
    args: { _email: string },
  ) => Promise<{ data: string | null; error: unknown }>;
};

/**
 * Finds the Supabase user for a verified provider identity, matching PRD
 * §6.4's order: known `auth_identities` link, then a confirmed user with
 * the same email, then a brand-new user. Links the identity either way.
 */
export async function findOrCreateIdentityUser(
  admin: ApiContext["admin"],
  identity: { provider: "apple" | "google"; providerSub: string; email: string | null },
): Promise<IdentityLookupResult> {
  const table = (admin as unknown as AuthIdentitiesTable).from("auth_identities");

  const existing = await table
    .select("user_id")
    .eq("provider", identity.provider)
    .eq("provider_sub", identity.providerSub)
    .maybeSingle();
  if (existing.error) {
    console.error("[api] auth_identities lookup", existing.error);
    throw new ApiError({
      code: "internal",
      status: 500,
      message: "Something went wrong. Please try again.",
    });
  }
  if (existing.data) {
    return { userId: existing.data.user_id, isNewUser: false };
  }

  let userId: string | null = null;

  if (identity.email) {
    const { data: matchedId, error: rpcError } = await (
      admin as unknown as AuthIdentitiesTable
    ).rpc("find_confirmed_user_by_email", { _email: identity.email });
    if (rpcError) {
      console.error("[api] find_confirmed_user_by_email", rpcError);
      throw new ApiError({
        code: "internal",
        status: 500,
        message: "Something went wrong. Please try again.",
      });
    }
    if (matchedId) userId = matchedId;
  }

  let isNewUser = false;
  if (!userId) {
    if (!identity.email) {
      throw new ApiError({
        code: "identity_email_required",
        status: 422,
        message: "This provider didn't share an email for a first-time sign-in. Please try again.",
      });
    }
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: identity.email,
      email_confirm: true,
      user_metadata: { signed_up_via: identity.provider },
    });
    if (createError || !created?.user) {
      console.error("[api] createUser for identity", createError);
      throw new ApiError({
        code: "internal",
        status: 500,
        message: "Something went wrong. Please try again.",
      });
    }
    userId = created.user.id;
    isNewUser = true;
  }

  const { error: insertError } = await table.insert({
    user_id: userId,
    provider: identity.provider,
    provider_sub: identity.providerSub,
    email: identity.email,
  });
  if (insertError) {
    console.error("[api] auth_identities insert", insertError);
    throw new ApiError({
      code: "internal",
      status: 500,
      message: "Something went wrong. Please try again.",
    });
  }

  return { userId, isNewUser };
}

/** Persists Apple's refresh token on the identity row, for revoke-on-delete. Best-effort: never throws. */
export async function storeAppleRefreshToken(
  admin: ApiContext["admin"],
  providerSub: string,
  refreshToken: string,
): Promise<void> {
  const { error } = await (admin as unknown as AuthIdentitiesTable)
    .from("auth_identities")
    .update({ apple_refresh_token: refreshToken })
    .eq("provider", "apple")
    .eq("provider_sub", providerSub);
  if (error) console.error("[api] storeAppleRefreshToken", error);
}

/**
 * Fetches the account's current, authoritative email — used before minting
 * a session so a returning sign-in doesn't depend on the identity token's
 * email claim (which can be absent or stale for a linked, already-known
 * identity; only the create-new-user path needs the token's own claim).
 */
export async function getUserEmail(
  admin: ApiContext["admin"],
  userId: string,
): Promise<string | null> {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data?.user) {
    console.error("[api] getUserById", error);
    throw new ApiError({
      code: "internal",
      status: 500,
      message: "Something went wrong. Please try again.",
    });
  }
  return data.user.email ?? null;
}

export interface MintedSession {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

interface GenerateLinkProperties {
  properties?: { hashed_token?: string };
}

/**
 * Mints a real Supabase session for `email` without the user presenting a
 * password: an admin `generateLink(magiclink)` followed by verifying that
 * link's token hash, both with service-role credentials (PRD §6.4). Used
 * after a provider identity has already been verified, and after a
 * brand-new coach signup completes.
 */
export async function mintSessionForEmail(
  admin: ApiContext["admin"],
  email: string,
  init: { fetchImpl?: typeof fetch } = {},
): Promise<MintedSession> {
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data) {
    console.error("[api] generateLink", error);
    throw new ApiError({
      code: "internal",
      status: 500,
      message: "Something went wrong. Please try again.",
    });
  }

  const hashedToken = (data as unknown as GenerateLinkProperties).properties?.hashed_token;
  if (!hashedToken) {
    console.error("[api] generateLink returned no hashed_token");
    throw new ApiError({
      code: "internal",
      status: 500,
      message: "Something went wrong. Please try again.",
    });
  }

  const verified = await goTrueRequest<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
  }>("verify", { type: "magiclink", token_hash: hashedToken }, init);
  if (!verified.ok || !verified.data) {
    console.error("[api] verify magiclink", verified.error);
    throw new ApiError({
      code: "internal",
      status: 500,
      message: "Something went wrong. Please try again.",
    });
  }

  return {
    accessToken: verified.data.access_token,
    refreshToken: verified.data.refresh_token,
    expiresIn: verified.data.expires_in,
  };
}

// --- Sign in with Apple: authorization-code exchange and revoke -----------
//
// The app's Services ID / bundle ID (CLAUDE.md, capacitor.config.ts) —
// public, not a secret. Duplicated from provider-verify.ts's APPLE_AUDIENCE
// rather than exported/shared, since the two modules verify different
// things (an inbound identity token vs. an outbound client-secret JWT) and
// a rename in one should not silently change the other.
const APPLE_CLIENT_ID = "training.gradus.app";

async function buildAppleClientSecret(): Promise<string | null> {
  const teamId = process.env.APPLE_TEAM_ID;
  const keyId = process.env.APPLE_SIWA_KEY_ID;
  const privateKeyPem = process.env.APPLE_SIWA_KEY_P8;
  if (!teamId || !keyId || !privateKeyPem) return null;

  const privateKey = await importPKCS8(privateKeyPem, "ES256");
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: keyId })
    .setIssuer(teamId)
    .setIssuedAt()
    .setExpirationTime("5m")
    .setAudience("https://appleid.apple.com")
    .setSubject(APPLE_CLIENT_ID)
    .sign(privateKey);
}

/**
 * Exchanges the one-time `authorizationCode` from `ASAuthorizationAppleIDCredential`
 * for Apple's own refresh token, so it can be revoked later at account
 * deletion. Best-effort: returns `null` (never throws) when the Apple key
 * secrets aren't configured yet, or the exchange fails — sign-in still
 * succeeds either way since it only depends on the already-verified
 * identity token, not this exchange.
 */
export async function exchangeAppleAuthorizationCode(
  authorizationCode: string,
  init: { fetchImpl?: typeof fetch } = {},
): Promise<string | null> {
  const clientSecret = await buildAppleClientSecret();
  if (!clientSecret) {
    console.warn(
      "[api] Apple code exchange skipped: APPLE_TEAM_ID/APPLE_SIWA_KEY_ID/APPLE_SIWA_KEY_P8 not set",
    );
    return null;
  }

  const doFetch = init.fetchImpl ?? fetch;
  const response = await doFetch("https://appleid.apple.com/auth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: APPLE_CLIENT_ID,
      client_secret: clientSecret,
      code: authorizationCode,
      grant_type: "authorization_code",
    }).toString(),
  });

  if (!response.ok) {
    console.error(
      "[api] Apple code exchange failed",
      response.status,
      await response.text().catch(() => ""),
    );
    return null;
  }

  const body = (await response.json().catch(() => null)) as { refresh_token?: string } | null;
  return body?.refresh_token ?? null;
}

/**
 * Revokes Apple's grant to this app for one identity, per PRD §6.4
 * ("the server must also revoke the Apple token"). Not wired into account
 * deletion yet — see the B2 PR description for why.
 */
export async function revokeAppleIdentity(
  refreshToken: string,
  init: { fetchImpl?: typeof fetch } = {},
): Promise<{ attempted: boolean; ok: boolean }> {
  const clientSecret = await buildAppleClientSecret();
  if (!clientSecret) {
    console.warn(
      "[api] Apple revoke skipped: APPLE_TEAM_ID/APPLE_SIWA_KEY_ID/APPLE_SIWA_KEY_P8 not set",
    );
    return { attempted: false, ok: false };
  }

  const doFetch = init.fetchImpl ?? fetch;
  const response = await doFetch("https://appleid.apple.com/auth/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: APPLE_CLIENT_ID,
      client_secret: clientSecret,
      token: refreshToken,
      token_type_hint: "refresh_token",
    }).toString(),
  });

  if (!response.ok) {
    console.error(
      "[api] Apple revoke failed",
      response.status,
      await response.text().catch(() => ""),
    );
  }
  return { attempted: true, ok: response.ok };
}
