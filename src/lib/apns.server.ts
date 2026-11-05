/**
 * APNs sender (PRD §6.6): token-based auth, HTTP/2 via the Worker's `fetch`.
 *
 * One provider JWT (ES256, signed with the APNs key) is cached per isolate
 * and refreshed after 50 minutes — Apple rejects tokens older than an hour
 * and throttles refreshes more frequent than every 20 minutes. Requests never
 * throw: every outcome is returned as a value so callers can prune dead
 * tokens and log the rest (PRD §4.1 rule 7, push is best-effort).
 *
 * Secrets (Lovable Cloud): `APNS_KEY_P8`, `APNS_KEY_ID`, `APPLE_TEAM_ID`
 * (shared with Sign in with Apple and App Attest). Optional: `APNS_BUNDLE_ID`
 * (default `training.gradus.app`) and `APNS_ENV` (`production` default;
 * `sandbox` for Xcode-installed debug builds). `APNS_ENV` only picks which
 * environment is tried first: a token from the other one (a TestFlight build
 * against a sandbox server, or an Xcode build against production) gets
 * `BadDeviceToken` there and is sent again to the other host.
 */
import { SignJWT, importPKCS8 } from "jose";

export type ApnsPushType = "alert" | "background" | "liveactivity";

export type ApnsConfig = {
  teamId: string;
  keyId: string;
  privateKeyPem: string;
  bundleId: string;
  host: string;
};

export type ApnsRequest = {
  /** Hex device token (alert/background) or Live Activity token. */
  token: string;
  payload: Record<string, unknown>;
  pushType: ApnsPushType;
  /** 10 = immediate (alerts), 5 = power-considerate (background, most Live Activity updates). */
  priority?: 5 | 10;
  /** Unix seconds after which APNs stops trying; 0 = try once. */
  expiration?: number;
  collapseId?: string;
  /** Overrides the topic derived from `pushType` (rarely needed). */
  topic?: string;
};

export type ApnsOutcome =
  | { ok: true; apnsId: string | null }
  | {
      ok: false;
      status: number;
      reason: string;
      /** True when APNs says this token will never work again — delete it. */
      dead: boolean;
    };

export type ApnsDeps = {
  fetch: typeof fetch;
  now: () => number;
  timeoutMs: number;
};

const DEFAULT_BUNDLE_ID = "training.gradus.app";
const PRODUCTION_HOST = "https://api.push.apple.com";
const SANDBOX_HOST = "https://api.sandbox.push.apple.com";
/** Refresh the provider token after this long (Apple: valid ≤ 60 min, refresh ≥ 20 min apart). */
const TOKEN_TTL_MS = 50 * 60 * 1000;
/**
 * Only 410 Unregistered proves a token is gone for good. `BadDeviceToken` and
 * `DeviceTokenNotForTopic` (400) usually mean *our* configuration is wrong
 * (a sandbox token sent to the production host, a wrong `APNS_BUNDLE_ID`);
 * deleting tokens on those would empty `device_tokens` on one bad deploy.
 */
const CONFIG_ERROR_REASONS = new Set(["BadDeviceToken", "DeviceTokenNotForTopic"]);

export function apnsConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ApnsConfig | null {
  const teamId = env.APPLE_TEAM_ID;
  const keyId = env.APNS_KEY_ID;
  const privateKeyPem = env.APNS_KEY_P8;
  if (!teamId || !keyId || !privateKeyPem) return null;
  return {
    teamId,
    keyId,
    privateKeyPem,
    bundleId: env.APNS_BUNDLE_ID || DEFAULT_BUNDLE_ID,
    host: env.APNS_ENV === "sandbox" ? SANDBOX_HOST : PRODUCTION_HOST,
  };
}

/** `apns-topic` for a push type: the bundle id, suffixed for Live Activities. */
export function apnsTopic(bundleId: string, pushType: ApnsPushType): string {
  return pushType === "liveactivity" ? `${bundleId}.push-type.liveactivity` : bundleId;
}

type CachedToken = { jwt: string; issuedAt: number; keyId: string };
let cached: CachedToken | null = null;
/** One in-flight mint at a time: a cold cache under a parallel fan-out must not sign N tokens. */
let minting: Promise<CachedToken> | null = null;

/** Test hook: forget the cached provider token. */
export function resetApnsTokenCache(): void {
  cached = null;
  minting = null;
}

async function providerToken(config: ApnsConfig, now: number): Promise<string> {
  if (cached && cached.keyId === config.keyId && now - cached.issuedAt < TOKEN_TTL_MS) {
    return cached.jwt;
  }
  if (!minting) {
    minting = (async () => {
      const key = await importPKCS8(config.privateKeyPem, "ES256");
      const jwt = await new SignJWT({})
        .setProtectedHeader({ alg: "ES256", kid: config.keyId })
        .setIssuer(config.teamId)
        .setIssuedAt(Math.floor(now / 1000))
        .sign(key);
      return { jwt, issuedAt: now, keyId: config.keyId };
    })().finally(() => {
      minting = null;
    });
  }
  cached = await minting;
  return cached.jwt;
}

async function fetchWithTimeout(deps: ApnsDeps, url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs);
  try {
    return await deps.fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** The other APNs environment's host, for a token `host` calls a `BadDeviceToken`. */
function otherApnsHost(host: string): string | null {
  if (host === PRODUCTION_HOST) return SANDBOX_HOST;
  if (host === SANDBOX_HOST) return PRODUCTION_HOST;
  return null;
}

/**
 * Deliver one push. Retries exactly once, with a fresh provider token, when
 * APNs reports the token expired or invalid (clock skew, key rotation), and
 * once on the other APNs environment when the token belongs to it
 * (`BadDeviceToken`).
 */
export async function sendApnsRequest(
  config: ApnsConfig,
  req: ApnsRequest,
  deps: Partial<ApnsDeps> = {},
): Promise<ApnsOutcome> {
  const d: ApnsDeps = {
    // Workers reject a detached global fetch ("Illegal invocation"); keep it bound.
    fetch: deps.fetch ?? ((input, init) => globalThis.fetch(input, init)),
    now: deps.now ?? (() => Date.now()),
    timeoutMs: deps.timeoutMs ?? 4000,
  };

  let usedJwt: string | null = null;
  const topic = req.topic ?? apnsTopic(config.bundleId, req.pushType);
  const attempt = async (host: string): Promise<ApnsOutcome> => {
    const startedAt = d.now();
    let jwt: string;
    try {
      jwt = await providerToken(config, startedAt);
      usedJwt = jwt;
    } catch (err) {
      // A malformed APNS_KEY_P8 (the usual secret-paste failure) must not turn into a thrown error.
      console.error(
        "[apns] provider token could not be signed",
        err instanceof Error ? err.message : err,
      );
      return { ok: false, status: 0, reason: "ProviderKeyError", dead: false };
    }
    const headers: Record<string, string> = {
      authorization: `bearer ${jwt}`,
      "apns-topic": topic,
      "apns-push-type": req.pushType,
      "apns-priority": String(req.priority ?? (req.pushType === "alert" ? 10 : 5)),
      "apns-expiration": String(req.expiration ?? 0),
      "content-type": "application/json",
    };
    if (req.collapseId) headers["apns-collapse-id"] = req.collapseId;

    let response: Response;
    try {
      response = await fetchWithTimeout(d, `${host}/3/device/${req.token}`, {
        method: "POST",
        headers,
        body: JSON.stringify(req.payload),
      });
    } catch (err) {
      const reason =
        err instanceof Error && err.name === "AbortError"
          ? "Timeout"
          : `NetworkError: ${err instanceof Error ? err.message : String(err)}`;
      return { ok: false, status: 0, reason, dead: false };
    }

    if (response.ok) {
      return { ok: true, apnsId: response.headers.get("apns-id") };
    }
    let reason = "Unknown";
    try {
      const body = (await response.json()) as { reason?: string };
      if (typeof body?.reason === "string") reason = body.reason;
    } catch {
      /* APNs always sends JSON on errors; tolerate anything else */
    }
    const dead = response.status === 410 || reason === "Unregistered";
    return { ok: false, status: response.status, reason, dead };
  };

  const send = async (host: string): Promise<ApnsOutcome> => {
    const first = await attempt(host);
    if (
      !first.ok &&
      first.status === 403 &&
      (first.reason === "ExpiredProviderToken" || first.reason === "InvalidProviderToken")
    ) {
      // Only discard the token that actually failed; a parallel send may have
      // replaced it already, and re-minting again would trip Apple's
      // TooManyProviderTokenUpdates.
      if (cached && cached.jwt === usedJwt) resetApnsTokenCache();
      return attempt(host);
    }
    return first;
  };

  let host = config.host;
  let outcome = await send(host);
  const fallback = otherApnsHost(host);
  if (!outcome.ok && outcome.reason === "BadDeviceToken" && fallback) {
    host = fallback;
    outcome = await send(host);
  }
  if (!outcome.ok && CONFIG_ERROR_REASONS.has(outcome.reason)) {
    console.error("[apns] configuration error from APNs", {
      status: outcome.status,
      reason: outcome.reason,
      host,
      topic,
    });
  }
  return outcome;
}
