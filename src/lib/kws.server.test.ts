import { describe, expect, it } from "bun:test";
import {
  decodeExternalPayload,
  encodeExternalPayload,
  hmacSha256Hex,
  kwsConfig,
  kwsSendVerificationEmail,
  kwsVerificationSecrets,
  kwsWebhookSecrets,
  KWS_DEFAULT_SEND_EMAIL_PATH,
  KWS_USER_AGENT,
  parseKwsSignatureHeader,
  verifyKwsRedirectSignature,
  verifyKwsWebhookSignature,
} from "./kws.server";

const PARENT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

describe("kwsConfig", () => {
  it("is null until the credentials exist", () => {
    expect(kwsConfig({} as NodeJS.ProcessEnv)).toBeNull();
    expect(kwsConfig({ KWS_CLIENT_ID: "c", KWS_API_KEY: "k" } as NodeJS.ProcessEnv)).toBeNull();
  });

  it("builds the send-email URL from the host, or takes it verbatim", () => {
    const fromHost = kwsConfig({
      KWS_CLIENT_ID: "c",
      KWS_API_KEY: "k",
      KWS_API_HOST: "https://api.example.test/",
    } as NodeJS.ProcessEnv);
    expect(fromHost?.sendEmailUrl).toBe("https://api.example.test" + KWS_DEFAULT_SEND_EMAIL_PATH);
    const explicit = kwsConfig({
      KWS_CLIENT_ID: "c",
      KWS_API_KEY: "k",
      KWS_SEND_EMAIL_URL: "https://api.example.test/custom",
    } as NodeJS.ProcessEnv);
    expect(explicit?.sendEmailUrl).toBe("https://api.example.test/custom");
  });

  it("collects current and rotated secrets", () => {
    const env = {
      KWS_WEBHOOK_SECRET: "w1",
      KWS_WEBHOOK_SECRET_PREVIOUS: " w0 ",
      KWS_VERIFICATION_SECRET: "v1",
    } as NodeJS.ProcessEnv;
    expect(kwsWebhookSecrets(env)).toEqual(["w1", "w0"]);
    expect(kwsVerificationSecrets(env)).toEqual(["v1"]);
    expect(kwsWebhookSecrets({} as NodeJS.ProcessEnv)).toEqual([]);
  });
});

describe("externalPayload", () => {
  it("round-trips the parent and user ids well under 250 characters", () => {
    const encoded = encodeExternalPayload({ parentId: PARENT, userId: USER });
    expect(encoded.length).toBeLessThan(120);
    expect(decodeExternalPayload(encoded)).toEqual({ parentId: PARENT, userId: USER });
  });

  it("rejects anything that is not our shape", () => {
    expect(decodeExternalPayload(null)).toBeNull();
    expect(decodeExternalPayload("not json")).toBeNull();
    expect(decodeExternalPayload(JSON.stringify({ p: "nope", u: USER }))).toBeNull();
    expect(decodeExternalPayload(JSON.stringify({ hello: "world" }))).toBeNull();
  });
});

describe("webhook signature", () => {
  const body = JSON.stringify({ name: "parent-verified", payload: { status: { verified: true } } });
  const now = 1_800_000_000_000;
  const t = String(Math.floor(now / 1000) - 30);

  it("parses t and every v1", () => {
    expect(parseKwsSignatureHeader("t=1,v1=AA,v1=bb")).toEqual({
      timestamp: "1",
      signatures: ["aa", "bb"],
    });
    expect(parseKwsSignatureHeader("v1=aa")).toBeNull();
    expect(parseKwsSignatureHeader(null)).toBeNull();
  });

  it("accepts a genuine signature, with either the current or the rotated secret", async () => {
    const sig = await hmacSha256Hex("old-secret", `${t}.${body}`);
    const header = `t=${t},v1=${sig}`;
    expect(await verifyKwsWebhookSignature(header, body, ["new-secret", "old-secret"], now)).toBe(
      true,
    );
    expect(await verifyKwsWebhookSignature(header, body, ["new-secret"], now)).toBe(false);
  });

  it("accepts either of two signatures KWS sends during its own rotation", async () => {
    const a = await hmacSha256Hex("a", `${t}.${body}`);
    const b = await hmacSha256Hex("b", `${t}.${body}`);
    expect(await verifyKwsWebhookSignature(`t=${t},v1=${a},v1=${b}`, body, ["b"], now)).toBe(true);
  });

  it("rejects a tampered body, a missing secret and a stale timestamp", async () => {
    const sig = await hmacSha256Hex("s", `${t}.${body}`);
    expect(await verifyKwsWebhookSignature(`t=${t},v1=${sig}`, body + " ", ["s"], now)).toBe(false);
    expect(await verifyKwsWebhookSignature(`t=${t},v1=${sig}`, body, [], now)).toBe(false);
    const old = String(Math.floor(now / 1000) - 3 * 24 * 3600);
    const oldSig = await hmacSha256Hex("s", `${old}.${body}`);
    expect(await verifyKwsWebhookSignature(`t=${old},v1=${oldSig}`, body, ["s"], now)).toBe(false);
  });
});

describe("redirect signature", () => {
  it("signs status:externalPayload and rejects a tampered status", async () => {
    const status = JSON.stringify({ verified: true, transactionId: "tx1", errorCode: null });
    const payload = encodeExternalPayload({ parentId: PARENT, userId: USER });
    const sig = await hmacSha256Hex("vsecret", `${status}:${payload}`);
    expect(await verifyKwsRedirectSignature(status, payload, [sig], ["vsecret"])).toBe(true);
    expect(
      await verifyKwsRedirectSignature(status, payload, [sig.toUpperCase()], ["vsecret"]),
    ).toBe(true);
    const forged = status.replace("true", "false");
    expect(await verifyKwsRedirectSignature(forged, payload, [sig], ["vsecret"])).toBe(false);
    expect(await verifyKwsRedirectSignature(status, payload, [], ["vsecret"])).toBe(false);
  });
});

describe("kwsSendVerificationEmail", () => {
  const cfg = {
    clientId: "client",
    apiKey: "secret",
    tokenUrl: "https://auth.test/token",
    sendEmailUrl: "https://api.test/send-email",
  };
  const input = {
    email: "parent@example.com",
    location: "US",
    language: "en",
    externalPayload: encodeExternalPayload({ parentId: PARENT, userId: USER }),
  };

  function fakeFetch(responses: Array<{ status: number; body?: unknown }>) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push({ url, init: init ?? {} });
      const next = responses.shift() ?? { status: 200, body: {} };
      return new Response(JSON.stringify(next.body ?? {}), { status: next.status });
    };
    return { calls, fetchImpl };
  }

  it("fetches a token with Basic auth, then posts the email with Bearer and a user-agent", async () => {
    const { calls, fetchImpl } = fakeFetch([
      { status: 200, body: { access_token: "tok", expires_in: 3600 } },
      { status: 200, body: {} },
    ]);
    const result = await kwsSendVerificationEmail(cfg, input, { fetchImpl });
    expect(result).toEqual({ ok: true, status: 200 });
    expect(calls).toHaveLength(2);

    const token = calls[0];
    expect(token.url).toBe(cfg.tokenUrl);
    expect((token.init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${btoa("client:secret")}`,
    );
    expect(token.init.body).toBe("grant_type=client_credentials&scope=verification");

    const send = calls[1];
    expect(send.url).toBe(cfg.sendEmailUrl);
    const headers = send.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok");
    expect(headers["User-Agent"]).toBe(KWS_USER_AGENT);
    expect(JSON.parse(String(send.init.body))).toEqual({
      email: "parent@example.com",
      location: "US",
      language: "en",
      externalPayload: input.externalPayload,
      userContext: "parent",
    });
  });

  it("surfaces KWS's per-email rate limit without retrying it", async () => {
    const { calls, fetchImpl } = fakeFetch([
      { status: 200, body: { access_token: "tok" } },
      { status: 429, body: { error: "too many" } },
    ]);
    const result = await kwsSendVerificationEmail(cfg, input, { fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(429);
    expect(calls).toHaveLength(2);
  });

  it("retries a 5xx with backoff and succeeds on the next attempt", async () => {
    const waits: number[] = [];
    const { calls, fetchImpl } = fakeFetch([
      { status: 200, body: { access_token: "tok" } },
      { status: 503, body: {} },
      { status: 200, body: {} },
    ]);
    const result = await kwsSendVerificationEmail(cfg, input, {
      fetchImpl,
      sleep: async (ms) => {
        waits.push(ms);
      },
      baseMs: 10,
    });
    expect(result).toEqual({ ok: true, status: 200 });
    expect(calls).toHaveLength(3);
    expect(waits).toEqual([10]);
  });

  it("fails when the token response has no access_token", async () => {
    const { fetchImpl } = fakeFetch([{ status: 200, body: {} }]);
    await expect(kwsSendVerificationEmail(cfg, input, { fetchImpl })).rejects.toThrow(
      /access_token/,
    );
  });
});
