import { describe, expect, it } from "bun:test";
import type { ApnsConfig, ApnsOutcome, ApnsRequest } from "./apns.server";
import {
  athleteHouseholdUserIds,
  MESSAGE_CATEGORY,
  notifyUsers,
  pushPayload,
  roomMessagePush,
  truncateBody,
  withoutBlocked,
} from "./push-notify.server";

type Row = Record<string, unknown>;

/**
 * A row-store fake covering the query shapes this module issues:
 * `.select().eq()/.in()` chains (optionally `.maybeSingle()`), and
 * `.delete().in()`. Deletes are recorded so tests can assert pruning.
 */
function fakeAdmin(tables: Record<string, Row[]>) {
  const deleted: { table: string; col: string; vals: unknown[] }[] = [];
  const query = (rows: Row[]) => {
    const self = {
      eq: (col: string, val: unknown) => query(rows.filter((r) => r[col] === val)),
      in: (col: string, vals: unknown[]) => query(rows.filter((r) => vals.includes(r[col]))),
      maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      then: (resolve: (v: { data: Row[]; error: null }) => void) =>
        resolve({ data: rows, error: null }),
    };
    return self;
  };
  const admin = {
    from: (table: string) => ({
      select: () => query(tables[table] ?? []),
      delete: () => ({
        in: (col: string, vals: unknown[]) => {
          deleted.push({ table, col, vals });
          tables[table] = (tables[table] ?? []).filter((r) => !vals.includes(r[col]));
          return Promise.resolve({ error: null });
        },
      }),
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return { admin, deleted };
}

const config: ApnsConfig = {
  teamId: "T",
  keyId: "K",
  privateKeyPem: "unused",
  bundleId: "training.gradus.app",
  host: "https://apns.test",
};

function sendSpy(outcomeFor: (req: ApnsRequest) => ApnsOutcome) {
  const sent: ApnsRequest[] = [];
  const send = async (_config: ApnsConfig, req: ApnsRequest): Promise<ApnsOutcome> => {
    sent.push(req);
    return outcomeFor(req);
  };
  return { send, sent };
}

describe("pushPayload", () => {
  it("builds the PRD alert shape with gradus.type/route/v", () => {
    expect(
      pushPayload({
        type: "message",
        route: "rooms/r1",
        title: "Coach Linnea",
        body: "Nice loop",
        threadId: "room:r1",
      }),
    ).toEqual({
      payload: {
        aps: {
          alert: { title: "Coach Linnea", body: "Nice loop" },
          sound: "default",
          "thread-id": "room:r1",
        },
        gradus: { type: "message", route: "rooms/r1", v: 1 },
      },
      pushType: "alert",
      priority: 10,
    });
  });

  it("adds aps.category when the message names one (decision #54)", () => {
    const { payload } = pushPayload({
      type: "message",
      route: "rooms/r1",
      title: "Coach Linnea",
      body: "Nice loop",
      threadId: "room:r1",
      category: MESSAGE_CATEGORY,
    });
    expect(payload.aps).toEqual({
      alert: { title: "Coach Linnea", body: "Nice loop" },
      sound: "default",
      "thread-id": "room:r1",
      category: "GRADUS_MESSAGE",
    });
  });

  it("leaves aps.category out when none is given", () => {
    const { payload } = pushPayload({ type: "plan_assigned", route: "plans/p1", body: "New plan" });
    expect("category" in (payload.aps as Record<string, unknown>)).toBe(false);
  });

  it("never puts a category on a silent push", () => {
    const { payload } = pushPayload({
      type: "entitlement",
      route: "settings/plan",
      silent: true,
      category: MESSAGE_CATEGORY,
    });
    expect(payload.aps).toEqual({ "content-available": 1 });
  });

  it("names the recipient in gradus.uid, so the apps can refuse another account's notification", () => {
    const message = { type: "message", route: "rooms/r1", body: "Nice loop" };
    expect(pushPayload(message, "user-renata").payload.gradus).toEqual({
      type: "message",
      route: "rooms/r1",
      v: 1,
      uid: "user-renata",
    });
    expect(pushPayload({ ...message, silent: true }, "user-renata").payload.gradus).toMatchObject({
      uid: "user-renata",
    });
    expect("uid" in (pushPayload(message).payload.gradus as Record<string, unknown>)).toBe(false);
  });

  it("builds every room message push with the Reply category", () => {
    expect(roomMessagePush("r1", "Coach Linnea", "Nice loop")).toEqual({
      type: "message",
      route: "rooms/r1",
      title: "Coach Linnea",
      body: "Nice loop",
      threadId: "room:r1",
      category: MESSAGE_CATEGORY,
    });
  });

  it("builds a silent background push with no alert", () => {
    expect(pushPayload({ type: "entitlement", route: "settings/plan", silent: true })).toEqual({
      payload: {
        aps: { "content-available": 1 },
        gradus: { type: "entitlement", route: "settings/plan", v: 1 },
      },
      pushType: "background",
      priority: 5,
    });
  });

  it("collapses whitespace and truncates long bodies", () => {
    expect(truncateBody("  a \n b  ")).toBe("a b");
    const long = "x".repeat(200);
    expect(truncateBody(long)).toHaveLength(160);
    expect(truncateBody(long).endsWith("…")).toBe(true);
  });
});

describe("notifyUsers", () => {
  const tokens = [
    { user_id: "u1", token: "tok-u1-a", platform: "ios" },
    { user_id: "u1", token: "tok-u1-b", platform: "ios" },
    { user_id: "u2", token: "tok-u2", platform: "ios" },
    { user_id: "u2", token: "tok-u2-android", platform: "android" },
    { user_id: "u3", token: "tok-u3", platform: "ios" },
  ];

  it("sends one push per iOS token of each recipient and reports counts", async () => {
    const { admin } = fakeAdmin({ device_tokens: [...tokens] });
    const { send, sent } = sendSpy(() => ({ ok: true, apnsId: "x" }));
    const report = await notifyUsers(
      admin,
      ["u1", "u2", "u1", ""],
      { type: "message", route: "rooms/r1", body: "hi" },
      { config, send },
    );
    expect(report).toEqual({ recipients: 2, tokens: 3, sent: 3, failed: 0, pruned: 0 });
    expect(sent.map((r) => r.token).sort()).toEqual(["tok-u1-a", "tok-u1-b", "tok-u2"]);
    expect(sent[0].pushType).toBe("alert");
    const first = sent.find((r) => r.token === "tok-u1-a")!;
    expect(first.payload).toEqual({
      aps: { alert: { body: "hi" }, sound: "default" },
      gradus: { type: "message", route: "rooms/r1", v: 1, uid: "u1" },
    });
    // Each device hears about its own account, never another recipient's.
    for (const req of sent) {
      const owner = tokens.find((t) => t.token === req.token)!.user_id;
      expect((req.payload.gradus as Record<string, unknown>).uid).toBe(owner);
    }
  });

  it("deletes tokens APNs reports as dead and keeps the rest", async () => {
    const { admin, deleted } = fakeAdmin({ device_tokens: [...tokens] });
    const { send } = sendSpy((req) =>
      req.token === "tok-u1-a"
        ? { ok: false, status: 410, reason: "Unregistered", dead: true }
        : req.token === "tok-u1-b"
          ? { ok: false, status: 500, reason: "InternalServerError", dead: false }
          : { ok: true, apnsId: null },
    );
    const report = await notifyUsers(
      admin,
      ["u1", "u3"],
      { type: "message", route: "rooms/r1" },
      { config, send },
    );
    expect(report).toEqual({ recipients: 2, tokens: 3, sent: 1, failed: 2, pruned: 1 });
    expect(deleted).toEqual([{ table: "device_tokens", col: "token", vals: ["tok-u1-a"] }]);
  });

  it("skips cleanly when APNs is not configured, when there are no recipients, or no tokens", async () => {
    const { admin } = fakeAdmin({ device_tokens: [...tokens] });
    const { send, sent } = sendSpy(() => ({ ok: true, apnsId: null }));
    expect(
      (await notifyUsers(admin, ["u1"], { type: "x", route: "plans" }, { config: null, send }))
        .skipped,
    ).toBe("no_config");
    expect(
      (await notifyUsers(admin, [], { type: "x", route: "plans" }, { config, send })).skipped,
    ).toBe("no_recipients");
    expect(
      (await notifyUsers(admin, ["nobody"], { type: "x", route: "plans" }, { config, send }))
        .skipped,
    ).toBe("no_tokens");
    expect(sent).toHaveLength(0);
  });
});

describe("athleteHouseholdUserIds", () => {
  const base = {
    athletes: [{ id: "a1", user_id: "athlete-user", parent_id: "p1" }],
    parent_profiles: [
      {
        id: "p1",
        user_id: "primary-user",
        subscription_status: "active" as string | null,
        current_period_end: null as string | null,
      },
      {
        id: "p2",
        user_id: "co-user",
        subscription_status: null as string | null,
        current_period_end: null as string | null,
      },
    ],
    athlete_guardians: [
      { athlete_id: "a1", parent_id: "p2", role: "co" },
      { athlete_id: "a1", parent_id: "p1", role: "primary" },
    ],
  };

  it("includes the athlete, the primary parent, and co-guardians on an active Team plan", async () => {
    const { admin } = fakeAdmin(structuredClone(base));
    const ids = await athleteHouseholdUserIds(admin, "a1");
    expect(ids.sort()).toEqual(["athlete-user", "co-user", "primary-user"]);
  });

  it("drops co-guardians once the primary parent's Team plan lapses, and can exclude the athlete", async () => {
    const lapsed = structuredClone(base);
    // A canceled plan stays active until its paid period ends (teamPlanActive), so expire it.
    lapsed.parent_profiles[0].subscription_status = "canceled";
    lapsed.parent_profiles[0].current_period_end = "2020-01-01T00:00:00Z";
    const { admin } = fakeAdmin(lapsed);
    expect((await athleteHouseholdUserIds(admin, "a1")).sort()).toEqual([
      "athlete-user",
      "primary-user",
    ]);
    expect(await athleteHouseholdUserIds(admin, "a1", { includeAthlete: false })).toEqual([
      "primary-user",
    ]);
  });

  it("returns nothing for an unknown athlete and skips a null login", async () => {
    const { admin } = fakeAdmin({
      athletes: [{ id: "a2", user_id: null, parent_id: "p1" }],
      parent_profiles: [
        { id: "p1", user_id: "primary-user", subscription_status: null, current_period_end: null },
      ],
      athlete_guardians: [],
    });
    expect(await athleteHouseholdUserIds(admin, "missing")).toEqual([]);
    expect(await athleteHouseholdUserIds(admin, "a2")).toEqual(["primary-user"]);
  });
});

describe("withoutBlocked", () => {
  it("removes the sender, anyone who blocked them, and anyone they blocked", async () => {
    const { admin } = fakeAdmin({
      user_blocks: [
        { blocker_user_id: "u2", blocked_user_id: "sender" },
        { blocker_user_id: "sender", blocked_user_id: "u3" },
      ],
    });
    expect(await withoutBlocked(admin, "sender", ["sender", "u1", "u2", "u3", "u4"])).toEqual([
      "u1",
      "u4",
    ]);
    expect(await withoutBlocked(admin, "sender", ["sender"])).toEqual([]);
  });
});

describe("notifyUsers never throws", () => {
  it("returns a report when the sender itself rejects", async () => {
    const { admin } = fakeAdmin({
      device_tokens: [{ user_id: "u1", token: "tok", platform: "ios" }],
    });
    const send = async () => {
      throw new Error("boom");
    };
    const report = await notifyUsers(
      admin,
      ["u1"],
      { type: "x", route: "plans" },
      { config, send },
    );
    expect(report.sent).toBe(0);
  });

  it("gives alerts a day to be delivered and silent pushes none", async () => {
    const { admin } = fakeAdmin({
      device_tokens: [{ user_id: "u1", token: "tok", platform: "ios" }],
    });
    const { send, sent } = sendSpy(() => ({ ok: true, apnsId: null }));
    const before = Math.floor(Date.now() / 1000);
    await notifyUsers(admin, ["u1"], { type: "x", route: "plans", body: "hi" }, { config, send });
    await notifyUsers(admin, ["u1"], { type: "x", route: "plans", silent: true }, { config, send });
    await notifyUsers(
      admin,
      ["u1"],
      { type: "x", route: "plans", expiresInSeconds: 60 },
      { config, send },
    );
    expect(sent[0].expiration).toBeGreaterThanOrEqual(before + 24 * 60 * 60);
    expect(sent[1].expiration).toBe(0);
    expect(sent[2].expiration).toBeGreaterThanOrEqual(before + 60);
    expect(sent[2].expiration).toBeLessThan(before + 120);
  });
});
