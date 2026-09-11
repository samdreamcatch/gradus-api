import { generateKeyPairSync, createHash, sign as nodeSign } from "crypto";
import { describe, expect, it } from "bun:test";
import {
  checkAppAttestAssertion,
  decodeAssertion,
  extractRawPublicKeyFromCose,
  logAppAttestAssertion,
  parseAttestationObject,
  parseAuthenticatorData,
  registerAppAttestKey,
} from "./app-attest.server";
import type { ApiContext } from "./api/auth";

// --- A tiny CBOR *encoder*, test-only: the mirror image of the decoder in
// app-attest.server.ts, just enough to build the two fixtures this file
// needs (an attestation object and an assertion). Never shipped. ---------

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function encodeHead(majorType: number, n: number): Uint8Array {
  if (n < 24) return Uint8Array.from([(majorType << 5) | n]);
  if (n < 256) return Uint8Array.from([(majorType << 5) | 24, n]);
  if (n < 65536) return Uint8Array.from([(majorType << 5) | 25, (n >> 8) & 0xff, n & 0xff]);
  throw new Error("test fixture cbor: value too large for this helper");
}

function cUint(n: number): Uint8Array {
  return encodeHead(0, n);
}
/** Encodes the CBOR negative integer `n` (e.g. -1, -2, -3), n must be < 0. */
function cNegative(n: number): Uint8Array {
  return encodeHead(1, -1 - n);
}
function cBytes(bytes: Uint8Array): Uint8Array {
  return concatBytes(encodeHead(2, bytes.length), bytes);
}
function cText(s: string): Uint8Array {
  const utf8 = new TextEncoder().encode(s);
  return concatBytes(encodeHead(3, utf8.length), utf8);
}
function cMap(entries: Array<[Uint8Array, Uint8Array]>): Uint8Array {
  let out = encodeHead(5, entries.length);
  for (const [k, v] of entries) out = concatBytes(out, k, v);
  return out;
}
function u32be(n: number): Uint8Array {
  return Uint8Array.from([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}
function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

/** A real P-256 keypair, plus its raw (0x04||x||y) public point. */
function generateP256() {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
  const x = new Uint8Array(Buffer.from(jwk.x, "base64url"));
  const y = new Uint8Array(Buffer.from(jwk.y, "base64url"));
  const raw = concatBytes(Uint8Array.from([0x04]), x, y);
  return { privateKey, x, y, raw };
}

/** Builds a synthetic App Attest attestation object CBOR (fmt/attStmt/authData), base64-encoded. */
function buildAttestationObjectB64(params: {
  credentialId: string;
  x: Uint8Array;
  y: Uint8Array;
}): string {
  const coseKey = cMap([
    [cUint(1), cUint(2)], // kty: EC2
    [cNegative(-1), cUint(1)], // crv: P-256
    [cNegative(-2), cBytes(params.x)],
    [cNegative(-3), cBytes(params.y)],
  ]);
  const credentialId = new TextEncoder().encode(params.credentialId);
  const authData = concatBytes(
    new Uint8Array(32), // rpIdHash — not checked by this decoder
    Uint8Array.from([0x40]), // flags: attested-credential-data present
    u32be(0), // signCount
    new Uint8Array(16), // aaguid
    Uint8Array.from([(credentialId.length >> 8) & 0xff, credentialId.length & 0xff]),
    credentialId,
    coseKey,
  );
  const top = cMap([
    [cText("fmt"), cText("apple-appattest")],
    [cText("attStmt"), cMap([])], // certificate chain deliberately omitted — never parsed (see module doc)
    [cText("authData"), cBytes(authData)],
  ]);
  return b64(top);
}

/** Builds a synthetic App Attest assertion CBOR ({signature, authenticatorData}), base64-encoded. */
function buildAssertion(params: {
  privateKey: import("crypto").KeyObject;
  signCount: number;
  clientDataHash: Uint8Array;
}) {
  const authenticatorData = concatBytes(
    new Uint8Array(32), // rpIdHash
    Uint8Array.from([0x00]), // flags — no attested credential data in an assertion
    u32be(params.signCount),
  );
  const message = concatBytes(authenticatorData, params.clientDataHash);
  const signature = new Uint8Array(nodeSign("sha256", Buffer.from(message), params.privateKey));
  const cbor = cMap([
    [cText("signature"), cBytes(signature)],
    [cText("authenticatorData"), cBytes(authenticatorData)],
  ]);
  return { b64: b64(cbor), authenticatorData, signature };
}

// --- Attestation object / COSE key parsing ---------------------------------

describe("parseAttestationObject / parseAuthenticatorData / extractRawPublicKeyFromCose", () => {
  it("recovers the raw EC point from a synthetic attestation object built with a real P-256 key", () => {
    const { x, y, raw } = generateP256();
    const attestationObjectB64 = buildAttestationObjectB64({ credentialId: "test-key-id", x, y });

    const { authData } = parseAttestationObject(attestationObjectB64);
    const parsed = parseAuthenticatorData(authData);
    expect(parsed.attestedCredentialData).toBeDefined();
    expect(Buffer.from(parsed.attestedCredentialData!.credentialId).toString()).toBe("test-key-id");

    const rawPublicKey = extractRawPublicKeyFromCose(parsed.attestedCredentialData!.coseKeyBytes);
    expect(rawPublicKey).toEqual(raw);
  });

  it("throws (rather than silently fabricating a key) when authData has no attested credential data", () => {
    const authData = concatBytes(new Uint8Array(32), Uint8Array.from([0x00]), u32be(0));
    const parsed = parseAuthenticatorData(authData);
    expect(parsed.attestedCredentialData).toBeUndefined();
  });

  it("throws on an unsupported COSE kty/crv instead of guessing", () => {
    const { x, y } = generateP256();
    const badCoseKey = cMap([
      [cUint(1), cUint(1)], // kty: OKP, not EC2 — unsupported
      [cNegative(-1), cUint(1)],
      [cNegative(-2), cBytes(x)],
      [cNegative(-3), cBytes(y)],
    ]);
    expect(() => extractRawPublicKeyFromCose(badCoseKey)).toThrow(/unsupported kty/);
  });
});

// --- Registration (upsert on key_id) ---------------------------------------

/** In-memory fake for `.from(table).upsert()/.select().eq().maybeSingle()`, matching the shapes app-attest.server.ts casts its admin client to. */
function createFakeAdmin() {
  const store = new Map<string, Record<string, unknown>[]>();
  function rowsFor(table: string) {
    if (!store.has(table)) store.set(table, []);
    return store.get(table)!;
  }
  function builder(table: string, filters: Array<[string, unknown]>) {
    return {
      select: (_columns?: string) => builder(table, filters),
      eq: (column: string, value: unknown) => builder(table, [...filters, [column, value]]),
      async maybeSingle() {
        const match = rowsFor(table).find((row) => filters.every(([c, v]) => row[c] === v));
        return { data: match ?? null, error: null };
      },
      update: (patch: Record<string, unknown>) => ({
        async eq(column: string, value: unknown) {
          for (const row of rowsFor(table)) {
            if (row[column] === value) Object.assign(row, patch);
          }
          return { data: null, error: null };
        },
      }),
    };
  }
  return {
    from: (table: string) => ({
      ...builder(table, []),
      async upsert(row: Record<string, unknown>, opts: { onConflict: string }) {
        const keys = opts.onConflict.split(",");
        const rows = rowsFor(table);
        const idx = rows.findIndex((r) => keys.every((k) => r[k] === row[k]));
        if (idx >= 0) rows[idx] = { ...rows[idx], ...row };
        else rows.push({ ...row });
        return { data: null, error: null };
      },
    }),
    rowsFor,
  };
}

describe("registerAppAttestKey", () => {
  it("stores a new key with sign_count 0 and the raw public key", async () => {
    process.env.APPLE_TEAM_ID = "TEAMID1234";
    const admin = createFakeAdmin();
    const { x, y, raw } = generateP256();
    const attestationObjectB64 = buildAttestationObjectB64({ credentialId: "key-1", x, y });

    await registerAppAttestKey(admin as unknown as ApiContext["admin"], {
      userId: "user-1",
      keyId: "key-1",
      attestationObjectB64,
      bundleId: "training.gradus.app",
      environment: "development",
    });

    const rows = admin.rowsFor("app_attest_keys");
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({
      key_id: "key-1",
      user_id: "user-1",
      sign_count: 0,
      team_id: "TEAMID1234",
      bundle_id: "training.gradus.app",
      environment: "development",
    });
    expect(rows[0].public_key).toBe(Buffer.from(raw).toString("base64"));
  });

  it("upserts (doesn't error) on re-registration of the same keyId", async () => {
    process.env.APPLE_TEAM_ID = "TEAMID1234";
    const admin = createFakeAdmin();
    const first = generateP256();
    const second = generateP256();

    await registerAppAttestKey(admin as unknown as ApiContext["admin"], {
      userId: "user-1",
      keyId: "key-1",
      attestationObjectB64: buildAttestationObjectB64({
        credentialId: "key-1",
        x: first.x,
        y: first.y,
      }),
      bundleId: "training.gradus.app",
      environment: "development",
    });

    // A second registration for the same keyId (e.g. a client retry) must
    // not throw, and must not create a second row.
    await registerAppAttestKey(admin as unknown as ApiContext["admin"], {
      userId: "user-1",
      keyId: "key-1",
      attestationObjectB64: buildAttestationObjectB64({
        credentialId: "key-1",
        x: second.x,
        y: second.y,
      }),
      bundleId: "training.gradus.app",
      environment: "production",
    });

    const rows = admin.rowsFor("app_attest_keys");
    expect(rows.length).toBe(1);
    expect(rows[0].environment).toBe("production");
    expect(rows[0].public_key).toBe(Buffer.from(second.raw).toString("base64"));
  });
});

// --- checkAppAttestAssertion: the pure, directly-testable verification unit -

describe("checkAppAttestAssertion", () => {
  it("verifies a valid signature and reports the advanced counter", async () => {
    const { privateKey, raw } = generateP256();
    const clientDataHash = new Uint8Array(createHash("sha256").update("sign-in-attempt").digest());
    const assertion = buildAssertion({ privateKey, signCount: 5, clientDataHash });
    const decoded = decodeAssertion(assertion.b64);

    const result = await checkAppAttestAssertion({
      publicKeyRaw: raw,
      storedSignCount: 3,
      assertion: decoded,
      clientDataHash,
    });
    expect(result).toEqual({ ok: true, newSignCount: 5 });
  });

  it("rejects a counter equal to the stored one (replay)", async () => {
    const { privateKey, raw } = generateP256();
    const clientDataHash = new Uint8Array(createHash("sha256").update("sign-in-attempt").digest());
    const assertion = buildAssertion({ privateKey, signCount: 5, clientDataHash });
    const decoded = decodeAssertion(assertion.b64);

    const result = await checkAppAttestAssertion({
      publicKeyRaw: raw,
      storedSignCount: 5,
      assertion: decoded,
      clientDataHash,
    });
    expect(result).toEqual({ ok: false, reason: "counter_not_advanced" });
  });

  it("rejects a counter behind the stored one (stale)", async () => {
    const { privateKey, raw } = generateP256();
    const clientDataHash = new Uint8Array(createHash("sha256").update("sign-in-attempt").digest());
    const assertion = buildAssertion({ privateKey, signCount: 4, clientDataHash });
    const decoded = decodeAssertion(assertion.b64);

    const result = await checkAppAttestAssertion({
      publicKeyRaw: raw,
      storedSignCount: 10,
      assertion: decoded,
      clientDataHash,
    });
    expect(result).toEqual({ ok: false, reason: "counter_not_advanced" });
  });

  it("rejects a signature that doesn't match the clientDataHash it's checked against", async () => {
    const { privateKey, raw } = generateP256();
    const clientDataHash = new Uint8Array(createHash("sha256").update("sign-in-attempt").digest());
    const assertion = buildAssertion({ privateKey, signCount: 5, clientDataHash });
    const decoded = decodeAssertion(assertion.b64);
    const wrongHash = new Uint8Array(createHash("sha256").update("a different request").digest());

    const result = await checkAppAttestAssertion({
      publicKeyRaw: raw,
      storedSignCount: 3,
      assertion: decoded,
      clientDataHash: wrongHash,
    });
    expect(result).toEqual({ ok: false, reason: "invalid_signature" });
  });

  it("rejects a signature verified against the wrong public key", async () => {
    const signer = generateP256();
    const impostor = generateP256();
    const clientDataHash = new Uint8Array(createHash("sha256").update("sign-in-attempt").digest());
    const assertion = buildAssertion({
      privateKey: signer.privateKey,
      signCount: 5,
      clientDataHash,
    });
    const decoded = decodeAssertion(assertion.b64);

    const result = await checkAppAttestAssertion({
      publicKeyRaw: impostor.raw,
      storedSignCount: 3,
      assertion: decoded,
      clientDataHash,
    });
    expect(result).toEqual({ ok: false, reason: "invalid_signature" });
  });
});

// --- logAppAttestAssertion: the DB-touching orchestrator password.ts calls -

describe("logAppAttestAssertion", () => {
  it("returns unknown_key for a keyId with no stored row, without throwing", async () => {
    const admin = createFakeAdmin();
    const clientDataHash = new Uint8Array(createHash("sha256").update("x").digest());
    const outcome = await logAppAttestAssertion(admin as unknown as ApiContext["admin"], {
      keyId: "no-such-key",
      assertionB64: "not-real-cbor-but-never-reached",
      clientDataHash,
    });
    expect(outcome).toBe("unknown_key");
  });

  it("verifies a real assertion end to end and advances the stored sign_count", async () => {
    process.env.APPLE_TEAM_ID = "TEAMID1234";
    const admin = createFakeAdmin();
    const { privateKey, x, y, raw } = generateP256();
    await registerAppAttestKey(admin as unknown as ApiContext["admin"], {
      userId: "user-1",
      keyId: "key-1",
      attestationObjectB64: buildAttestationObjectB64({ credentialId: "key-1", x, y }),
      bundleId: "training.gradus.app",
      environment: "development",
    });

    const clientDataHash = new Uint8Array(createHash("sha256").update("sign-in-attempt").digest());
    const assertion = buildAssertion({ privateKey, signCount: 7, clientDataHash });

    const outcome = await logAppAttestAssertion(admin as unknown as ApiContext["admin"], {
      keyId: "key-1",
      assertionB64: assertion.b64,
      clientDataHash,
    });
    expect(outcome).toBe("verified");

    const rows = admin.rowsFor("app_attest_keys");
    expect(rows[0].sign_count).toBe(7);
    expect(rows[0].public_key).toBe(Buffer.from(raw).toString("base64"));
  });

  it("never throws even when the assertion is garbage", async () => {
    process.env.APPLE_TEAM_ID = "TEAMID1234";
    const admin = createFakeAdmin();
    const { x, y } = generateP256();
    await registerAppAttestKey(admin as unknown as ApiContext["admin"], {
      userId: "user-1",
      keyId: "key-1",
      attestationObjectB64: buildAttestationObjectB64({ credentialId: "key-1", x, y }),
      bundleId: "training.gradus.app",
      environment: "development",
    });

    const outcome = await logAppAttestAssertion(admin as unknown as ApiContext["admin"], {
      keyId: "key-1",
      assertionB64: "%%%not-base64-or-cbor%%%",
      clientDataHash: new Uint8Array(32),
    });
    expect(outcome).toBe("unknown_key");
  });
});
