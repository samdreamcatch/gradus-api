import { describe, expect, it } from "bun:test";
import type { ApnsConfig, ApnsOutcome, ApnsRequest } from "./apns.server";
import type { BoardPayload, BoardSkater } from "./board-types";
import { findMySkaters } from "./board-skaters";
import {
  laneFor,
  planActivities,
  registerLiveActivityToken,
  stateFingerprint,
  swiftDate,
  syncBoardLiveActivities,
} from "./live-activities.server";

type Row = Record<string, unknown>;

/** Row-store fake: select/eq/in/is/maybeSingle chains, recorded upserts and deletes. */
function fakeAdmin(tables: Record<string, Row[]>) {
  const upserts: { table: string; rows: Row[] }[] = [];
  const deletes: { table: string; col: string; vals: unknown[] }[] = [];
  const query = (rows: Row[]) => {
    const self = {
      eq: (col: string, val: unknown) => query(rows.filter((r) => r[col] === val)),
      in: (col: string, vals: unknown[]) => query(rows.filter((r) => vals.includes(r[col]))),
      is: (col: string, val: unknown) => query(rows.filter((r) => (r[col] ?? null) === val)),
      maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      then: (resolve: (v: { data: Row[]; error: null }) => void) =>
        resolve({ data: rows, error: null }),
    };
    return self;
  };
  const admin = {
    from: (table: string) => ({
      select: () => query(tables[table] ?? []),
      upsert: (payload: Row | Row[]) => {
        const rows = Array.isArray(payload) ? payload : [payload];
        upserts.push({ table, rows });
        return Promise.resolve({ error: null });
      },
      delete: () => ({
        in: (col: string, vals: unknown[]) => {
          deletes.push({ table, col, vals });
          return Promise.resolve({ error: null });
        },
        eq: (col: string, val: unknown) => ({
          eq: (col2: string, val2: unknown) => {
            deletes.push({ table, col: `${col},${col2}`, vals: [val, val2] });
            return Promise.resolve({ error: null });
          },
        }),
      }),
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return { admin, upserts, deletes };
}

const config: ApnsConfig = {
  teamId: "T",
  keyId: "K",
  privateKeyPem: "x",
  bundleId: "training.gradus.app",
  host: "https://apns.test",
};

function sendSpy(outcome: (req: ApnsRequest) => ApnsOutcome = () => ({ ok: true, apnsId: null })) {
  const sent: ApnsRequest[] = [];
  const send = async (_c: ApnsConfig, req: ApnsRequest): Promise<ApnsOutcome> => {
    sent.push(req);
    return outcome(req);
  };
  return { send, sent };
}

function skater(start: number, name: string, segScore = ""): BoardSkater {
  return {
    start,
    of: 4,
    name,
    club: "DSC",
    group: "A",
    segScore,
    total: segScore,
    place: segScore ? "1" : "",
  };
}

/** One live event, four skaters; `done` scores posted so far. */
function payloadWith(done: number, status: "live" | "final" = "live"): BoardPayload {
  const results = [
    skater(1, "Ava Reyes", done >= 1 ? "60.10" : ""),
    skater(2, "Nora Donaldson", done >= 2 ? "62.41" : ""),
    skater(3, "Ben Ito", done >= 3 ? "58.00" : ""),
    skater(4, "Mia Chen", done >= 4 ? "55.30" : ""),
  ];
  return {
    generatedAt: "2026-09-19T15:00:00.000Z",
    competition: { name: "Winter Classic", dates: "", location: "", url: "" },
    rinks: [],
    schedule: [
      {
        file: "ev1",
        name: "Juvenile Girls",
        segment: "Free Skate",
        rink: "Main Rink",
        timeLabel: "10:00 AM",
        startIso: "2026-09-19T14:00:00.000Z",
        status,
        count: 4,
        dayLabel: "Sat",
        dayKey: "2026-09-19",
        results,
      },
    ],
    errors: [],
  };
}

const NOW = Date.UTC(2026, 8, 19, 15, 0, 30);
const NORA_KEY = "winter|ev1|nora donaldson";

describe("planActivities", () => {
  it("mirrors the app's planner: live events only, ranked by lane, keyed by slug|file|normalized name", () => {
    const matches = findMySkaters(payloadWith(1), ["nora donaldson", "Mia Chen", "Ava Reyes"]);
    const plans = planActivities(
      matches,
      { slug: "winter", name: "Winter Classic", generatedAt: "2026-09-19T15:00:00.000Z" },
      NOW,
    );
    expect(plans.map((p) => [p.attributes.activityKey, p.state.lane])).toEqual([
      [NORA_KEY, "onIce"], // start 2, one score posted → ahead 0
      ["winter|ev1|ava reyes", "justScored"], // scored with ahead -1
      ["winter|ev1|mia chen", "waiting"],
    ]);
    expect(plans[0].state).toEqual({
      lane: "onIce",
      startPosition: 2,
      of: 4,
      ahead: 0,
      updatedAt: swiftDate(Date.parse("2026-09-19T15:00:00.000Z")),
      done: 1,
    });
    expect(plans[1].state.score).toBe("60.10");
    expect(plans[1].state.place).toBe("1");
    expect(
      planActivities(
        findMySkaters(payloadWith(0, "final"), ["Nora Donaldson"]),
        { slug: "w", name: "W", generatedAt: null },
        NOW,
      ),
    ).toEqual([]);
  });

  it("encodes dates the way Swift's default JSONDecoder reads them and ignores updatedAt in the fingerprint", () => {
    expect(swiftDate(Date.UTC(2001, 0, 1))).toBe(0);
    const a = { lane: "onIce" as const, startPosition: 2, of: 4, ahead: 0, updatedAt: 1, done: 1 };
    const b = { ...a, updatedAt: 999 };
    expect(stateFingerprint(a)).toBe(stateFingerprint(b));
    expect(stateFingerprint({ ...a, lane: "upNext" })).not.toBe(stateFingerprint(a));
    expect(laneFor({ state: "scored", ahead: -1 } as never)).toBe("justScored");
    expect(laneFor({ state: "scored", ahead: -3 } as never)).toBe("scored");
  });
});

describe("syncBoardLiveActivities", () => {
  const base = () => ({
    competitions: [{ id: "c1", slug: "winter", name: "Winter Classic" }],
    board_follows: [
      { user_id: "u1", skater_name: "Nora Donaldson", competition_slug: "winter" },
      { user_id: null, skater_name: "Nora Donaldson", competition_slug: "winter", device_id: "d" },
    ],
    live_activity_tokens: [
      { user_id: "u1", token: "start-tok", kind: "board_start", activity_key: null },
    ] as Row[],
    live_activity_sessions: [] as Row[],
  });

  it("starts an activity with push-to-start when a followed skater's event is live", async () => {
    const { admin, upserts } = fakeAdmin(base());
    const { send, sent } = sendSpy();
    const report = await syncBoardLiveActivities(admin, { id: "c1" }, payloadWith(1), {
      config,
      send,
      now: () => NOW,
    });
    expect(report).toEqual({ followers: 1, started: 1, updated: 0, ended: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0].token).toBe("start-tok");
    expect(sent[0].pushType).toBe("liveactivity");
    expect(sent[0].priority).toBe(10);
    const aps = sent[0].payload.aps as Record<string, unknown>;
    expect(aps.event).toBe("start");
    expect(aps["attributes-type"]).toBe("BoardActivityAttributes");
    expect(aps.attributes).toEqual({
      activityKey: NORA_KEY,
      slug: "winter",
      competitionName: "Winter Classic",
      skaterName: "Nora Donaldson",
      eventName: "Juvenile Girls",
      segment: "Free Skate",
      rink: "Main Rink",
    });
    expect((aps["content-state"] as { lane: string }).lane).toBe("onIce");
    expect(aps.alert).toEqual({ title: "Nora: On the ice", body: "Juvenile Girls · Main Rink" });
    expect(aps["input-push-token"]).toBe(1);
    expect(upserts).toHaveLength(1);
    expect(upserts[0].rows[0]).toMatchObject({
      user_id: "u1",
      activity_key: NORA_KEY,
      competition_slug: "winter",
      ended_at: null,
    });
  });

  it("does nothing without a start token, and never starts the same activity twice", async () => {
    const noToken = base();
    noToken.live_activity_tokens = [];
    const { send, sent } = sendSpy();
    expect(
      await syncBoardLiveActivities(fakeAdmin(noToken).admin, { id: "c1" }, payloadWith(1), {
        config,
        send,
        now: () => NOW,
      }),
    ).toEqual({ followers: 1, started: 0, updated: 0, ended: 0 });

    const tracked = base();
    tracked.live_activity_sessions = [
      {
        user_id: "u1",
        competition_slug: "winter",
        activity_key: NORA_KEY,
        last_state: stateFingerprint({
          lane: "onIce",
          startPosition: 2,
          of: 4,
          ahead: 0,
          updatedAt: 0,
          done: 1,
        }),
        ended_at: null,
      },
    ];
    expect(
      await syncBoardLiveActivities(fakeAdmin(tracked).admin, { id: "c1" }, payloadWith(1), {
        config,
        send,
        now: () => NOW,
      }),
    ).toEqual({ followers: 1, started: 0, updated: 0, ended: 0 });
    expect(sent).toHaveLength(0);
  });

  it("updates through the activity's update token only when the state really changed", async () => {
    const tracked = base();
    tracked.live_activity_tokens.push({
      user_id: "u1",
      token: "upd-tok",
      kind: "board_update",
      activity_key: NORA_KEY,
    });
    tracked.live_activity_sessions = [
      {
        user_id: "u1",
        competition_slug: "winter",
        activity_key: NORA_KEY,
        last_state: stateFingerprint({
          lane: "onIce",
          startPosition: 2,
          of: 4,
          ahead: 0,
          updatedAt: 0,
          done: 1,
        }),
        ended_at: null,
      },
    ];
    const { send, sent } = sendSpy();
    // Same lane, later refresh: no push.
    expect(
      await syncBoardLiveActivities(fakeAdmin(tracked).admin, { id: "c1" }, payloadWith(1), {
        config,
        send,
        now: () => NOW,
      }),
    ).toMatchObject({ updated: 0 });
    // Nora scores: justScored → one update, urgent.
    const { admin, upserts } = fakeAdmin(tracked);
    const report = await syncBoardLiveActivities(admin, { id: "c1" }, payloadWith(2), {
      config,
      send,
      now: () => NOW,
    });
    expect(report).toEqual({ followers: 1, started: 0, updated: 1, ended: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0].token).toBe("upd-tok");
    expect(sent[0].priority).toBe(10);
    const aps = sent[0].payload.aps as Record<string, unknown>;
    expect(aps.event).toBe("update");
    expect(aps["content-state"]).toMatchObject({
      lane: "justScored",
      score: "62.41",
      ahead: -1,
      done: 2,
    });
    expect(upserts[0].rows[0]).toMatchObject({ activity_key: NORA_KEY, ended_at: null });
  });

  it("ends a tracked activity once its event is final, with a dismissal date, and marks the session ended", async () => {
    const tracked = base();
    tracked.live_activity_tokens.push({
      user_id: "u1",
      token: "upd-tok",
      kind: "board_update",
      activity_key: NORA_KEY,
    });
    tracked.live_activity_sessions = [
      {
        user_id: "u1",
        competition_slug: "winter",
        activity_key: NORA_KEY,
        last_state: stateFingerprint({
          lane: "justScored",
          startPosition: 2,
          of: 4,
          ahead: -1,
          score: "62.41",
          updatedAt: 0,
          done: 2,
        }),
        ended_at: null,
      },
    ];
    const { admin, upserts } = fakeAdmin(tracked);
    const { send, sent } = sendSpy();
    const report = await syncBoardLiveActivities(admin, { id: "c1" }, payloadWith(4, "final"), {
      config,
      send,
      now: () => NOW,
    });
    expect(report).toEqual({ followers: 1, started: 0, updated: 0, ended: 1 });
    expect(sent).toHaveLength(1);
    const aps = sent[0].payload.aps as Record<string, unknown>;
    expect(aps.event).toBe("end");
    expect(aps["dismissal-date"]).toBe(Math.floor(NOW / 1000) + 15 * 60);
    expect(aps["content-state"]).toMatchObject({ lane: "ended", score: "62.41", startPosition: 2 });
    expect(upserts[0].rows[0]).toMatchObject({
      activity_key: NORA_KEY,
      ended_at: new Date(NOW).toISOString(),
    });
  });

  it("prunes tokens APNs rejects as dead and skips cleanly with no config or no followers", async () => {
    const { admin, deletes } = fakeAdmin(base());
    const { send } = sendSpy(() => ({
      ok: false,
      status: 410,
      reason: "Unregistered",
      dead: true,
    }));
    const report = await syncBoardLiveActivities(admin, { id: "c1" }, payloadWith(1), {
      config,
      send,
      now: () => NOW,
    });
    expect(report).toEqual({ followers: 1, started: 0, updated: 0, ended: 0 });
    expect(deletes).toEqual([{ table: "live_activity_tokens", col: "token", vals: ["start-tok"] }]);

    expect(
      (await syncBoardLiveActivities(admin, { id: "c1" }, payloadWith(1), { config: null, send }))
        .skipped,
    ).toBe("no_config");
    const lonely = base();
    lonely.board_follows = [];
    expect(
      (
        await syncBoardLiveActivities(fakeAdmin(lonely).admin, { id: "c1" }, payloadWith(1), {
          config,
          send,
        })
      ).skipped,
    ).toBe("no_followers");
    expect(
      (await syncBoardLiveActivities(admin, { id: "c1" }, null, { config, send })).skipped,
    ).toBe("no_payload");
  });
});

describe("registerLiveActivityToken", () => {
  it("upserts on the token with the caller's user id and clears activity_key for start tokens", async () => {
    const { admin, upserts } = fakeAdmin({});
    await registerLiveActivityToken(
      { userId: "u1", supabase: admin },
      { token: "abcdefgh", kind: "board_start" },
    );
    await registerLiveActivityToken(
      { userId: "u1", supabase: admin },
      { token: "ijklmnop", kind: "board_update", activityKey: NORA_KEY },
    );
    expect(upserts[0].rows[0]).toMatchObject({
      user_id: "u1",
      token: "abcdefgh",
      kind: "board_start",
      activity_key: null,
    });
    expect(upserts[1].rows[0]).toMatchObject({
      user_id: "u1",
      token: "ijklmnop",
      kind: "board_update",
      activity_key: NORA_KEY,
    });
    await expect(
      registerLiveActivityToken(
        { userId: "u1", supabase: admin },
        { token: "ijklmnop", kind: "board_update" },
      ),
    ).rejects.toThrow();
  });
});
