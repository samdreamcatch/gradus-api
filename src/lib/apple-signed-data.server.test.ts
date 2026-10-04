import { describe, expect, it } from "bun:test";
import {
  APPLE_ROOT_CA_G3_SHA256,
  AppleSignedDataError,
  parseCertificate,
  pinnedAppleRootDer,
  verifyAppleJws,
} from "./apple-signed-data.server";
import {
  TEST_DEVELOPER_LEAF_B64,
  TEST_EXPIRED_LEAF_B64,
  TEST_INTERMEDIATE_B64,
  TEST_LEAF_B64,
  TEST_LEAF_UNDER_NON_CA_B64,
  TEST_NON_CA_INTERMEDIATE_B64,
  TEST_ROOT_B64,
} from "./apple-signed-data.fixtures";
import { der, enc, signTestJws, TEST_ROOTS } from "./apple-signed-data.test-helpers";

/* -------------------------------------------------------------------------- */

const NOW = new Date("2027-03-01T12:00:00Z");
const SIGNED = NOW.getTime() - 60_000;

async function reason(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "accepted";
  } catch (err) {
    return err instanceof AppleSignedDataError ? err.reason : `threw ${String(err)}`;
  }
}

describe("the pinned root", () => {
  it("is Apple Root CA - G3, by SHA-256 fingerprint", async () => {
    const digest = new Uint8Array(
      await crypto.subtle.digest("SHA-256", pinnedAppleRootDer() as unknown as ArrayBuffer),
    );
    const hex = Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
    expect(hex).toBe(APPLE_ROOT_CA_G3_SHA256);
  });

  it("parses as a P-384 CA valid until 2039", () => {
    const root = parseCertificate(pinnedAppleRootDer());
    expect(root.isCa).toBe(true);
    expect(root.curve.name).toBe("P-384");
    expect(new Date(root.notAfter).toISOString()).toBe("2039-04-30T18:19:06.000Z");
  });

  it("refuses a chain that ends anywhere else by default", async () => {
    const jws = await signTestJws({ signedDate: SIGNED });
    expect(await reason(verifyAppleJws(jws, { now: NOW }))).toBe("untrusted_root");
  });
});

describe("verifyAppleJws", () => {
  it("accepts a correctly chained and signed payload", async () => {
    const jws = await signTestJws({ notificationType: "RESCIND_CONSENT", signedDate: SIGNED });
    const out = await verifyAppleJws(jws, { roots: TEST_ROOTS, now: NOW });
    expect(out.payload.notificationType).toBe("RESCIND_CONSENT");
  });

  it("checks validity at the field the caller names", async () => {
    const jws = await signTestJws({ receiptCreationDate: SIGNED });
    const out = await verifyAppleJws(jws, {
      roots: TEST_ROOTS,
      now: NOW,
      dateField: "receiptCreationDate",
    });
    expect(out.payload.receiptCreationDate).toBe(SIGNED);
  });

  it("refuses a developer's own certificate as the signer (no receipt-signer marker)", async () => {
    const jws = await signTestJws(
      { signedDate: SIGNED },
      { x5c: [TEST_DEVELOPER_LEAF_B64, TEST_INTERMEDIATE_B64, TEST_ROOT_B64] },
    );
    expect(await reason(verifyAppleJws(jws, { roots: TEST_ROOTS, now: NOW }))).toBe(
      "missing_marker",
    );
  });

  it("refuses an intermediate that is not a CA", async () => {
    const jws = await signTestJws(
      { signedDate: SIGNED },
      { x5c: [TEST_LEAF_UNDER_NON_CA_B64, TEST_NON_CA_INTERMEDIATE_B64, TEST_ROOT_B64] },
    );
    expect(await reason(verifyAppleJws(jws, { roots: TEST_ROOTS, now: NOW }))).toBe("not_a_ca");
  });

  it("refuses the leaf and intermediate swapped", async () => {
    const jws = await signTestJws(
      { signedDate: SIGNED },
      { x5c: [TEST_INTERMEDIATE_B64, TEST_LEAF_B64, TEST_ROOT_B64] },
    );
    expect(await reason(verifyAppleJws(jws, { roots: TEST_ROOTS, now: NOW }))).toBe("not_a_ca");
  });

  it("refuses a leaf whose certificate signature was tampered with", async () => {
    const tampered = der(TEST_LEAF_B64);
    tampered[tampered.length - 1] ^= 0x01; // inside the signature's s, so still valid DER
    const b64 = btoa(String.fromCharCode(...tampered));
    const jws = await signTestJws(
      { signedDate: SIGNED },
      { x5c: [b64, TEST_INTERMEDIATE_B64, TEST_ROOT_B64] },
    );
    expect(await reason(verifyAppleJws(jws, { roots: TEST_ROOTS, now: NOW }))).toBe(
      "bad_certificate_signature",
    );
  });

  it("refuses a certificate that was not valid when the data was signed", async () => {
    const jws = await signTestJws(
      { signedDate: SIGNED },
      { x5c: [TEST_EXPIRED_LEAF_B64, TEST_INTERMEDIATE_B64, TEST_ROOT_B64] },
    );
    expect(await reason(verifyAppleJws(jws, { roots: TEST_ROOTS, now: NOW }))).toBe("expired");
  });

  it("refuses a signing date in the future", async () => {
    const jws = await signTestJws({ signedDate: NOW.getTime() + 60 * 60 * 1000 });
    expect(await reason(verifyAppleJws(jws, { roots: TEST_ROOTS, now: NOW }))).toBe(
      "future_signed_date",
    );
  });

  it("refuses a payload changed after signing", async () => {
    const jws = await signTestJws({ notificationType: "TEST", signedDate: SIGNED });
    const [h, , s] = jws.split(".");
    const forged = `${h}.${enc({ notificationType: "RESCIND_CONSENT", signedDate: SIGNED })}.${s}`;
    expect(await reason(verifyAppleJws(forged, { roots: TEST_ROOTS, now: NOW }))).toBe(
      "bad_signature",
    );
  });

  it("refuses any algorithm but ES256", async () => {
    for (const alg of ["none", "HS256", "ES384"]) {
      const jws = await signTestJws({ signedDate: SIGNED }, { alg });
      expect(await reason(verifyAppleJws(jws, { roots: TEST_ROOTS, now: NOW }))).toBe(
        "unsupported_alg",
      );
    }
  });

  it("refuses a chain of the wrong length", async () => {
    const short = await signTestJws(
      { signedDate: SIGNED },
      { x5c: [TEST_LEAF_B64, TEST_ROOT_B64] },
    );
    expect(await reason(verifyAppleJws(short, { roots: TEST_ROOTS, now: NOW }))).toBe("bad_chain");
  });

  it("refuses garbage without throwing anything else", async () => {
    for (const input of ["", "a.b", "a.b.c", "!!.??.**", "e30.e30.", 42 as unknown as string]) {
      expect(await reason(verifyAppleJws(input, { roots: TEST_ROOTS, now: NOW }))).toBe(
        "malformed",
      );
    }
  });

  it("refuses a certificate with an empty validity as malformed, not as a crash", async () => {
    // TLV builder: just enough DER to reach the validity field of a leaf.
    const tlv = (tag: number, ...parts: Uint8Array[]) => {
      const body = parts.reduce((acc, p) => new Uint8Array([...acc, ...p]), new Uint8Array());
      const len = body.length < 0x80 ? [body.length] : [0x82, body.length >> 8, body.length & 0xff];
      return new Uint8Array([tag, ...len, ...body]);
    };
    const ecdsaSha384 = tlv(
      0x30,
      tlv(0x06, new Uint8Array([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x03])),
    );
    const tbs = tlv(
      0x30,
      tlv(0xa0, tlv(0x02, new Uint8Array([2]))),
      tlv(0x02, new Uint8Array([1])),
      ecdsaSha384,
      tlv(0x30), // issuer
      tlv(0x30), // validity: empty
      tlv(0x30), // subject
      parseCertificate(der(TEST_LEAF_B64)).spki,
    );
    const crafted = tlv(0x30, tbs, ecdsaSha384, tlv(0x03, new Uint8Array([0, 0x30, 0])));
    const jws = await signTestJws(
      { signedDate: SIGNED },
      { x5c: [btoa(String.fromCharCode(...crafted)), TEST_INTERMEDIATE_B64, TEST_ROOT_B64] },
    );
    expect(await reason(verifyAppleJws(jws, { roots: TEST_ROOTS, now: NOW }))).toBe("malformed");
  });

  it("refuses a truncated signature", async () => {
    const jws = await signTestJws({ signedDate: SIGNED });
    const cut = jws.slice(0, -10);
    expect(await reason(verifyAppleJws(cut, { roots: TEST_ROOTS, now: NOW }))).toBe(
      "bad_signature",
    );
  });
});
