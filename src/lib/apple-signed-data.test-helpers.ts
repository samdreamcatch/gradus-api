/**
 * Test-only helpers for anything that verifies App Store JWS: sign a payload
 * the way the App Store does, with the throwaway chain in
 * `apple-signed-data.fixtures.ts`, and the roots that trust it.
 */
import {
  TEST_INTERMEDIATE_B64,
  TEST_LEAF_B64,
  TEST_LEAF_JWK,
  TEST_ROOT_B64,
} from "./apple-signed-data.fixtures";

export const der = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
export const TEST_ROOTS = [der(TEST_ROOT_B64)];
export const TEST_CHAIN = [TEST_LEAF_B64, TEST_INTERMEDIATE_B64, TEST_ROOT_B64];

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
export const enc = (value: unknown) => b64url(new TextEncoder().encode(JSON.stringify(value)));

/** Sign `payload` the way the App Store does, with the test leaf key. */
export async function signTestJws(
  payload: Record<string, unknown>,
  opts: { x5c?: string[]; alg?: string } = {},
): Promise<string> {
  const header = enc({ alg: opts.alg ?? "ES256", x5c: opts.x5c ?? TEST_CHAIN });
  const body = enc(payload);
  const key = await crypto.subtle.importKey(
    "jwk",
    { ...TEST_LEAF_JWK, ext: true },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      new TextEncoder().encode(`${header}.${body}`),
    ),
  );
  return `${header}.${body}.${b64url(sig)}`;
}
