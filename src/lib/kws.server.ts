/**
 * Kids Web Services (KWS, Epic Games) Parent Verification — the adult check
 * behind every parent account linked to a minor (PRD §6.13 A1–A2, decision
 * #29). Server-only: credentials never reach a client.
 *
 * Flow: `kwsSendVerificationEmail` asks KWS to email the parent; the parent
 * finishes a payment-card check on KWS's white-labeled page; KWS then
 * (a) POSTs a signed `parent-verified` webhook to `/api/public/webhooks/kws`
 * and (b) redirects the parent to `/verified` with a signed query (KWS calls
 * that the "Verification Response"). Both carry the `externalPayload` we
 * sent, which names the parent profile, and a transaction id that
 * de-duplicates them. Either channel alone completes the verification.
 *
 * The send-email endpoint's exact path lives in the portal-gated API
 * specification, so it is configuration, not code: `KWS_SEND_EMAIL_URL`, or
 * `KWS_API_HOST` plus the documented default path. KWS rate-limits
 * send-email to ten per hour per parent email and rejects any request
 * without a non-empty `user-agent`.
 *
 * Secrets (Lovable Cloud): `KWS_CLIENT_ID`, `KWS_API_KEY`, `KWS_API_HOST`
 * (or `KWS_SEND_EMAIL_URL`), `KWS_WEBHOOK_SECRET`, `KWS_VERIFICATION_SECRET`;
 * optional `KWS_TOKEN_URL`, and `KWS_WEBHOOK_SECRET_PREVIOUS` /
 * `KWS_VERIFICATION_SECRET_PREVIOUS` while a secret is being rotated (KWS
 * signs with both during the overlap). Test and production are different
 * sets; only one is configured per environment.
 */
import { z } from "zod";

export const KWS_DEFAULT_TOKEN_URL =
  "https://auth.kidswebservices.com/auth/realms/kws/protocol/openid-connect/token";
/** Documented default; confirm against the portal's API specification at go-live. */
export const KWS_DEFAULT_SEND_EMAIL_PATH = "/v1/verifications/send-email";
export const KWS_USER_AGENT = "gradus-coach-start/1.0 (+https://gradus.training)";
/** `externalPayload` must be a JSON or UTF-8 string of at most this many characters. */
export const KWS_EXTERNAL_PAYLOAD_MAX = 250;

export interface KwsConfig {
  clientId: string;
  apiKey: string;
  tokenUrl: string;
  sendEmailUrl: string;
}

function trimmed(value: string | undefined): string {
  return (value ?? "").trim();
}

/** The API credentials, or null when the environment has none (KWS not set up yet). */
export function kwsConfig(env: NodeJS.ProcessEnv = process.env): KwsConfig | null {
  const clientId = trimmed(env.KWS_CLIENT_ID);
  const apiKey = trimmed(env.KWS_API_KEY);
  const host = trimmed(env.KWS_API_HOST).replace(/\/+$/, "");
  const sendEmailUrl =
    trimmed(env.KWS_SEND_EMAIL_URL) || (host ? host + KWS_DEFAULT_SEND_EMAIL_PATH : "");
  if (!clientId || !apiKey || !sendEmailUrl) return null;
  return {
    clientId,
    apiKey,
    tokenUrl: trimmed(env.KWS_TOKEN_URL) || KWS_DEFAULT_TOKEN_URL,
    sendEmailUrl,
  };
}

/** Current and (during a rotation) previous webhook secrets; empty when unset. */
export function kwsWebhookSecrets(env: NodeJS.ProcessEnv = process.env): string[] {
  return [env.KWS_WEBHOOK_SECRET, env.KWS_WEBHOOK_SECRET_PREVIOUS].map(trimmed).filter(Boolean);
}

/** Current and (during a rotation) previous Verification Response secrets. */
export function kwsVerificationSecrets(env: NodeJS.ProcessEnv = process.env): string[] {
  return [env.KWS_VERIFICATION_SECRET, env.KWS_VERIFICATION_SECRET_PREVIOUS]
    .map(trimmed)
    .filter(Boolean);
}

/* ------------------------------------------------------------- payloads */

/**
 * What we hand KWS and get back untouched: the parent profile and the auth
 * user it belonged to when the email went out. Short keys keep it far under
 * the 250-character cap.
 */
export interface KwsExternalPayload {
  parentId: string;
  userId: string;
}

export function encodeExternalPayload(payload: KwsExternalPayload): string {
  const encoded = JSON.stringify({ p: payload.parentId, u: payload.userId });
  if (encoded.length > KWS_EXTERNAL_PAYLOAD_MAX) {
    throw new Error("KWS externalPayload exceeds 250 characters");
  }
  return encoded;
}

const externalPayloadSchema = z.object({ p: z.string().uuid(), u: z.string().uuid() });

export function decodeExternalPayload(raw: string | null | undefined): KwsExternalPayload | null {
  if (!raw) return null;
  try {
    const parsed = externalPayloadSchema.safeParse(JSON.parse(raw));
    return parsed.success ? { parentId: parsed.data.p, userId: parsed.data.u } : null;
  } catch {
    return null;
  }
}

/** The webhook body KWS POSTs (`name: "parent-verified"`). */
export const kwsWebhookEventSchema = z.object({
  name: z.string(),
  time: z.string().optional(),
  orgId: z.string().optional(),
  productId: z.string().nullable().optional(),
  payload: z.object({
    parentEmail: z.string().optional(),
    externalPayload: z.string().nullable().optional(),
    status: z.object({
      verified: z.boolean(),
      transactionId: z.string().min(1),
    }),
  }),
});
export type KwsWebhookEvent = z.infer<typeof kwsWebhookEventSchema>;

/** The `status` query value on the Verification Response redirect. */
export const kwsRedirectStatusSchema = z.object({
  verified: z.boolean(),
  transactionId: z.string().min(1),
  errorCode: z.string().nullable().optional(),
  timestamp: z.number().optional(),
});
export type KwsRedirectStatus = z.infer<typeof kwsRedirectStatusSchema>;

/* ------------------------------------------------------------ signatures */

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return bytesToHex(new Uint8Array(signed));
}

/** Constant-time comparison of two lowercase hex digests. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** `x-kws-signature: t=<timestamp>,v1=<sig>[,v1=<sig>]` */
export function parseKwsSignatureHeader(
  header: string | null | undefined,
): { timestamp: string; signatures: string[] } | null {
  if (!header) return null;
  let timestamp = "";
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t") timestamp = value;
    else if (key === "v1" && value) signatures.push(value.toLowerCase());
  }
  if (!timestamp || signatures.length === 0) return null;
  return { timestamp, signatures };
}

/** Replays older than this are refused; retries carry a fresh signature. */
export const KWS_WEBHOOK_MAX_AGE_SECONDS = 24 * 60 * 60;

/**
 * Webhook authenticity: HMAC-SHA256 over `${timestamp}.${rawBody}` with the
 * webhook secret, hex, compared against every `v1` in the header, for every
 * secret we hold (current and rotated). The raw body must be used as
 * received; never re-serialize it.
 */
export async function verifyKwsWebhookSignature(
  header: string | null | undefined,
  rawBody: string,
  secrets: string[],
  now: number = Date.now(),
): Promise<boolean> {
  const parsed = parseKwsSignatureHeader(header);
  if (!parsed || secrets.length === 0) return false;
  const ts = Number(parsed.timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > KWS_WEBHOOK_MAX_AGE_SECONDS) return false;
  for (const secret of secrets) {
    const expected = await hmacSha256Hex(secret, `${parsed.timestamp}.${rawBody}`);
    if (parsed.signatures.some((sig) => timingSafeEqualHex(sig, expected))) return true;
  }
  return false;
}

/**
 * Verification Response authenticity: HMAC-SHA256 over `${status}:${externalPayload}`
 * (the raw query values, as received) with the verification secret, compared
 * against every `signature` query value, for every secret we hold.
 */
export async function verifyKwsRedirectSignature(
  status: string,
  externalPayload: string,
  signatures: string[],
  secrets: string[],
): Promise<boolean> {
  const presented = signatures.map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (presented.length === 0 || secrets.length === 0) return false;
  for (const secret of secrets) {
    const expected = await hmacSha256Hex(secret, `${status}:${externalPayload}`);
    if (presented.some((sig) => timingSafeEqualHex(sig, expected))) return true;
  }
  return false;
}

/* --------------------------------------------------------------- client */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface KwsClientOptions {
  fetchImpl?: FetchLike;
  /** Replaced in tests; the default waits `baseMs * 2^attempt`. */
  sleep?: (ms: number) => Promise<void>;
  attempts?: number;
  baseMs?: number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * KWS asks integrators to retry failed calls with exponential backoff.
 * Network errors and 5xx responses are retried; anything else returns at once.
 */
async function withRetries(
  run: () => Promise<Response>,
  opts: KwsClientOptions,
): Promise<Response> {
  const attempts = opts.attempts ?? 3;
  const baseMs = opts.baseMs ?? 250;
  const sleep = opts.sleep ?? defaultSleep;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const res = await run();
      if (res.status < 500 || attempt === attempts - 1) return res;
      lastError = new Error(`KWS responded ${res.status}`);
    } catch (err) {
      lastError = err;
      if (attempt === attempts - 1) throw err;
    }
    await sleep(baseMs * 2 ** attempt);
  }
  throw lastError instanceof Error ? lastError : new Error("KWS request failed");
}

/** A Developer Access Token (`client_credentials`, scope `verification`). Short-lived; fetched per send. */
export async function kwsAccessToken(cfg: KwsConfig, opts: KwsClientOptions = {}): Promise<string> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const basic = btoa(`${cfg.clientId}:${cfg.apiKey}`);
  const res = await withRetries(
    () =>
      fetchImpl(cfg.tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${basic}`,
          "User-Agent": KWS_USER_AGENT,
        },
        body: "grant_type=client_credentials&scope=verification",
      }),
    opts,
  );
  if (!res.ok) throw new Error(`KWS token request failed (${res.status})`);
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("KWS token response had no access_token");
  return json.access_token;
}

export interface KwsSendEmailInput {
  /** The parent's own account email — never an address a child typed. */
  email: string;
  /** ISO 3166-1 alpha-2 country or ISO 3166-2 region of the child. */
  location: string;
  language: string;
  externalPayload: string;
}

export type KwsSendEmailResult =
  | { ok: true; status: number }
  | { ok: false; status: number; body: string };

/**
 * Trigger the KWS verification email. `userContext` is always `parent`.
 * A 429 means KWS's own per-email limit (ten per hour) was hit.
 */
export async function kwsSendVerificationEmail(
  cfg: KwsConfig,
  input: KwsSendEmailInput,
  opts: KwsClientOptions = {},
): Promise<KwsSendEmailResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const token = await kwsAccessToken(cfg, opts);
  const res = await withRetries(
    () =>
      fetchImpl(cfg.sendEmailUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "User-Agent": KWS_USER_AGENT,
        },
        body: JSON.stringify({
          email: input.email,
          location: input.location,
          language: input.language,
          externalPayload: input.externalPayload,
          userContext: "parent",
        }),
      }),
    opts,
  );
  if (res.ok) return { ok: true, status: res.status };
  let body = "";
  try {
    body = (await res.text()).slice(0, 500);
  } catch {
    /* ignore */
  }
  return { ok: false, status: res.status, body };
}
