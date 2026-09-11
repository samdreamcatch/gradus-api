/**
 * App Attest server plumbing (docs/ios/PRD.md §3.8, I15) — dormant this
 * wave: registration writes real rows, but the assertion check that reads
 * them is wired into `password.ts` as log-only and never affects the
 * response (see that file's call site and its "never enforcing" test).
 *
 * Covers two independent things:
 *  1. Registration (`POST /api/v1/auth/attest/register`): decode a
 *     DCAppAttestService attestation object just far enough to pull out the
 *     device's public key, trust it on first use, and store it.
 *  2. Assertion verification: given a later signed assertion plus the
 *     stored key, verify the ECDSA-P256 signature and that its counter has
 *     advanced.
 *
 * No CBOR/COSE library exists in this repo (`jose` is JWS/JWK-only) and
 * pulling one in for two structures is out of proportion, so this file
 * includes a minimal CBOR decoder scoped to exactly what Apple's
 * attestation object and assertion need: definite-length maps, arrays, byte
 * strings, text strings, and (positive/negative) integers. It does not
 * support indefinite-length items, floats, tags, or simple values (true/
 * false/null/undefined) — none of which appear in these two structures —
 * and throws a clear error if it ever meets one.
 *
 * Explicitly NOT implemented (see PR body "Known limitations"): the
 * attestation statement's X.509 certificate chain to Apple's App Attest
 * root CA is never parsed or verified. Registration is trust-on-first-use
 * only, per decisions.md.
 */
import { createHash } from "crypto";
import type { ApiContext } from "./api/auth";

// --- Minimal CBOR (definite-length subset) ---------------------------------

type CborValue = number | string | Uint8Array | CborValue[] | Map<number | string, CborValue>;

function readUintOrLength(
  bytes: Uint8Array,
  offset: number,
  additionalInfo: number,
): [number, number] {
  if (additionalInfo <= 23) return [additionalInfo, offset];
  if (additionalInfo === 24) return [bytes[offset], offset + 1];
  if (additionalInfo === 25) return [(bytes[offset] << 8) | bytes[offset + 1], offset + 2];
  if (additionalInfo === 26) {
    const value =
      bytes[offset] * 2 ** 24 +
      ((bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]);
    return [value >>> 0, offset + 4];
  }
  if (additionalInfo === 27) {
    // 8-byte length/value. Neither structure this decoder targets ever
    // needs a count this large; supported for completeness, not exercised.
    let value = 0n;
    for (let i = 0; i < 8; i++) value = (value << 8n) | BigInt(bytes[offset + i]);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("CBOR: 8-byte length/value exceeds Number.MAX_SAFE_INTEGER");
    }
    return [Number(value), offset + 8];
  }
  throw new Error(
    `CBOR: unsupported additional information ${additionalInfo} (indefinite-length items aren't supported)`,
  );
}

/** Decodes exactly one CBOR item starting at `offset`. Returns the value and the offset just past it. */
function decodeCborItem(bytes: Uint8Array, offset: number): [CborValue, number] {
  if (offset >= bytes.length) throw new Error("CBOR: unexpected end of input");
  const head = bytes[offset];
  const majorType = head >> 5;
  const additionalInfo = head & 0x1f;
  offset += 1;

  switch (majorType) {
    case 0: {
      // unsigned int
      const [value, next] = readUintOrLength(bytes, offset, additionalInfo);
      return [value, next];
    }
    case 1: {
      // negative int: -1 - n
      const [n, next] = readUintOrLength(bytes, offset, additionalInfo);
      return [-1 - n, next];
    }
    case 2: {
      // byte string
      const [len, next] = readUintOrLength(bytes, offset, additionalInfo);
      return [bytes.slice(next, next + len), next + len];
    }
    case 3: {
      // text string
      const [len, next] = readUintOrLength(bytes, offset, additionalInfo);
      return [new TextDecoder().decode(bytes.slice(next, next + len)), next + len];
    }
    case 4: {
      // array
      const [len, next] = readUintOrLength(bytes, offset, additionalInfo);
      const arr: CborValue[] = [];
      let cursor = next;
      for (let i = 0; i < len; i++) {
        const [item, after] = decodeCborItem(bytes, cursor);
        arr.push(item);
        cursor = after;
      }
      return [arr, cursor];
    }
    case 5: {
      // map
      const [len, next] = readUintOrLength(bytes, offset, additionalInfo);
      const map = new Map<number | string, CborValue>();
      let cursor = next;
      for (let i = 0; i < len; i++) {
        const [key, afterKey] = decodeCborItem(bytes, cursor);
        const [value, afterValue] = decodeCborItem(bytes, afterKey);
        if (typeof key !== "number" && typeof key !== "string") {
          throw new Error("CBOR: map key must be an integer or text string");
        }
        map.set(key, value);
        cursor = afterValue;
      }
      return [map, cursor];
    }
    default:
      throw new Error(`CBOR: unsupported major type ${majorType} (only 0-5 are needed here)`);
  }
}

/** Decodes a single top-level CBOR item from `base64`-encoded bytes. */
function decodeCborDocument(base64: string): CborValue {
  const bytes = Buffer.from(base64, "base64");
  const [value] = decodeCborItem(
    new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    0,
  );
  return value;
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function base64ToBytes(base64: string): Uint8Array {
  const buf = Buffer.from(base64, "base64");
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

// --- Attestation object → COSE public key ----------------------------------

/**
 * Pulls `authData` out of the top-level attestation-object CBOR map.
 * Deliberately ignores `fmt` and `attStmt` (the certificate chain lives in
 * `attStmt` — see the module doc's "Known limitations": no chain-of-trust
 * validation is performed).
 */
export function parseAttestationObject(attestationObjectB64: string): { authData: Uint8Array } {
  const top = decodeCborDocument(attestationObjectB64);
  if (!(top instanceof Map))
    throw new Error("attestation object: expected a CBOR map at the top level");
  const authData = top.get("authData");
  if (!(authData instanceof Uint8Array)) {
    throw new Error('attestation object: missing or invalid "authData"');
  }
  return { authData };
}

export interface ParsedAuthenticatorData {
  rpIdHash: Uint8Array;
  flags: number;
  signCount: number;
  /** Present only when the attested-credential-data flag (0x40) is set — true for registration, absent from a later assertion's authData. */
  attestedCredentialData?: {
    aaguid: Uint8Array;
    credentialId: Uint8Array;
    /** The remaining bytes: a CBOR-encoded COSE_Key. */
    coseKeyBytes: Uint8Array;
  };
}

const AUTH_DATA_FIXED_HEADER_LENGTH = 37; // rpIdHash(32) + flags(1) + signCount(4)
const ATTESTED_CREDENTIAL_DATA_FLAG = 0x40;

/** Parses WebAuthn/App Attest `authData`'s fixed binary layout (not CBOR — a plain big-endian struct). */
export function parseAuthenticatorData(authData: Uint8Array): ParsedAuthenticatorData {
  if (authData.length < AUTH_DATA_FIXED_HEADER_LENGTH) {
    throw new Error(
      `authData: shorter than the fixed ${AUTH_DATA_FIXED_HEADER_LENGTH}-byte header`,
    );
  }
  const rpIdHash = authData.slice(0, 32);
  const flags = authData[32];
  const signCount =
    ((authData[33] << 24) | (authData[34] << 16) | (authData[35] << 8) | authData[36]) >>> 0;

  if (!(flags & ATTESTED_CREDENTIAL_DATA_FLAG)) {
    return { rpIdHash, flags, signCount };
  }

  let offset = AUTH_DATA_FIXED_HEADER_LENGTH;
  const aaguid = authData.slice(offset, offset + 16);
  offset += 16;
  const credentialIdLength = (authData[offset] << 8) | authData[offset + 1];
  offset += 2;
  const credentialId = authData.slice(offset, offset + credentialIdLength);
  offset += credentialIdLength;
  const coseKeyBytes = authData.slice(offset);

  return {
    rpIdHash,
    flags,
    signCount,
    attestedCredentialData: { aaguid, credentialId, coseKeyBytes },
  };
}

const COSE_KTY_EC2 = 2;
const COSE_CRV_P256 = 1;

/**
 * Decodes a COSE_Key (EC2/P-256 only — the only shape App Attest issues)
 * and returns the raw uncompressed EC point: `0x04 || x || y` (65 bytes),
 * the format WebCrypto's `importKey("raw", ...)` accepts directly.
 */
export function extractRawPublicKeyFromCose(coseKeyBytes: Uint8Array): Uint8Array {
  const [key] = decodeCborItem(coseKeyBytes, 0);
  if (!(key instanceof Map)) throw new Error("COSE_Key: expected a CBOR map");
  const kty = key.get(1);
  const crv = key.get(-1);
  const x = key.get(-2);
  const y = key.get(-3);
  if (kty !== COSE_KTY_EC2)
    throw new Error(`COSE_Key: unsupported kty ${String(kty)} (expected 2 = EC2)`);
  if (crv !== COSE_CRV_P256)
    throw new Error(`COSE_Key: unsupported crv ${String(crv)} (expected 1 = P-256)`);
  if (!(x instanceof Uint8Array) || x.length !== 32)
    throw new Error("COSE_Key: missing or invalid x coordinate");
  if (!(y instanceof Uint8Array) || y.length !== 32)
    throw new Error("COSE_Key: missing or invalid y coordinate");

  const raw = new Uint8Array(65);
  raw[0] = 0x04;
  raw.set(x, 1);
  raw.set(y, 33);
  return raw;
}

// --- Registration -----------------------------------------------------------

type AppAttestKeyRow = {
  key_id: string;
  public_key: string;
  sign_count: number;
  revoked_at: string | null;
};

/**
 * `app_attest_keys` isn't in the generated Supabase `Database` type (that
 * codegen runs separately), so access is cast the same way
 * `src/lib/api/auth-broker.ts` already does for `auth_identities`.
 */
type AppAttestKeysTable = {
  from: (table: "app_attest_keys") => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: string,
      ) => { maybeSingle: () => Promise<{ data: AppAttestKeyRow | null; error: unknown }> };
    };
    update: (patch: Record<string, unknown>) => {
      eq: (column: string, value: string) => Promise<{ data: unknown; error: unknown }>;
    };
    upsert: (
      row: Record<string, unknown>,
      opts: { onConflict: string },
    ) => Promise<{ data: unknown; error: unknown }>;
  };
};

export interface RegisterAppAttestKeyInput {
  userId: string;
  keyId: string;
  attestationObjectB64: string;
  bundleId: string;
  environment: "development" | "production";
}

/**
 * Trust-on-first-use registration: decode the attestation object only far
 * enough to reach the COSE public key (module doc), then upsert on
 * `key_id` so a repeat registration of the same key (a normal client retry
 * path per decisions.md) refreshes the row instead of erroring — resetting
 * `sign_count` to 0, matching a freshly (re-)generated key.
 *
 * This is a dedicated registration call, not inline in the sign-in path, so
 * it fails loudly (throws) rather than swallowing errors — nothing that
 * calls it is allowed to be on a path that blocks the user if it fails;
 * that's enforced client-side, not here.
 */
export async function registerAppAttestKey(
  admin: ApiContext["admin"],
  input: RegisterAppAttestKeyInput,
): Promise<void> {
  const teamId = process.env.APPLE_TEAM_ID;
  if (!teamId) {
    // decisions.md's input schema for this route has no `teamId` field (the
    // real App ID hash inside authData is a one-way SHA-256 of team+bundle
    // id, not recoverable), so team_id — NOT NULL in the migration — comes
    // from server config instead, reusing the same APPLE_TEAM_ID env var
    // Sign in with Apple already relies on (src/lib/api/auth-broker.ts).
    // Deviation from decisions.md's literal input list; see PR body.
    throw new Error("[app-attest] APPLE_TEAM_ID is not configured; cannot register a key");
  }

  const { authData } = parseAttestationObject(input.attestationObjectB64);
  const parsed = parseAuthenticatorData(authData);
  if (!parsed.attestedCredentialData) {
    throw new Error("[app-attest] attestation object's authData has no attested credential data");
  }
  const rawPublicKey = extractRawPublicKeyFromCose(parsed.attestedCredentialData.coseKeyBytes);

  const { error } = await (admin as unknown as AppAttestKeysTable).from("app_attest_keys").upsert(
    {
      key_id: input.keyId,
      user_id: input.userId,
      public_key: bytesToBase64(rawPublicKey),
      sign_count: 0,
      team_id: teamId,
      bundle_id: input.bundleId,
      environment: input.environment,
      revoked_at: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key_id" },
  );
  if (error) {
    console.error("[app-attest] register upsert failed", JSON.stringify(error));
    throw new Error("[app-attest] failed to store the attestation key");
  }
}

// --- Assertion verification (log-only from password.ts) --------------------

export interface AppAttestAssertion {
  signature: Uint8Array;
  authenticatorData: Uint8Array;
}

/** Decodes an assertion's `{signature, authenticatorData}` CBOR map. */
export function decodeAssertion(assertionB64: string): AppAttestAssertion {
  const top = decodeCborDocument(assertionB64);
  if (!(top instanceof Map)) throw new Error("assertion: expected a CBOR map at the top level");
  const signature = top.get("signature");
  const authenticatorData = top.get("authenticatorData");
  if (!(signature instanceof Uint8Array))
    throw new Error('assertion: missing or invalid "signature"');
  if (!(authenticatorData instanceof Uint8Array)) {
    throw new Error('assertion: missing or invalid "authenticatorData"');
  }
  return { signature, authenticatorData };
}

export function assertionSignCount(authenticatorData: Uint8Array): number {
  if (authenticatorData.length < AUTH_DATA_FIXED_HEADER_LENGTH) {
    throw new Error(
      `authenticatorData: shorter than the fixed ${AUTH_DATA_FIXED_HEADER_LENGTH}-byte header`,
    );
  }
  return (
    ((authenticatorData[33] << 24) |
      (authenticatorData[34] << 16) |
      (authenticatorData[35] << 8) |
      authenticatorData[36]) >>>
    0
  );
}

/**
 * Converts a DER-encoded ECDSA signature (what DCAppAttestService produces,
 * and Node's `crypto.sign` produces by default — used to build the test
 * fixture) to the fixed-width raw `r || s` format WebCrypto's `verify`
 * requires for P-256 (32 bytes each), left-padding or trimming a leading
 * zero as needed.
 */
export function derSignatureToRaw(der: Uint8Array, coordinateLength = 32): Uint8Array {
  let offset = 0;
  if (der[offset++] !== 0x30) throw new Error("DER signature: expected a SEQUENCE tag");
  const seqLenByte = der[offset++];
  if (seqLenByte & 0x80) offset += seqLenByte & 0x7f; // skip long-form length bytes; not needed below

  function readInteger(): Uint8Array {
    if (der[offset++] !== 0x02) throw new Error("DER signature: expected an INTEGER tag");
    let len = der[offset++];
    if (len & 0x80) {
      const lenBytes = len & 0x7f;
      len = 0;
      for (let i = 0; i < lenBytes; i++) len = (len << 8) | der[offset++];
    }
    const value = der.slice(offset, offset + len);
    offset += len;
    return value;
  }

  const fixedWidth = (value: Uint8Array): Uint8Array => {
    let trimmed = value;
    while (trimmed.length > coordinateLength && trimmed[0] === 0) trimmed = trimmed.slice(1);
    if (trimmed.length > coordinateLength) {
      throw new Error("DER signature: integer longer than the curve order");
    }
    const out = new Uint8Array(coordinateLength);
    out.set(trimmed, coordinateLength - trimmed.length);
    return out;
  };

  const r = fixedWidth(readInteger());
  const s = fixedWidth(readInteger());
  const raw = new Uint8Array(coordinateLength * 2);
  raw.set(r, 0);
  raw.set(s, coordinateLength);
  return raw;
}

/**
 * Verifies a DER-encoded ECDSA-P256 signature over `message` against a raw
 * (`0x04 || x || y`) public key, via the Workers-runtime WebCrypto
 * `crypto.subtle`. Never throws — any decode or crypto failure is logged
 * and treated as an invalid signature, matching the "reject-and-log, never
 * reject-and-throw" contract this feeds into.
 */
export async function verifyEcdsaP256Signature(params: {
  publicKeyRaw: Uint8Array;
  signatureDer: Uint8Array;
  message: Uint8Array;
}): Promise<boolean> {
  try {
    // `new Uint8Array(...)` always allocates a fresh, plain `ArrayBuffer`
    // (never a `SharedArrayBuffer`), which is what WebCrypto's `BufferSource`
    // parameters require — the plain `Uint8Array` type our own functions use
    // doesn't statically guarantee that on its own.
    const key = await crypto.subtle.importKey(
      "raw",
      new Uint8Array(params.publicKeyRaw),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const rawSignature = derSignatureToRaw(params.signatureDer);
    return await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      new Uint8Array(rawSignature),
      new Uint8Array(params.message),
    );
  } catch (err) {
    console.error("[app-attest] signature verify threw", err instanceof Error ? err.message : err);
    return false;
  }
}

export type AssertionCheckResult =
  | { ok: true; newSignCount: number }
  | { ok: false; reason: "invalid_signature" | "counter_not_advanced" };

/**
 * The pure, directly-testable verification unit: checks the assertion's
 * signature against the stored public key, then that its counter strictly
 * exceeds the stored one (App Attest's replay defense — a real device's
 * Secure Enclave counter only ever increases). Takes no DB dependency so
 * it's testable with a plain generated keypair (see
 * app-attest.server.test.ts), independent of `logAppAttestAssertion`'s
 * lookup/update plumbing below.
 */
export async function checkAppAttestAssertion(params: {
  publicKeyRaw: Uint8Array;
  storedSignCount: number;
  assertion: AppAttestAssertion;
  clientDataHash: Uint8Array;
}): Promise<AssertionCheckResult> {
  const message = concatBytes(params.assertion.authenticatorData, params.clientDataHash);
  const validSignature = await verifyEcdsaP256Signature({
    publicKeyRaw: params.publicKeyRaw,
    signatureDer: params.assertion.signature,
    message,
  });
  if (!validSignature) return { ok: false, reason: "invalid_signature" };

  const newSignCount = assertionSignCount(params.assertion.authenticatorData);
  if (newSignCount <= params.storedSignCount) return { ok: false, reason: "counter_not_advanced" };
  return { ok: true, newSignCount };
}

export type AppAttestLogOutcome =
  | "unknown_key"
  | "invalid_signature"
  | "counter_not_advanced"
  | "verified";

/**
 * The log-only entry point `password.ts` calls when both attest headers are
 * present. Looks up the stored key, runs `checkAppAttestAssertion`, and on
 * success advances the stored `sign_count` — but NEVER throws, and its
 * return value must never be read by anything that affects a response; see
 * password.ts's call site and password.test.ts's "never enforcing" test.
 */
export async function logAppAttestAssertion(
  admin: ApiContext["admin"],
  params: { keyId: string; assertionB64: string; clientDataHash: Uint8Array },
): Promise<AppAttestLogOutcome> {
  try {
    const { data: row, error } = await (admin as unknown as AppAttestKeysTable)
      .from("app_attest_keys")
      .select("key_id, public_key, sign_count, revoked_at")
      .eq("key_id", params.keyId)
      .maybeSingle();
    if (error) {
      console.warn("[app-attest] key lookup failed", JSON.stringify(error));
      return "unknown_key";
    }
    if (!row || row.revoked_at) return "unknown_key";

    const assertion = decodeAssertion(params.assertionB64);
    const result = await checkAppAttestAssertion({
      publicKeyRaw: base64ToBytes(row.public_key),
      storedSignCount: row.sign_count,
      assertion,
      clientDataHash: params.clientDataHash,
    });
    if (!result.ok) return result.reason;

    const { error: updateError } = await (admin as unknown as AppAttestKeysTable)
      .from("app_attest_keys")
      .update({ sign_count: result.newSignCount, updated_at: new Date().toISOString() })
      .eq("key_id", params.keyId);
    if (updateError) {
      console.warn("[app-attest] sign_count update failed", JSON.stringify(updateError));
    }
    return "verified";
  } catch (err) {
    console.error("[app-attest] assertion check threw", err instanceof Error ? err.message : err);
    return "unknown_key";
  }
}

/**
 * SHA-256 of whatever bytes the caller treats as "clientData" — the
 * `clientDataHash` an assertion's signature covers. Named after (and
 * hashed the same way as) `hashRequestBody` in idempotency.ts, but takes a
 * `Uint8Array` rather than the literal wire body: by the time password.ts's
 * handler runs, define-route.ts has already consumed the request body
 * parsing JSON, so it hashes a canonical re-serialization of the already-
 * parsed input instead (see that route's call site) — a v1 simplification,
 * fine for a log-only check that never gates the response.
 */
export function hashClientData(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(Buffer.from(bytes)).digest());
}
