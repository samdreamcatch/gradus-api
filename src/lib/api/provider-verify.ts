/**
 * Sign in with Apple / Google native sign-in verification, per
 * docs/ios/PRD.md §6.4. Verifies the identity token's signature against the
 * provider's public JWKS (no client secret needed for this half of the
 * flow — only Apple token *revocation* on account deletion needs the
 * private `APPLE_SIWA_KEY_P8` key, which lives separately in auth-broker.ts
 * and is not required here).
 *
 * The JWKS resolver is an injectable parameter (defaulting to the real
 * remote JWKS) so tests can verify full signature + claims checking against
 * a locally generated key pair, with no network call.
 */
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { ApiError } from "./errors";

export interface VerifiedIdentity {
  sub: string;
  email: string | null;
  /**
   * Whether the PROVIDER vouches for `email`. The broker only matches an
   * identity to an existing account by email when this is true; an
   * unverified provider email must never unlock someone else's account.
   */
  emailVerified: boolean;
  /** Name claims when the provider sends them (Google does; Apple sends the name in the client payload instead). */
  givenName: string | null;
  familyName: string | null;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

const APPLE_ISSUER = "https://appleid.apple.com";
const APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys";
// The app's bundle ID (CLAUDE.md) — public, not a secret.
const APPLE_AUDIENCE = "training.gradus.app";

const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";

let appleJwks: JWTVerifyGetKey | undefined;
function defaultAppleJwks(): JWTVerifyGetKey {
  if (!appleJwks) appleJwks = createRemoteJWKSet(new URL(APPLE_JWKS_URL));
  return appleJwks;
}

let googleJwks: JWTVerifyGetKey | undefined;
function defaultGoogleJwks(): JWTVerifyGetKey {
  if (!googleJwks) googleJwks = createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));
  return googleJwks;
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Verifies an Apple identity token: signature against Apple's JWKS, `aud`,
 * issuer, and the hashed nonce. The client hashes a random nonce (SHA-256)
 * before handing it to `ASAuthorizationController`; Apple echoes that same
 * hash back in the token's `nonce` claim, so the server re-hashes the raw
 * nonce it was sent and compares.
 */
export async function verifyAppleIdentityToken(
  identityToken: string,
  nonce: string,
  opts: { jwks?: JWTVerifyGetKey } = {},
): Promise<VerifiedIdentity> {
  const jwks = opts.jwks ?? defaultAppleJwks();

  let claims;
  try {
    const result = await jwtVerify(identityToken, jwks, {
      issuer: APPLE_ISSUER,
      audience: APPLE_AUDIENCE,
    });
    claims = result.payload;
  } catch {
    throw new ApiError({
      code: "invalid_identity_token",
      status: 401,
      message: "Invalid Apple identity token.",
    });
  }

  const expectedNonce = await sha256Hex(nonce);
  if (claims.nonce !== expectedNonce) {
    throw new ApiError({ code: "invalid_identity_token", status: 401, message: "Nonce mismatch." });
  }

  const sub = typeof claims.sub === "string" ? claims.sub : null;
  if (!sub) {
    throw new ApiError({
      code: "invalid_identity_token",
      status: 401,
      message: "Missing subject claim.",
    });
  }

  return {
    sub,
    email: optionalString(claims.email),
    emailVerified: claims.email_verified === true || claims.email_verified === "true",
    givenName: null,
    familyName: null,
  };
}

/** Verifies a Google ID token: signature against Google's JWKS, `aud`, issuer. */
export async function verifyGoogleIdToken(
  idToken: string,
  opts: { jwks?: JWTVerifyGetKey } = {},
): Promise<VerifiedIdentity> {
  const jwks = opts.jwks ?? defaultGoogleJwks();

  const audience = process.env.GOOGLE_IOS_CLIENT_ID;
  if (!audience) {
    console.error("[api] missing GOOGLE_IOS_CLIENT_ID");
    throw new ApiError({
      code: "internal",
      status: 500,
      message: "Something went wrong. Please try again.",
    });
  }

  let claims;
  try {
    const result = await jwtVerify(idToken, jwks, {
      issuer: GOOGLE_ISSUERS,
      audience,
    });
    claims = result.payload;
  } catch {
    throw new ApiError({
      code: "invalid_identity_token",
      status: 401,
      message: "Invalid Google identity token.",
    });
  }

  const sub = typeof claims.sub === "string" ? claims.sub : null;
  if (!sub) {
    throw new ApiError({
      code: "invalid_identity_token",
      status: 401,
      message: "Missing subject claim.",
    });
  }

  return {
    sub,
    email: optionalString(claims.email),
    emailVerified: claims.email_verified === true || claims.email_verified === "true",
    givenName: optionalString(claims.given_name),
    familyName: optionalString(claims.family_name),
  };
}
