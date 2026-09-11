import { generateKeyPairSync, sign as nodeSign } from "crypto";
import { describe, expect, it, mock } from "bun:test";
import { createApiRouteHandler } from "@/lib/api/define-route";
import type { ApiContext } from "@/lib/api/auth";
import { hashClientData, registerAppAttestKey } from "@/lib/app-attest.server";
import { passwordRouteOptions } from "./password";

/**
 * Minimal in-memory Supabase-shaped fake for `.from(table).select().eq()
 * .maybeSingle()`, `.update().eq()`, and `.upsert()` — the shapes
 * rate-limit.ts and app-attest.server.ts use. Mirrors the fake in
 * src/lib/api/define-route.test.ts. Test-only; never shipped.
 */
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
  } as unknown as ApiContext["admin"] & { rowsFor: typeof rowsFor };
}

// --- A tiny CBOR *encoder*, test-only: duplicated from
// src/lib/app-attest.server.test.ts (kept in sync with it) so this file can
// build a real registered key + a genuinely-valid, correctly-signed
// assertion without importing a test file from another test file. Just
// enough to build the two fixtures this file needs. Never shipped. --------

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
    [cText("attStmt"), cMap([])], // certificate chain deliberately omitted — never parsed
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

/**
 * Builds the route's handler with an injected fake `admin` for the
 * route-level rate limit (`createApiRouteHandler`'s own `deps.admin`), and
 * mocks `@/integrations/supabase/client.server` with the SAME fake so the
 * handler body's own direct `supabaseAdmin` uses (the per-identifier rate
 * limit, `resolveSignInEmail`, and the App Attest check) see it too — that
 * module import is live, so this retroactive mock reaches an
 * already-loaded `password.ts` (proven in coach-resources.server.test.ts's
 * withFakeAdminStorage). Unlike testing through the file route's own
 * `Route` export, going through `passwordRouteOptions()` +
 * `createApiRouteHandler` directly sidesteps `define-route.ts`'s
 * module-level `defaultDeps` (frozen to the real client the first time
 * *any* route built via `defineApiRoute` is imported in this test run),
 * which otherwise makes the route-level rate limiter hit a real (and here,
 * fake-configured) Supabase project.
 */
async function withPasswordRoute<T>(
  admin: ApiContext["admin"],
  run: (POST: (args: { request: Request }) => Promise<Response>) => Promise<T>,
): Promise<T> {
  const real = await import("@/integrations/supabase/client.server");
  mock.module("@/integrations/supabase/client.server", () => ({ ...real, supabaseAdmin: admin }));
  try {
    const { POST } = createApiRouteHandler(passwordRouteOptions(), {
      admin,
      authenticate: async () => null,
    });
    return await run(POST!);
  } finally {
    mock.module("@/integrations/supabase/client.server", () => real);
  }
}

describe("POST /api/v1/auth/password — App Attest headers never change the response", () => {
  it("returns a byte-identical response whether the attest headers are absent, well-formed but unknown, garbage, or a genuinely valid and verified assertion", async () => {
    process.env.API_V1_ENABLED = "true";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_PUBLISHABLE_KEY = "pub-key";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
    process.env.APPLE_TEAM_ID = "TEAMID1234";

    const admin = createFakeAdmin();
    const originalFetch = globalThis.fetch;
    // goTrueRequest hits GoTrue directly; stub it to a fixed successful grant
    // so every call below produces the same body regardless of attest headers.
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ access_token: "a", refresh_token: "b", expires_in: 3600 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;

    // The exact request body every case below sends, so the clientDataHash
    // computed for the "genuinely valid" case matches what password.ts will
    // hash from its own parsed input.
    const requestBody = { identifier: "coach@example.com", password: "hunter2" };

    // A key genuinely registered (as registration would leave it) so the
    // "garbage assertion" case exercises decodeAssertion's failure path
    // (row found, then a decode error) rather than short-circuiting on an
    // unknown key_id the way the "unknown key" case does.
    const registeredForGarbage = generateP256();
    await registerAppAttestKey(admin, {
      userId: "user-1",
      keyId: "garbage-key",
      attestationObjectB64: buildAttestationObjectB64({
        credentialId: "garbage-key",
        x: registeredForGarbage.x,
        y: registeredForGarbage.y,
      }),
      bundleId: "training.gradus.app",
      environment: "development",
    });

    // A second key, registered and then driven through a real, correctly
    // signed, counter-advancing assertion — the "verified" outcome
    // (app-attest.server.test.ts's "verifies a real assertion end to end"
    // exercises this against `logAppAttestAssertion` directly; this drives
    // the same outcome through the actual HTTP route).
    const registeredForVerified = generateP256();
    await registerAppAttestKey(admin, {
      userId: "user-1",
      keyId: "verified-key",
      attestationObjectB64: buildAttestationObjectB64({
        credentialId: "verified-key",
        x: registeredForVerified.x,
        y: registeredForVerified.y,
      }),
      bundleId: "training.gradus.app",
      environment: "development",
    });
    const clientDataHash = hashClientData(new TextEncoder().encode(JSON.stringify(requestBody)));
    const validAssertion = buildAssertion({
      privateKey: registeredForVerified.privateKey,
      signCount: 1,
      clientDataHash,
    });

    try {
      await withPasswordRoute(admin, async (POST) => {
        const makeRequest = (headers: Record<string, string> = {}) =>
          new Request("https://gradus.training/api/v1/auth/password", {
            method: "POST",
            headers: { "content-type": "application/json", ...headers },
            body: JSON.stringify(requestBody),
          });

        const baseline = await POST({ request: makeRequest() });
        const baselineText = await baseline.text();

        const withUnknownKey = await POST({
          request: makeRequest({
            "x-gradus-attest-key-id": "no-such-key",
            "x-gradus-attest-assertion": Buffer.from("irrelevant").toString("base64"),
          }),
        });
        const withUnknownKeyText = await withUnknownKey.text();

        const withGarbage = await POST({
          request: makeRequest({
            "x-gradus-attest-key-id": "garbage-key",
            "x-gradus-attest-assertion": "%%%not base64 or cbor%%%",
          }),
        });
        const withGarbageText = await withGarbage.text();

        const withValidAssertion = await POST({
          request: makeRequest({
            "x-gradus-attest-key-id": "verified-key",
            "x-gradus-attest-assertion": validAssertion.b64,
          }),
        });
        const withValidAssertionText = await withValidAssertion.text();

        expect(baseline.status).toBe(200);
        expect(withUnknownKey.status).toBe(200);
        expect(withGarbage.status).toBe(200);
        expect(withValidAssertion.status).toBe(200);
        expect(withUnknownKeyText).toBe(baselineText);
        expect(withGarbageText).toBe(baselineText);
        expect(withValidAssertionText).toBe(baselineText);

        // Confirm the "valid assertion" request actually drove
        // logAppAttestAssertion's real `verified` branch (a genuine
        // signature check plus a DB sign_count write) rather than
        // accidentally taking the same unknown-key/decode-failure shortcut
        // as the other cases — otherwise this case would prove nothing
        // beyond what they already do.
        const rows = admin.rowsFor("app_attest_keys");
        const verifiedRow = rows.find((row) => row.key_id === "verified-key");
        expect(verifiedRow?.sign_count).toBe(1);
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns the same 401 shape on a rejected grant, attest headers or not", async () => {
    process.env.API_V1_ENABLED = "true";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_PUBLISHABLE_KEY = "pub-key";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";

    const admin = createFakeAdmin();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "invalid_grant" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;

    try {
      await withPasswordRoute(admin, async (POST) => {
        const makeRequest = (headers: Record<string, string> = {}) =>
          new Request("https://gradus.training/api/v1/auth/password", {
            method: "POST",
            headers: { "content-type": "application/json", ...headers },
            body: JSON.stringify({ identifier: "other-coach@example.com", password: "wrong" }),
          });

        const baseline = await POST({ request: makeRequest() });
        const baselineText = await baseline.text();

        const withHeaders = await POST({
          request: makeRequest({
            "x-gradus-attest-key-id": "no-such-key",
            "x-gradus-attest-assertion": Buffer.from("irrelevant").toString("base64"),
          }),
        });
        const withHeadersText = await withHeaders.text();

        expect(baseline.status).toBe(401);
        expect(withHeaders.status).toBe(401);
        expect(withHeadersText).toBe(baselineText);
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
