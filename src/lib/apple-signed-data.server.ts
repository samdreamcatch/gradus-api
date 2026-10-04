/**
 * Verifies data the App Store signs: App Store Server Notifications V2
 * (`signedPayload`) and the app transaction an iOS device reads from
 * StoreKit (`AppTransaction.shared.jwsRepresentation`). PRD §6.13 B4,
 * milestone S3.
 *
 * Both are a JWS in compact serialization, alg ES256, with the signing
 * certificate chain in the `x5c` header: [leaf, intermediate, Apple Root CA
 * - G3]. Trust means all of:
 *
 *  1. Exactly three certificates; the last is byte-for-byte the pinned
 *     Apple Root CA - G3 (SHA-256 fingerprint below, checked against
 *     apple.com/certificateauthority on 2026-10-03).
 *  2. Each certificate is signed by the next one, names it as issuer, and
 *     was valid at the moment the data was signed (`signedDate`, or the app
 *     transaction's `receiptCreationDate`), as Apple's own server library
 *     does when it runs without online revocation checks.
 *  3. The intermediate is a CA carrying Apple's WWDR marker
 *     (1.2.840.113635.100.6.2.1) and the leaf carries the App Store
 *     receipt-signing marker (1.2.840.113635.100.6.11.1). This is what stops
 *     a developer's own Apple-issued certificate (same root, same
 *     intermediates, and a private key the developer holds) from signing a
 *     notification that would pass a chain check alone.
 *  4. The JWS signature verifies with the leaf's P-256 key.
 *
 * Workers have WebCrypto but no X.509 parser, and `jose` only verifies a JWS
 * against a key it is given, so this file carries a minimal DER reader for
 * exactly the certificate fields above. It is deliberately strict: anything
 * it does not understand fails closed.
 */

export const APPLE_ROOT_CA_G3_SHA256 =
  "63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179";

/** Apple Root CA - G3, DER, from https://www.apple.com/certificateauthority/AppleRootCA-G3.cer */
const APPLE_ROOT_CA_G3_B64 =
  "MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwSQXBwbGUgUm9v" +
  "dCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9uIEF1dGhvcml0eTETMBEGA1UE" +
  "CgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcNMTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2" +
  "WjBnMRswGQYDVQQDDBJBcHBsZSBSb290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmlj" +
  "YXRpb24gQXV0aG9yaXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqG" +
  "SM49AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtfTjjTuxxE" +
  "tX/1H7YyYl3J6YRbTzBPEVoA/VhYDKX1DyxNB0cTddqXl5dvMVztK517IDvYuVTZXpmkOlEKMaNC" +
  "MEAwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3r6966/ayySrMA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0P" +
  "AQH/BAQDAgEGMAoGCCqGSM49BAMDA2gAMGUCMQCD6cHEFl4aXTQY2e3v9GwOAEZLuN+yRhHFD/3m" +
  "eoyhpmvOwgPUnPWTxnS4at+qIxUCMG1mihDK1A3UT82NQz60imOlM27jbdoXt2QfyFMm+YhidDkL" +
  "F1vLUagM6BgD56KyKA==";

export const OID_APPLE_RECEIPT_SIGNER = "1.2.840.113635.100.6.11.1";
export const OID_APPLE_WWDR_INTERMEDIATE = "1.2.840.113635.100.6.2.1";

const OID_BASIC_CONSTRAINTS = "2.5.29.19";
const OID_EC_PUBLIC_KEY = "1.2.840.10045.2.1";
const OID_ECDSA_SHA256 = "1.2.840.10045.4.3.2";
const OID_ECDSA_SHA384 = "1.2.840.10045.4.3.3";
const CURVES: Record<string, { name: "P-256" | "P-384"; size: number }> = {
  "1.2.840.10045.3.1.7": { name: "P-256", size: 32 },
  "1.3.132.0.34": { name: "P-384", size: 48 },
};
const HASHES: Record<string, "SHA-256" | "SHA-384"> = {
  [OID_ECDSA_SHA256]: "SHA-256",
  [OID_ECDSA_SHA384]: "SHA-384",
};

/** A clock skew allowance for a `signedDate` slightly ahead of ours. */
const FUTURE_SKEW_MS = 5 * 60 * 1000;

export type AppleSignedDataFailure =
  | "malformed"
  | "unsupported_alg"
  | "bad_chain"
  | "untrusted_root"
  | "missing_marker"
  | "not_a_ca"
  | "expired"
  | "future_signed_date"
  | "bad_certificate_signature"
  | "bad_signature";

export class AppleSignedDataError extends Error {
  constructor(public readonly reason: AppleSignedDataFailure) {
    super(`apple signed data: ${reason}`);
    this.name = "AppleSignedDataError";
  }
}

export interface VerifyAppleJwsOptions {
  /** Trusted roots as DER. Defaults to the pinned Apple Root CA - G3; tests pass their own. */
  roots?: Uint8Array[];
  /** "Now", for the future-dated check and when the payload carries no date. */
  now?: Date;
  /**
   * Which payload field holds the signing time, in Unix milliseconds:
   * `signedDate` for notifications, `receiptCreationDate` for app transactions.
   */
  dateField?: string;
}

/* ------------------------------------------------------------- encodings */

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function base64UrlToBytes(b64url: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(b64url)) throw new AppleSignedDataError("malformed");
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  return base64ToBytes(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/* ------------------------------------------------------------ DER reader */

interface Tlv {
  tag: number;
  /** The whole element, header included (what a signature covers). */
  raw: Uint8Array;
  /** The contents only. */
  value: Uint8Array;
}

function readTlv(bytes: Uint8Array, offset: number): [Tlv, number] {
  if (offset + 2 > bytes.length) throw new AppleSignedDataError("malformed");
  const tag = bytes[offset];
  // High-tag-number form never appears in an X.509 certificate.
  if ((tag & 0x1f) === 0x1f) throw new AppleSignedDataError("malformed");
  let len = bytes[offset + 1];
  let header = 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0 || n > 4 || offset + 2 + n > bytes.length) {
      throw new AppleSignedDataError("malformed");
    }
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + bytes[offset + 2 + i];
    header += n;
  }
  const end = offset + header + len;
  if (end > bytes.length) throw new AppleSignedDataError("malformed");
  return [
    { tag, raw: bytes.subarray(offset, end), value: bytes.subarray(offset + header, end) },
    end,
  ];
}

/** The children of a constructed element, in order. */
function children(tlv: Tlv): Tlv[] {
  const out: Tlv[] = [];
  let offset = 0;
  while (offset < tlv.value.length) {
    const [child, next] = readTlv(tlv.value, offset);
    out.push(child);
    offset = next;
  }
  return out;
}

function expectTag(tlv: Tlv | undefined, tag: number): Tlv {
  if (!tlv || tlv.tag !== tag) throw new AppleSignedDataError("malformed");
  return tlv;
}

const SEQUENCE = 0x30;
const OID = 0x06;
const BIT_STRING = 0x03;
const OCTET_STRING = 0x04;
const BOOLEAN = 0x01;
const INTEGER = 0x02;
const UTC_TIME = 0x17;
const GENERALIZED_TIME = 0x18;

function decodeOid(tlv: Tlv): string {
  const v = expectTag(tlv, OID).value;
  if (v.length === 0) throw new AppleSignedDataError("malformed");
  const parts: number[] = [];
  let acc = 0;
  for (let i = 0; i < v.length; i++) {
    acc = acc * 128 + (v[i] & 0x7f);
    if (!(v[i] & 0x80)) {
      if (parts.length === 0) {
        const first = acc < 80 ? Math.floor(acc / 40) : 2;
        parts.push(first, acc - first * 40);
      } else {
        parts.push(acc);
      }
      acc = 0;
    }
  }
  return parts.join(".");
}

function decodeTime(tlv: Tlv | undefined): number {
  if (!tlv) throw new AppleSignedDataError("malformed");
  const s = new TextDecoder().decode(tlv.value);
  let m: RegExpMatchArray | null;
  if (tlv.tag === UTC_TIME) {
    m = s.match(/^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/);
    if (!m) throw new AppleSignedDataError("malformed");
    const yy = Number(m[1]);
    return Date.UTC(
      yy < 50 ? 2000 + yy : 1900 + yy,
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4]),
      Number(m[5]),
      Number(m[6]),
    );
  }
  if (tlv.tag === GENERALIZED_TIME) {
    m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/);
    if (!m) throw new AppleSignedDataError("malformed");
    return Date.UTC(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4]),
      Number(m[5]),
      Number(m[6]),
    );
  }
  throw new AppleSignedDataError("malformed");
}

/** A BIT STRING's bytes, which must have no unused bits. */
function bitStringBytes(tlv: Tlv): Uint8Array {
  const v = expectTag(tlv, BIT_STRING).value;
  if (v.length < 1 || v[0] !== 0) throw new AppleSignedDataError("malformed");
  return v.subarray(1);
}

/* --------------------------------------------------------- certificates */

export interface ParsedCertificate {
  raw: Uint8Array;
  tbs: Uint8Array;
  signatureHash: "SHA-256" | "SHA-384";
  signature: Uint8Array;
  issuer: Uint8Array;
  subject: Uint8Array;
  notBefore: number;
  notAfter: number;
  spki: Uint8Array;
  curve: { name: "P-256" | "P-384"; size: number };
  extensionOids: Set<string>;
  isCa: boolean;
}

export function parseCertificate(der: Uint8Array): ParsedCertificate {
  const [cert, end] = readTlv(der, 0);
  if (end !== der.length) throw new AppleSignedDataError("malformed");
  const [tbs, sigAlg, sigValue] = children(expectTag(cert, SEQUENCE));
  const fields = children(expectTag(tbs, SEQUENCE));

  let i = 0;
  if (fields[i]?.tag === 0xa0) i++; // [0] version
  expectTag(fields[i++], INTEGER); // serialNumber
  const innerAlg = decodeOid(children(expectTag(fields[i++], SEQUENCE))[0]);
  const issuer = expectTag(fields[i++], SEQUENCE).raw;
  const [notBefore, notAfter] = children(expectTag(fields[i++], SEQUENCE));
  const subject = expectTag(fields[i++], SEQUENCE).raw;
  const spki = expectTag(fields[i++], SEQUENCE);

  const [keyAlg] = children(spki);
  const [keyType, curveOid] = children(expectTag(keyAlg, SEQUENCE));
  if (decodeOid(keyType) !== OID_EC_PUBLIC_KEY || !curveOid) {
    throw new AppleSignedDataError("malformed");
  }
  const curve = CURVES[decodeOid(curveOid)];
  if (!curve) throw new AppleSignedDataError("malformed");

  const extensionOids = new Set<string>();
  let isCa = false;
  for (; i < fields.length; i++) {
    if (fields[i].tag !== 0xa3) continue; // [1]/[2] unique ids are skipped
    const [list] = children(fields[i]);
    for (const ext of children(expectTag(list, SEQUENCE))) {
      const parts = children(expectTag(ext, SEQUENCE));
      const oid = decodeOid(parts[0]);
      extensionOids.add(oid);
      if (oid === OID_BASIC_CONSTRAINTS) {
        const value = expectTag(parts[parts.length - 1], OCTET_STRING).value;
        const [bc] = readTlv(value, 0);
        const first = children(expectTag(bc, SEQUENCE))[0];
        isCa = first?.tag === BOOLEAN && first.value.length === 1 && first.value[0] !== 0;
      }
    }
  }

  const outerAlg = decodeOid(children(expectTag(sigAlg, SEQUENCE))[0]);
  const signatureHash = HASHES[outerAlg];
  if (!signatureHash || outerAlg !== innerAlg) throw new AppleSignedDataError("malformed");

  return {
    raw: der,
    tbs: tbs.raw,
    signatureHash,
    signature: bitStringBytes(sigValue),
    issuer,
    subject,
    notBefore: decodeTime(notBefore),
    notAfter: decodeTime(notAfter),
    spki: spki.raw,
    curve,
    extensionOids,
    isCa,
  };
}

/** DER `SEQUENCE { INTEGER r, INTEGER s }` → the fixed-width `r || s` WebCrypto verifies. */
function derEcdsaToRaw(der: Uint8Array, size: number): Uint8Array {
  const [seq, end] = readTlv(der, 0);
  if (end !== der.length) throw new AppleSignedDataError("malformed");
  const ints = children(expectTag(seq, SEQUENCE));
  if (ints.length !== 2) throw new AppleSignedDataError("malformed");
  const out = new Uint8Array(size * 2);
  ints.forEach((int, n) => {
    let v = expectTag(int, INTEGER).value;
    while (v.length > 1 && v[0] === 0) v = v.subarray(1);
    if (v.length > size) throw new AppleSignedDataError("malformed");
    out.set(v, n * size + (size - v.length));
  });
  return out;
}

async function importKey(cert: ParsedCertificate): Promise<CryptoKey> {
  try {
    return await crypto.subtle.importKey(
      "spki",
      toArrayBuffer(cert.spki),
      { name: "ECDSA", namedCurve: cert.curve.name },
      false,
      ["verify"],
    );
  } catch {
    throw new AppleSignedDataError("malformed");
  }
}

async function verifyIssuedBy(child: ParsedCertificate, issuer: ParsedCertificate): Promise<void> {
  if (!bytesEqual(child.issuer, issuer.subject)) throw new AppleSignedDataError("bad_chain");
  const key = await importKey(issuer);
  const ok = await crypto.subtle.verify(
    { name: "ECDSA", hash: child.signatureHash },
    key,
    toArrayBuffer(derEcdsaToRaw(child.signature, issuer.curve.size)),
    toArrayBuffer(child.tbs),
  );
  if (!ok) throw new AppleSignedDataError("bad_certificate_signature");
}

let pinnedRoot: Uint8Array | null = null;
/** The pinned Apple Root CA - G3 as DER (its fingerprint is checked in the tests). */
export function pinnedAppleRootDer(): Uint8Array {
  pinnedRoot ??= base64ToBytes(APPLE_ROOT_CA_G3_B64);
  return pinnedRoot;
}

/* ------------------------------------------------------------------ JWS */

export interface VerifiedAppleJws<T = Record<string, unknown>> {
  header: Record<string, unknown>;
  payload: T;
}

/**
 * Verify an App Store JWS and return its decoded header and payload.
 * Throws `AppleSignedDataError` (with a `reason` for the logs) on anything
 * short of full trust; never returns unverified data.
 */
export async function verifyAppleJws(
  jws: string,
  opts: VerifyAppleJwsOptions = {},
): Promise<VerifiedAppleJws> {
  try {
    return await verifyAppleJwsUnguarded(jws, opts);
  } catch (err) {
    // A parser corner nobody anticipated still fails closed, as a refusal
    // (401/422 at the routes), never as a server fault.
    if (err instanceof AppleSignedDataError) throw err;
    throw new AppleSignedDataError("malformed");
  }
}

async function verifyAppleJwsUnguarded(
  jws: string,
  opts: VerifyAppleJwsOptions,
): Promise<VerifiedAppleJws> {
  const parts = typeof jws === "string" ? jws.split(".") : [];
  if (parts.length !== 3 || parts.some((p) => p.length === 0)) {
    throw new AppleSignedDataError("malformed");
  }
  const [h, p, s] = parts;

  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(new TextDecoder().decode(base64UrlToBytes(h)));
    payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(p)));
  } catch {
    throw new AppleSignedDataError("malformed");
  }
  if (!header || typeof header !== "object" || !payload || typeof payload !== "object") {
    throw new AppleSignedDataError("malformed");
  }
  if (header.alg !== "ES256") throw new AppleSignedDataError("unsupported_alg");

  const x5c = header.x5c;
  if (!Array.isArray(x5c) || x5c.length !== 3 || !x5c.every((c) => typeof c === "string")) {
    throw new AppleSignedDataError("bad_chain");
  }
  let ders: Uint8Array[];
  try {
    ders = (x5c as string[]).map(base64ToBytes);
  } catch {
    throw new AppleSignedDataError("malformed");
  }

  const roots = opts.roots ?? [pinnedAppleRootDer()];
  if (!roots.some((r) => bytesEqual(r, ders[2]))) throw new AppleSignedDataError("untrusted_root");

  const [leaf, intermediate, root] = ders.map(parseCertificate);
  if (!intermediate.isCa) throw new AppleSignedDataError("not_a_ca");
  if (!intermediate.extensionOids.has(OID_APPLE_WWDR_INTERMEDIATE)) {
    throw new AppleSignedDataError("missing_marker");
  }
  if (!leaf.extensionOids.has(OID_APPLE_RECEIPT_SIGNER)) {
    throw new AppleSignedDataError("missing_marker");
  }

  const now = (opts.now ?? new Date()).getTime();
  const field = opts.dateField ?? "signedDate";
  const stamped = payload[field];
  const signedAt = typeof stamped === "number" && Number.isFinite(stamped) ? stamped : now;
  if (signedAt > now + FUTURE_SKEW_MS) throw new AppleSignedDataError("future_signed_date");
  for (const cert of [leaf, intermediate, root]) {
    if (signedAt < cert.notBefore || signedAt > cert.notAfter) {
      throw new AppleSignedDataError("expired");
    }
  }

  await verifyIssuedBy(intermediate, root);
  await verifyIssuedBy(leaf, intermediate);

  if (leaf.curve.name !== "P-256") throw new AppleSignedDataError("unsupported_alg");
  let signature: Uint8Array;
  try {
    signature = base64UrlToBytes(s);
  } catch {
    throw new AppleSignedDataError("malformed");
  }
  if (signature.length !== 64) throw new AppleSignedDataError("bad_signature");
  const ok = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    await importKey(leaf),
    toArrayBuffer(signature),
    toArrayBuffer(new TextEncoder().encode(`${h}.${p}`)),
  );
  if (!ok) throw new AppleSignedDataError("bad_signature");

  return { header, payload };
}
