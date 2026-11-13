import { describe, expect, it } from "bun:test";
import type { ApnsConfig, ApnsOutcome, ApnsRequest } from "./apns.server";
import {
  athleteHouseholdUserIds,
  householdsUserIds,
  MESSAGE_CATEGORY,
  notifyMany,
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
 * `.delete().in()`. Deletes are recorded so tests can assert pruning, and
 * `.rpc()` calls so tests can assert the inbox rows `notifyUsers` records.
 */
function fakeAdmin(tables: Record<string, Row[]>) {
  const deleted: { table: string; col: string; vals: unknown[] }[] = [];
  const rpcs: { fn: string; args: Record<string, unknown> }[] = [];
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
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcs.push({ fn, args });
      return Promise.resolve({ data: null, error: null });
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return { admin, deleted, rpcs };
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

describe("notifyUsers inbox", () => {
  it("records an alert for every recipient, even with no device or APNs config", async () => {
    const { admin, rpcs } = fakeAdmin({ device_tokens: [] });
    const { send } = sendSpy(() => ({ ok: true, apnsId: null }));
    await notifyUsers(
      admin,
      ["u1", "u2"],
      {
        type: "plan_assigned",
        route: "plans/p1",
        title: "New plan",
        body: "Edges is ready to practice.",
        collapseId: "plan:p1",
        athleteId: "a1",
      },
      { config: null, send },
    );
    expect(rpcs).toEqual([
      {
        fn: "record_notifications",
        args: {
          p_user_ids: ["u1", "u2"],
          p_type: "plan_assigned",
          p_title: "New plan",
          p_body: "Edges is ready to practice.",
          p_route: "plans/p1",
          p_group_key: null,
          p_actor_user_id: null,
          p_athlete_id: "a1",
          p_collapse_key: "plan:p1",
        },
      },
    ]);
  });

  it("gives every room message its own inbox row and uses a bare body as the title", async () => {
    const { admin, rpcs } = fakeAdmin({ device_tokens: [] });
    await notifyUsers(
      admin,
      ["u1"],
      { type: "message", route: "rooms/r1", body: "hi", threadId: "room:r1" },
      { config: null },
    );
    expect(rpcs[0].args).toMatchObject({
      p_title: "hi",
      p_body: null,
      p_group_key: null,
      p_collapse_key: null,
    });
  });

  it("keeps silent pushes and inbox: false alerts out of the inbox", async () => {
    const { admin, rpcs } = fakeAdmin({ device_tokens: [] });
    await notifyUsers(
      admin,
      ["u1"],
      { type: "entitlement", route: "settings/plan", silent: true },
      { config: null },
    );
    await notifyUsers(
      admin,
      ["u1"],
      { type: "message", route: "rooms/r1", title: "Hi", inbox: false },
      { config: null },
    );
    expect(rpcs).toHaveLength(0);
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

describe("a whole squad at once (a plan shared with several athletes)", () => {
  const future = new Date(Date.now() + 86_400_000).toISOString();
  const tables = () => ({
    athletes: [
      { id: "a1", user_id: "u-a1", parent_id: "p1" },
      { id: "a2", user_id: null, parent_id: "p2" },
      { id: "a3", user_id: "u-a3", parent_id: null },
    ],
    parent_profiles: [
      { id: "p1", user_id: "u-p1", subscription_status: "active", current_period_end: future },
      { id: "p2", user_id: "u-p2", subscription_status: null, current_period_end: null },
      { id: "p3", user_id: "u-p3", subscription_status: null, current_period_end: null },
      { id: "p4", user_id: "u-p4", subscription_status: null, current_period_end: null },
    ],
    athlete_guardians: [
      { athlete_id: "a1", parent_id: "p3" },
      { athlete_id: "a2", parent_id: "p4" },
    ],
  });

  it("resolves every household by the same rule as one at a time", async () => {
    const { admin } = fakeAdmin(tables());
    const bulk = await householdsUserIds(admin, ["a1", "a2", "a3", "a1", "nobody"]);
    for (const id of ["a1", "a2", "a3"]) {
      const single = await athleteHouseholdUserIds(fakeAdmin(tables()).admin, id);
      expect([...(bulk.get(id) ?? [])].sort()).toEqual([...single].sort());
    }
    // Co-guardians only while the primary parent's Team plan is active.
    expect([...(bulk.get("a1") ?? [])].sort()).toEqual(["u-a1", "u-p1", "u-p3"]);
    expect(bulk.get("a2")).toEqual(["u-p2"]);
    expect(bulk.has("nobody")).toBe(false);
  });

  it("records each inbox row, reads tokens once, and sends each device its own message", async () => {
    const { admin, rpcs, deleted } = fakeAdmin({
      device_tokens: [
        { user_id: "u1", token: "tok-u1", platform: "ios" },
        { user_id: "u2", token: "tok-u2", platform: "ios" },
        { user_id: "u2", token: "tok-u2-dead", platform: "ios" },
      ],
    });
    const { send, sent } = sendSpy((req) =>
      req.token === "tok-u2-dead"
        ? { ok: false, status: 410, reason: "Unregistered", dead: true }
        : { ok: true, apnsId: null },
    );
    const report = await notifyMany(
      admin,
      [
        {
          userIds: ["u1"],
          message: { type: "plan_updated", route: "plans/copy-1", title: "Plan updated", body: "A" },
        },
        {
          userIds: ["u2", "u2", ""],
          message: { type: "plan_updated", route: "plans/copy-2", title: "Plan updated", body: "B" },
        },
        { userIds: [], message: { type: "plan_updated", route: "plans/copy-3", title: "x" } },
      ],
      { config, send },
    );

    expect(report).toEqual({ recipients: 2, tokens: 3, sent: 2, failed: 1, pruned: 1 });
    expect(rpcs.map((r) => r.args.p_route)).toEqual(["plans/copy-1", "plans/copy-2"]);
    const routeFor = (token: string) =>
      (sent.find((r) => r.token === token)!.payload.gradus as Record<string, unknown>).route;
    expect(routeFor("tok-u1")).toBe("plans/copy-1");
    expect(routeFor("tok-u2")).toBe("plans/copy-2");
    expect(deleted).toEqual([{ table: "device_tokens", col: "token", vals: ["tok-u2-dead"] }]);
  });

  it("still records the inbox rows when push is not configured", async () => {
    const { admin, rpcs } = fakeAdmin({ device_tokens: [] });
    const report = await notifyMany(
      admin,
      [{ userIds: ["u1"], message: { type: "plan_assigned", route: "plans/p", title: "New plan" } }],
      { config: null },
    );
    expect(report.skipped).toBe("no_config");
    expect(rpcs.length).toBe(1);
  });
});
