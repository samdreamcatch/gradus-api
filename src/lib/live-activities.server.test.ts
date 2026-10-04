import { describe, expect, it } from "bun:test";
import type { ApnsConfig, ApnsOutcome, ApnsRequest } from "./apns.server";
import type { BoardPayload, BoardSkater } from "./board-types";
import { findMySkaters } from "./board-skaters";
import {
  laneFor,
  planActivities,
  registerLiveActivityToken,
  stateFingerprint,
  syncBoardLiveActivities,
  unixSeconds,
} from "./live-activities.server";

type Row = Record<string, unknown>;

/**
 * Row-store fake. `live_activity_sessions` is a live store: upserts honour
 * `ignoreDuplicates` on (user_id, activity_key) and `.select()` returns only
 * the rows actually inserted, like PostgREST's `ON CONFLICT DO NOTHING
 * RETURNING`; deletes remove rows. Other tables are read-only fixtures.
 */
function fakeAdmin(tables: Record<string, Row[]>) {
  const sessions: Row[] = [...(tables.live_activity_sessions ?? [])];
  const deletes: { table: string; where: Record<string, unknown> }[] = [];
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
  const sessionKey = (r: Row) => `${r.user_id}|${r.activity_key}`;
  const admin = {
    from: (table: string) => ({
      select: () => query(table === "live_activity_sessions" ? sessions : (tables[table] ?? [])),
      upsert: (
        payload: Row | Row[],
        opts?: { onConflict?: string; ignoreDuplicates?: boolean },
      ) => {
        const rows = Array.isArray(payload) ? payload : [payload];
        const inserted: Row[] = [];
        if (table === "live_activity_sessions") {
          for (const row of rows) {
            const idx = sessions.findIndex((s) => sessionKey(s) === sessionKey(row));
            if (idx >= 0) {
              if (!opts?.ignoreDuplicates) sessions[idx] = { ...sessions[idx], ...row };
              continue;
            }
            sessions.push({ ...row });
            inserted.push(row);
          }
        } else {
          (tables[table] ??= []).push(...rows);
          inserted.push(...rows);
        }
        const result = { data: inserted, error: null };
        return {
          select: () => Promise.resolve(result),
          then: (resolve: (v: typeof result) => void) => resolve(result),
        };
      },
      delete: () => {
        const where: Record<string, unknown> = {};
        const apply = () => {
          deletes.push({ table, where });
          if (table === "live_activity_sessions") {
            for (let i = sessions.length - 1; i >= 0; i -= 1) {
              if (Object.entries(where).every(([k, v]) => sessions[i][k] === v))
                sessions.splice(i, 1);
            }
          }
          return Promise.resolve({ error: null });
        };
        const chain: Record<string, unknown> = {
          eq: (col: string, val: unknown) => {
            where[col] = val;
            return chain;
          },
          in: (col: string, vals: unknown[]) => {
            where[col] = vals;
            return apply();
          },
          then: (resolve: (v: { error: null }) => void) => apply().then(resolve),
        };
        return chain;
      },
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return { admin, sessions, deletes };
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
    skater(2, "Greta Halvorsen", done >= 2 ? "62.41" : ""),
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
const NOW_SEC = Math.floor(NOW / 1000);
const GRETA_KEY = "winter|ev1|greta halvorsen";
const ON_ICE = stateFingerprint({
  lane: "onIce",
  startPosition: 2,
  of: 4,
  ahead: 0,
  updatedAt: 0,
  done: 1,
});
type SendFn = (c: ApnsConfig, r: ApnsRequest) => Promise<ApnsOutcome>;
const deps = (send: SendFn) => ({ config, send, now: () => NOW });

describe("planActivities", () => {
  it("mirrors the app's planner: live events only, ranked by lane, keyed by slug|file|normalized name", () => {
    const matches = findMySkaters(payloadWith(1), ["greta halvorsen", "Mia Chen", "Ava Reyes"]);
    const plans = planActivities(
      matches,
      { slug: "winter", name: "Winter Classic", generatedAt: "2026-09-19T15:00:00.000Z" },
      NOW,
    );
    expect(plans.map((p) => [p.attributes.activityKey, p.state.lane])).toEqual([
      [GRETA_KEY, "onIce"], // start 2, one score posted → ahead 0
      ["winter|ev1|ava reyes", "justScored"], // scored with ahead -1
      ["winter|ev1|mia chen", "waiting"],
    ]);
    expect(plans[0].state).toEqual({
      lane: "onIce",
      startPosition: 2,
      of: 4,
      ahead: 0,
      updatedAt: unixSeconds(Date.parse("2026-09-19T15:00:00.000Z")),
      done: 1,
    });
    expect(plans[1].state.score).toBe("60.10");
    expect(plans[1].state.place).toBe("1");
    expect(
      planActivities(
        findMySkaters(payloadWith(0, "final"), ["Greta Halvorsen"]),
        { slug: "w", name: "W", generatedAt: null },
        NOW,
      ),
    ).toEqual([]);
  });

  it("uses unix seconds for updatedAt and ignores it in the fingerprint", () => {
    expect(unixSeconds(Date.UTC(1970, 0, 1))).toBe(0);
    const a = { lane: "onIce" as const, startPosition: 2, of: 4, ahead: 0, updatedAt: 1, done: 1 };
    expect(stateFingerprint(a)).toBe(stateFingerprint({ ...a, updatedAt: 999 }));
    expect(stateFingerprint({ ...a, lane: "upNext" })).not.toBe(stateFingerprint(a));
    expect(laneFor({ state: "scored", ahead: -1 } as never)).toBe("justScored");
    expect(laneFor({ state: "scored", ahead: -3 } as never)).toBe("scored");
  });
});

describe("syncBoardLiveActivities", () => {
  const base = () => ({
    competitions: [{ id: "c1", slug: "winter", name: "Winter Classic" }],
    board_follows: [
      { user_id: "u1", skater_name: "Greta Halvorsen", competition_slug: "winter" },
      { user_id: null, skater_name: "Greta Halvorsen", competition_slug: "winter", device_id: "d" },
    ],
    live_activity_tokens: [
      { user_id: "u1", token: "start-tok", kind: "board_start", activity_key: null },
    ] as Row[],
    live_activity_sessions: [] as Row[],
  });
  const openSession = (lastState = ON_ICE): Row => ({
    user_id: "u1",
    competition_slug: "winter",
    activity_key: GRETA_KEY,
    last_state: lastState,
    started_at: new Date(NOW - 60_000).toISOString(),
    ended_at: null,
  });

  it("starts an activity with push-to-start when a followed skater's event is live, claiming the session first", async () => {
    const { admin, sessions } = fakeAdmin(base());
    const { send, sent } = sendSpy();
    const report = await syncBoardLiveActivities(admin, { id: "c1" }, payloadWith(1), deps(send));
    expect(report).toEqual({ followers: 1, started: 1, adopted: 0, updated: 0, ended: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0].token).toBe("start-tok");
    expect(sent[0].pushType).toBe("liveactivity");
    expect(sent[0].priority).toBe(10);
    expect(sent[0].expiration).toBe(NOW_SEC + 3 * 60 * 60);
    const aps = sent[0].payload.aps as Record<string, unknown>;
    expect(aps.timestamp).toBe(NOW_SEC);
    expect(aps.event).toBe("start");
    expect(aps["attributes-type"]).toBe("BoardActivityAttributes");
    expect(aps.attributes).toEqual({
      activityKey: GRETA_KEY,
      slug: "winter",
      competitionName: "Winter Classic",
      skaterName: "Greta Halvorsen",
      eventName: "Juvenile Girls",
      segment: "Free Skate",
      rink: "Main Rink",
    });
    expect((aps["content-state"] as { lane: string }).lane).toBe("onIce");
    expect(aps["stale-date"]).toBe(NOW_SEC + 180);
    expect(aps.alert).toEqual({ title: "Greta: On the ice", body: "Juvenile Girls · Main Rink" });
    expect(aps["input-push-token"]).toBe(1);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      user_id: "u1",
      activity_key: GRETA_KEY,
      competition_slug: "winter",
      ended_at: null,
    });
  });

  it("skips the competitions lookup when slug and name are passed in", async () => {
    const fixtures = base();
    fixtures.competitions = [];
    const { send, sent } = sendSpy();
    const report = await syncBoardLiveActivities(
      fakeAdmin(fixtures).admin,
      { id: "c1", slug: "winter", name: "Winter Classic" },
      payloadWith(1),
      deps(send),
    );
    expect(report.started).toBe(1);
    expect(
      (sent[0].payload.aps as { attributes: { competitionName: string } }).attributes
        .competitionName,
    ).toBe("Winter Classic");
  });

  it("does nothing without a start token, and never starts the same activity twice", async () => {
    const noToken = base();
    noToken.live_activity_tokens = [];
    const { send, sent } = sendSpy();
    expect(
      await syncBoardLiveActivities(
        fakeAdmin(noToken).admin,
        { id: "c1" },
        payloadWith(1),
        deps(send),
      ),
    ).toEqual({ followers: 1, started: 0, adopted: 0, updated: 0, ended: 0 });

    const tracked = base();
    tracked.live_activity_sessions = [openSession()];
    expect(
      await syncBoardLiveActivities(
        fakeAdmin(tracked).admin,
        { id: "c1" },
        payloadWith(1),
        deps(send),
      ),
    ).toEqual({ followers: 1, started: 0, adopted: 0, updated: 0, ended: 0 });
    expect(sent).toHaveLength(0);
  });

  it("adopts an activity the app started locally instead of push-starting a duplicate", async () => {
    const fixtures = base();
    fixtures.live_activity_tokens.push({
      user_id: "u1",
      token: "upd-tok",
      kind: "board_update",
      activity_key: GRETA_KEY,
    });
    const { admin, sessions } = fakeAdmin(fixtures);
    const { send, sent } = sendSpy();
    const report = await syncBoardLiveActivities(admin, { id: "c1" }, payloadWith(1), deps(send));
    expect(report).toEqual({ followers: 1, started: 0, adopted: 1, updated: 0, ended: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0].token).toBe("upd-tok");
    expect((sent[0].payload.aps as { event: string }).event).toBe("update");
    expect(sessions).toHaveLength(1);
  });

  it("releases the claimed session when the start push fails transiently, so the next refresh retries", async () => {
    const { admin, sessions } = fakeAdmin(base());
    const { send } = sendSpy(() => ({
      ok: false,
      status: 503,
      reason: "ServiceUnavailable",
      dead: false,
    }));
    const report = await syncBoardLiveActivities(admin, { id: "c1" }, payloadWith(1), deps(send));
    expect(report.started).toBe(0);
    expect(sessions).toHaveLength(0);
  });

  it("updates through the activity's update token only when the state really changed", async () => {
    const tracked = base();
    tracked.live_activity_tokens.push({
      user_id: "u1",
      token: "upd-tok",
      kind: "board_update",
      activity_key: GRETA_KEY,
    });
    tracked.live_activity_sessions = [openSession()];
    const { send, sent } = sendSpy();
    // Same lane, later refresh: no push.
    expect(
      await syncBoardLiveActivities(
        fakeAdmin(tracked).admin,
        { id: "c1" },
        payloadWith(1),
        deps(send),
      ),
    ).toMatchObject({ updated: 0 });
    // Greta scores: justScored → one update, urgent.
    const { admin, sessions } = fakeAdmin(tracked);
    const report = await syncBoardLiveActivities(admin, { id: "c1" }, payloadWith(2), deps(send));
    expect(report).toEqual({ followers: 1, started: 0, adopted: 0, updated: 1, ended: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0].token).toBe("upd-tok");
    expect(sent[0].priority).toBe(10);
    expect(sent[0].expiration).toBe(NOW_SEC + 10 * 60);
    const aps = sent[0].payload.aps as Record<string, unknown>;
    expect(aps.event).toBe("update");
    expect(aps["content-state"]).toMatchObject({
      lane: "justScored",
      score: "62.41",
      ahead: -1,
      done: 2,
    });
    expect(sessions[0]).toMatchObject({
      activity_key: GRETA_KEY,
      ended_at: null,
      last_state: stateFingerprint({
        lane: "justScored",
        startPosition: 2,
        of: 4,
        ahead: -1,
        score: "62.41",
        place: "1",
        updatedAt: 0,
        done: 2,
      }),
    });
  });

  it("ends a tracked activity once its event is final, with a dismissal date, and marks the session ended", async () => {
    const tracked = base();
    tracked.live_activity_tokens.push({
      user_id: "u1",
      token: "upd-tok",
      kind: "board_update",
      activity_key: GRETA_KEY,
    });
    tracked.live_activity_sessions = [
      openSession(
        stateFingerprint({
          lane: "justScored",
          startPosition: 2,
          of: 4,
          ahead: -1,
          score: "62.41",
          updatedAt: 0,
          done: 2,
        }),
      ),
    ];
    const { admin, sessions } = fakeAdmin(tracked);
    const { send, sent } = sendSpy();
    const report = await syncBoardLiveActivities(
      admin,
      { id: "c1" },
      payloadWith(4, "final"),
      deps(send),
    );
    expect(report).toEqual({ followers: 1, started: 0, adopted: 0, updated: 0, ended: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0].expiration).toBe(NOW_SEC + 60 * 60);
    const aps = sent[0].payload.aps as Record<string, unknown>;
    expect(aps.event).toBe("end");
    expect(aps["dismissal-date"]).toBe(NOW_SEC + 15 * 60);
    expect(aps["content-state"]).toMatchObject({ lane: "ended", score: "62.41", startPosition: 2 });
    expect(sessions[0]).toMatchObject({
      activity_key: GRETA_KEY,
      ended_at: new Date(NOW).toISOString(),
    });
  });

  it("ends the activities of a user who unfollowed everything, and keeps a token-less session open until it is stale", async () => {
    const unfollowed = base();
    unfollowed.board_follows = [];
    unfollowed.live_activity_tokens.push({
      user_id: "u1",
      token: "upd-tok",
      kind: "board_update",
      activity_key: GRETA_KEY,
    });
    unfollowed.live_activity_sessions = [openSession()];
    const { send, sent } = sendSpy();
    const report = await syncBoardLiveActivities(
      fakeAdmin(unfollowed).admin,
      { id: "c1" },
      payloadWith(1),
      deps(send),
    );
    expect(report).toEqual({ followers: 0, started: 0, adopted: 0, updated: 0, ended: 1 });
    expect((sent[0].payload.aps as { event: string }).event).toBe("end");

    // No update token yet: a young session stays open (the app may still upload one)…
    const young = base();
    young.board_follows = [];
    young.live_activity_sessions = [openSession()];
    const fresh = fakeAdmin(young);
    expect(
      await syncBoardLiveActivities(fresh.admin, { id: "c1" }, payloadWith(1), deps(send)),
    ).toMatchObject({ ended: 0 });
    expect(fresh.sessions[0].ended_at).toBeNull();
    // …and an eight-hour-old one is given up on.
    const old = base();
    old.board_follows = [];
    old.live_activity_sessions = [
      { ...openSession(), started_at: new Date(NOW - 9 * 60 * 60 * 1000).toISOString() },
    ];
    const stale = fakeAdmin(old);
    expect(
      await syncBoardLiveActivities(stale.admin, { id: "c1" }, payloadWith(1), deps(send)),
    ).toMatchObject({ ended: 1 });
    expect(stale.sessions[0].ended_at).not.toBeNull();
  });

  it("prunes tokens APNs rejects as dead and skips cleanly with no config, no followers, or no payload", async () => {
    const { admin, deletes } = fakeAdmin(base());
    const { send } = sendSpy(() => ({
      ok: false,
      status: 410,
      reason: "Unregistered",
      dead: true,
    }));
    const report = await syncBoardLiveActivities(admin, { id: "c1" }, payloadWith(1), deps(send));
    expect(report.started).toBe(0);
    expect(
      deletes.some(
        (d) =>
          d.table === "live_activity_tokens" && (d.where.token as unknown[])?.includes("start-tok"),
      ),
    ).toBe(true);

    expect(
      (await syncBoardLiveActivities(admin, { id: "c1" }, payloadWith(1), { config: null, send }))
        .skipped,
    ).toBe("no_config");
    const lonely = base();
    lonely.board_follows = [];
    expect(
      (
        await syncBoardLiveActivities(
          fakeAdmin(lonely).admin,
          { id: "c1" },
          payloadWith(1),
          deps(send),
        )
      ).skipped,
    ).toBe("no_followers");
    expect((await syncBoardLiveActivities(admin, { id: "c1" }, null, deps(send))).skipped).toBe(
      "no_payload",
    );
  });

  it("survives a sender that throws", async () => {
    const { admin, sessions } = fakeAdmin(base());
    const send = async () => {
      throw new Error("boom");
    };
    const report = await syncBoardLiveActivities(admin, { id: "c1" }, payloadWith(1), deps(send));
    expect(report.started).toBe(0);
    expect(sessions).toHaveLength(0);
  });
});

describe("registerLiveActivityToken", () => {
  it("upserts on the token through the admin client and clears activity_key for start tokens", async () => {
    const store = fakeAdmin({ live_activity_tokens: [] });
    await registerLiveActivityToken(
      { userId: "u1", admin: store.admin },
      { token: "abcdefgh", kind: "board_start" },
    );
    await registerLiveActivityToken(
      { userId: "u1", admin: store.admin },
      { token: "ijklmnop", kind: "board_update", activityKey: GRETA_KEY },
    );
    await expect(
      registerLiveActivityToken(
        { userId: "u1", admin: store.admin },
        { token: "ijklmnop", kind: "board_update" },
      ),
    ).rejects.toThrow();
  });
});
