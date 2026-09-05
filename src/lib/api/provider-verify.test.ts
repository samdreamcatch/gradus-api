import { describe, expect, it } from "bun:test";
import { SignJWT, generateKeyPair, type JWTVerifyGetKey } from "jose";
import { sha256Hex, verifyAppleIdentityToken, verifyGoogleIdToken } from "./provider-verify";

async function testKeyPair() {
  return generateKeyPair("ES256");
}

function staticJwks(publicKey: CryptoKey): JWTVerifyGetKey {
  return (async () => publicKey) as JWTVerifyGetKey;
}

describe("sha256Hex", () => {
  it("matches the well-known SHA-256 test vector for 'abc'", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("is deterministic and produces 64 lowercase hex characters", async () => {
    const first = await sha256Hex("some-nonce-value");
    const second = await sha256Hex("some-nonce-value");
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("verifyAppleIdentityToken", () => {
  it("accepts a validly signed token with a matching nonce", async () => {
    const { privateKey, publicKey } = await testKeyPair();
    const nonce = "raw-nonce-value";
    const nonceHash = await sha256Hex(nonce);
    const token = await new SignJWT({
      email: "user@example.com",
      email_verified: "true",
      nonce: nonceHash,
    })
      .setProtectedHeader({ alg: "ES256" })
      .setIssuer("https://appleid.apple.com")
      .setAudience("training.gradus.app")
      .setSubject("apple-sub-123")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);

    const identity = await verifyAppleIdentityToken(token, nonce, { jwks: staticJwks(publicKey) });
    expect(identity).toEqual({
      sub: "apple-sub-123",
      email: "user@example.com",
      emailVerified: true,
      givenName: null,
      familyName: null,
    });
  });

  it("rejects a nonce mismatch", async () => {
    const { privateKey, publicKey } = await testKeyPair();
    const token = await new SignJWT({ nonce: "wrong-hash" })
      .setProtectedHeader({ alg: "ES256" })
      .setIssuer("https://appleid.apple.com")
      .setAudience("training.gradus.app")
      .setSubject("apple-sub-123")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);

    await expect(
      verifyAppleIdentityToken(token, "raw-nonce-value", { jwks: staticJwks(publicKey) }),
    ).rejects.toMatchObject({ status: 401, code: "invalid_identity_token" });
  });

  it("rejects the wrong audience", async () => {
    const { privateKey, publicKey } = await testKeyPair();
    const nonce = "raw-nonce-value";
    const token = await new SignJWT({ nonce: await sha256Hex(nonce) })
      .setProtectedHeader({ alg: "ES256" })
      .setIssuer("https://appleid.apple.com")
      .setAudience("some.other.app")
      .setSubject("apple-sub-123")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);

    await expect(
      verifyAppleIdentityToken(token, nonce, { jwks: staticJwks(publicKey) }),
    ).rejects.toMatchObject({ status: 401 });
  });
});

describe("verifyGoogleIdToken", () => {
  const prevClientId = process.env.GOOGLE_IOS_CLIENT_ID;

  it("returns 500 when GOOGLE_IOS_CLIENT_ID isn't configured", async () => {
    delete process.env.GOOGLE_IOS_CLIENT_ID;
    await expect(verifyGoogleIdToken("anything")).rejects.toMatchObject({
      status: 500,
      code: "internal",
    });
    if (prevClientId) process.env.GOOGLE_IOS_CLIENT_ID = prevClientId;
  });

  it("accepts a validly signed token for the configured client id", async () => {
    process.env.GOOGLE_IOS_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
    const { privateKey, publicKey } = await testKeyPair();
    const token = await new SignJWT({
      email: "user@example.com",
      email_verified: true,
      given_name: "Tami",
      family_name: "Taylor",
    })
      .setProtectedHeader({ alg: "ES256" })
      .setIssuer("https://accounts.google.com")
      .setAudience("test-client-id.apps.googleusercontent.com")
      .setSubject("google-sub-456")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);

    const identity = await verifyGoogleIdToken(token, { jwks: staticJwks(publicKey) });
    expect(identity).toEqual({
      sub: "google-sub-456",
      email: "user@example.com",
      emailVerified: true,
      givenName: "Tami",
      familyName: "Taylor",
    });

    if (prevClientId) process.env.GOOGLE_IOS_CLIENT_ID = prevClientId;
    else delete process.env.GOOGLE_IOS_CLIENT_ID;
  });

  it("rejects the wrong audience", async () => {
    process.env.GOOGLE_IOS_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
    const { privateKey, publicKey } = await testKeyPair();
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "ES256" })
      .setIssuer("https://accounts.google.com")
      .setAudience("someone-elses-client-id")
      .setSubject("google-sub-456")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);

    await expect(verifyGoogleIdToken(token, { jwks: staticJwks(publicKey) })).rejects.toMatchObject(
      {
        status: 401,
      },
    );

    if (prevClientId) process.env.GOOGLE_IOS_CLIENT_ID = prevClientId;
    else delete process.env.GOOGLE_IOS_CLIENT_ID;
  });
});
