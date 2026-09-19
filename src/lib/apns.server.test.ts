import { describe, expect, it } from "bun:test";
import { decodeJwt, decodeProtectedHeader, exportPKCS8, generateKeyPair } from "jose";
import {
  apnsConfigFromEnv,
  apnsTopic,
  resetApnsTokenCache,
  sendApnsRequest,
  type ApnsConfig,
} from "./apns.server";

type Captured = { url: string; init: RequestInit };

async function testConfig(): Promise<ApnsConfig> {
  const { privateKey } = await generateKeyPair("ES256", { extractable: true });
  return {
    teamId: "TEAMID1234",
    keyId: "KEYID12345",
    privateKeyPem: await exportPKCS8(privateKey),
    bundleId: "training.gradus.app",
    host: "https://apns.test",
  };
}

/** A fetch stub that answers from a queue of responses and records every call. */
function fetchStub(responses: Array<() => Response>) {
  const calls: Captured[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error("unexpected fetch");
    return next();
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const ok = () => new Response(null, { status: 200, headers: { "apns-id": "abc-123" } });
const apnsError = (status: number, reason: string) => () =>
  new Response(JSON.stringify({ reason }), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("apnsConfigFromEnv", () => {
  it("is null until all three secrets exist, and defaults bundle id and host", () => {
    expect(apnsConfigFromEnv({} as NodeJS.ProcessEnv)).toBeNull();
    expect(
      apnsConfigFromEnv({ APPLE_TEAM_ID: "t", APNS_KEY_ID: "k" } as NodeJS.ProcessEnv),
    ).toBeNull();
    const cfg = apnsConfigFromEnv({
      APPLE_TEAM_ID: "t",
      APNS_KEY_ID: "k",
      APNS_KEY_P8: "p",
    } as NodeJS.ProcessEnv);
    expect(cfg).toEqual({
      teamId: "t",
      keyId: "k",
      privateKeyPem: "p",
      bundleId: "training.gradus.app",
      host: "https://api.push.apple.com",
    });
    const sandbox = apnsConfigFromEnv({
      APPLE_TEAM_ID: "t",
      APNS_KEY_ID: "k",
      APNS_KEY_P8: "p",
      APNS_ENV: "sandbox",
      APNS_BUNDLE_ID: "x.y",
    } as NodeJS.ProcessEnv);
    expect(sandbox?.host).toBe("https://api.sandbox.push.apple.com");
    expect(sandbox?.bundleId).toBe("x.y");
  });

  it("derives the Live Activity topic from the bundle id", () => {
    expect(apnsTopic("training.gradus.app", "alert")).toBe("training.gradus.app");
    expect(apnsTopic("training.gradus.app", "background")).toBe("training.gradus.app");
    expect(apnsTopic("training.gradus.app", "liveactivity")).toBe(
      "training.gradus.app.push-type.liveactivity",
    );
  });
});

describe("sendApnsRequest", () => {
  it("POSTs to /3/device/<token> with an ES256 provider token and the APNs headers", async () => {
    resetApnsTokenCache();
    const config = await testConfig();
    const { fetchImpl, calls } = fetchStub([ok]);
    const outcome = await sendApnsRequest(
      config,
      {
        token: "deadbeef",
        payload: { aps: { alert: { body: "hi" } } },
        pushType: "alert",
        collapseId: "room:1",
      },
      { fetch: fetchImpl, now: () => 1_700_000_000_000 },
    );
    expect(outcome).toEqual({ ok: true, apnsId: "abc-123" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://apns.test/3/device/deadbeef");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["apns-topic"]).toBe("training.gradus.app");
    expect(headers["apns-push-type"]).toBe("alert");
    expect(headers["apns-priority"]).toBe("10");
    expect(headers["apns-expiration"]).toBe("0");
    expect(headers["apns-collapse-id"]).toBe("room:1");
    expect(calls[0].init.body).toBe(JSON.stringify({ aps: { alert: { body: "hi" } } }));

    const jwt = headers.authorization.replace(/^bearer /, "");
    expect(decodeProtectedHeader(jwt)).toEqual({ alg: "ES256", kid: "KEYID12345" });
    const claims = decodeJwt(jwt);
    expect(claims.iss).toBe("TEAMID1234");
    expect(claims.iat).toBe(1_700_000_000);
  });

  it("uses low priority and the liveactivity topic for Live Activity pushes", async () => {
    resetApnsTokenCache();
    const config = await testConfig();
    const { fetchImpl, calls } = fetchStub([ok]);
    await sendApnsRequest(
      config,
      { token: "t", payload: {}, pushType: "liveactivity" },
      { fetch: fetchImpl },
    );
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["apns-topic"]).toBe("training.gradus.app.push-type.liveactivity");
    expect(headers["apns-push-type"]).toBe("liveactivity");
    expect(headers["apns-priority"]).toBe("5");
  });

  it("reuses the provider token within 50 minutes and mints a new one after", async () => {
    resetApnsTokenCache();
    const config = await testConfig();
    const { fetchImpl, calls } = fetchStub([ok, ok, ok]);
    let now = 1_700_000_000_000;
    const clock = () => now;
    const bearer = (i: number) => (calls[i].init.headers as Record<string, string>).authorization;
    await sendApnsRequest(
      config,
      { token: "t", payload: {}, pushType: "alert" },
      { fetch: fetchImpl, now: clock },
    );
    now += 10 * 60 * 1000;
    await sendApnsRequest(
      config,
      { token: "t", payload: {}, pushType: "alert" },
      { fetch: fetchImpl, now: clock },
    );
    expect(bearer(1)).toBe(bearer(0));
    now += 45 * 60 * 1000;
    await sendApnsRequest(
      config,
      { token: "t", payload: {}, pushType: "alert" },
      { fetch: fetchImpl, now: clock },
    );
    expect(bearer(2)).not.toBe(bearer(0));
  });

  it("marks 410 Unregistered and 400 BadDeviceToken as dead tokens, other failures as retryable", async () => {
    resetApnsTokenCache();
    const config = await testConfig();
    const { fetchImpl } = fetchStub([
      apnsError(410, "Unregistered"),
      apnsError(400, "BadDeviceToken"),
      apnsError(400, "DeviceTokenNotForTopic"),
      apnsError(429, "TooManyRequests"),
      apnsError(500, "InternalServerError"),
    ]);
    const req = { token: "t", payload: {}, pushType: "alert" as const };
    expect(await sendApnsRequest(config, req, { fetch: fetchImpl })).toEqual({
      ok: false,
      status: 410,
      reason: "Unregistered",
      dead: true,
    });
    expect(await sendApnsRequest(config, req, { fetch: fetchImpl })).toEqual({
      ok: false,
      status: 400,
      reason: "BadDeviceToken",
      dead: true,
    });
    expect(await sendApnsRequest(config, req, { fetch: fetchImpl })).toEqual({
      ok: false,
      status: 400,
      reason: "DeviceTokenNotForTopic",
      dead: true,
    });
    expect(await sendApnsRequest(config, req, { fetch: fetchImpl })).toEqual({
      ok: false,
      status: 429,
      reason: "TooManyRequests",
      dead: false,
    });
    expect(await sendApnsRequest(config, req, { fetch: fetchImpl })).toEqual({
      ok: false,
      status: 500,
      reason: "InternalServerError",
      dead: false,
    });
  });

  it("retries once with a fresh provider token when APNs says the token expired", async () => {
    resetApnsTokenCache();
    const config = await testConfig();
    const { fetchImpl, calls } = fetchStub([apnsError(403, "ExpiredProviderToken"), ok]);
    let now = 1_700_000_000_000;
    const outcome = await sendApnsRequest(
      config,
      { token: "t", payload: {}, pushType: "alert" },
      {
        fetch: fetchImpl,
        now: () => (now += 1000),
      },
    );
    expect(outcome.ok).toBe(true);
    expect(calls).toHaveLength(2);
    const a = (calls[0].init.headers as Record<string, string>).authorization;
    const b = (calls[1].init.headers as Record<string, string>).authorization;
    expect(a).not.toBe(b);
  });

  it("gives up after the timeout and reports it as a retryable failure", async () => {
    resetApnsTokenCache();
    const config = await testConfig();
    const hanging = ((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      })) as unknown as typeof fetch;
    const outcome = await sendApnsRequest(
      config,
      { token: "t", payload: {}, pushType: "alert" },
      {
        fetch: hanging,
        timeoutMs: 10,
      },
    );
    expect(outcome).toEqual({ ok: false, status: 0, reason: "Timeout", dead: false });
  });
});
