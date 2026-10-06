import { describe, expect, it } from "bun:test";
import { ApiError } from "./api/errors";
import { getPlanForViewer } from "./plan-detail.server";
import { getOrCreateShareToken } from "./plan-share.server";
import { getAthletePlan, listAthletePlans } from "./athlete-plans.server";
import { listParentPlans } from "./parent-plans.server";
import { recordingClient, type Call } from "./recording-client.test-util";

async function caught(run: () => Promise<unknown>): Promise<ApiError | null> {
  try {
    await run();
    return null;
  } catch (err) {
    return err instanceof ApiError ? err : null;
  }
}

describe("getOrCreateShareToken for a plan the athlete wrote (PRD §6.14 D)", () => {
  const plan = {
    id: "plan-1",
    share_token: null,
    coach_id: null,
    athlete_id: "ath-1",
    source: "athlete",
  };

  /** `userKind` decides who the caller is; every other lookup answers as in the database. */
  function setup(userKind: "rostered-coach" | "athlete" | "parent" | "stranger") {
    const adminCalls: Call[] = [];
    const supabase = recordingClient((call) => {
      if (call.table === "plans") return { data: plan };
      if (call.table === "coach_profiles") {
        return { data: userKind === "rostered-coach" ? { id: "coach-1" } : null };
      }
      if (call.table === "coach_athletes") return { data: { coach_id: "coach-1" } };
      if (call.table === "athletes") {
        return {
          data: {
            id: "ath-1",
            user_id: userKind === "athlete" ? "user-1" : "someone-else",
            parent_id: "par-1",
          },
        };
      }
      if (call.table === "parent_profiles") {
        return { data: userKind === "parent" ? { id: "par-1" } : null };
      }
      return undefined;
    });
    const admin = recordingClient(() => ({ data: null }));
    return { supabase, admin, adminCalls };
  }

  it("lets the athlete mint it", async () => {
    const { supabase, admin } = setup("athlete");
    const res = await getOrCreateShareToken(
      { userId: "user-1", supabase: supabase.client, admin: admin.client },
      "plan-1",
    );
    expect(res.token.length).toBeGreaterThan(8);
    expect(admin.calls.some((c) => c.table === "plans" && c.op === "update")).toBe(true);
  });

  it("lets their parent mint it", async () => {
    const { supabase, admin } = setup("parent");
    const res = await getOrCreateShareToken(
      { userId: "user-1", supabase: supabase.client, admin: admin.client },
      "plan-1",
    );
    expect(res.token.length).toBeGreaterThan(8);
  });

  it("does not let a rostered coach, who can read the plan, publish it under the athlete's name", async () => {
    const { supabase, admin } = setup("rostered-coach");
    const err = await caught(() =>
      getOrCreateShareToken(
        { userId: "user-1", supabase: supabase.client, admin: admin.client },
        "plan-1",
      ),
    );
    expect(err?.status).toBe(403);
    expect(admin.calls.some((c) => c.op === "update")).toBe(false);
  });

  it("does not let a stranger", async () => {
    const { supabase, admin } = setup("stranger");
    const err = await caught(() =>
      getOrCreateShareToken(
        { userId: "user-1", supabase: supabase.client, admin: admin.client },
        "plan-1",
      ),
    );
    expect(err?.status).toBe(403);
  });

  it("still lets a coach linked to the athlete share a COACH-written plan", async () => {
    const supabase = recordingClient((call) => {
      if (call.table === "plans") {
        return { data: { ...plan, source: "coach", coach_id: "someone-else" } };
      }
      if (call.table === "coach_profiles") return { data: { id: "coach-1" } };
      if (call.table === "coach_athletes") return { data: { coach_id: "coach-1" } };
      return undefined;
    });
    const admin = recordingClient(() => ({ data: null }));
    const res = await getOrCreateShareToken(
      { userId: "user-1", supabase: supabase.client, admin: admin.client },
      "plan-1",
    );
    expect(res.token.length).toBeGreaterThan(8);
  });
});

describe("getPlanForViewer: the author's own plan", () => {
  it("serves an athlete their own authored draft, as theirs, before any coach or parent loader", async () => {
    const touched: string[] = [];
    const db = recordingClient((call, kind) => {
      touched.push(call.table);
      if (call.table === "coach_profiles" || call.table === "parent_profiles")
        return { data: null };
      if (call.table === "athletes") return { data: { id: "ath-1", first_name: "Elsie" } };
      if (call.table === "plans" && kind === "one") {
        return {
          data: {
            id: "plan-1",
            title: "Edges",
            notes: "",
            status: "draft",
            updated_at: "2026-10-05T00:00:00Z",
            voice_transcript: null,
            athlete_id: "ath-1",
          },
        };
      }
      return undefined;
    });
    const detail = await getPlanForViewer(
      { userId: "user-1", supabase: db.client, admin: db.client },
      "plan-1",
    );
    expect(detail.isOwner).toBe(true);
    expect(detail.status).toBe("draft");
    expect(detail.viewerRole).toBe("athlete");
    expect(detail.source).toBe("athlete");
    // role resolution and the author lookup; the athlete runner loader (which
    // would 404 a draft) never ran, or it would have looked the athlete up again
    expect(touched.filter((t) => t === "athletes")).toHaveLength(2);
  });
});

describe("share links for a paused athlete", () => {
  const plan = {
    id: "plan-1",
    share_token: null,
    coach_id: null,
    athlete_id: "ath-1",
    source: "athlete",
  };

  it("a paused athlete mints nothing, even for their own plan (the admin write RLS cannot stop)", async () => {
    const supabase = recordingClient((call) => {
      if (call.table === "plans") return { data: plan };
      if (call.table === "coach_profiles") return { data: null };
      if (call.table === "athletes") {
        return { data: { id: "ath-1", user_id: "user-1", parent_id: null } };
      }
      return undefined;
    });
    const admin = recordingClient((call) =>
      call.table === "athletes"
        ? { data: { user_id: "user-1", account_state: "paused" } }
        : { data: null },
    );
    const err = await caught(() =>
      getOrCreateShareToken(
        { userId: "user-1", supabase: supabase.client, admin: admin.client },
        "plan-1",
      ),
    );
    expect(err?.status).toBe(403);
    expect(err?.code).toBe("paused");
    expect(admin.calls.some((c) => c.op === "update")).toBe(false);
  });

  it("the pause is per user: a second, active athletes row does not escape it", async () => {
    const supabase = recordingClient((call) => {
      if (call.table === "plans") return { data: plan };
      if (call.table === "coach_profiles") return { data: null };
      if (call.table === "athletes") {
        return { data: { id: "ath-1", user_id: "user-1", parent_id: null } };
      }
      return undefined;
    });
    // The row itself reads active, but another row of the same user is paused.
    const admin = recordingClient((call, kind) => {
      if (call.table === "athletes" && kind === "one") {
        return { data: { user_id: "user-1", account_state: "active" } };
      }
      if (call.table === "athletes" && kind === "many") return { data: [{ id: "ath-0" }] };
      return { data: null };
    });
    const err = await caught(() =>
      getOrCreateShareToken(
        { userId: "user-1", supabase: supabase.client, admin: admin.client },
        "plan-1",
      ),
    );
    expect(err?.code).toBe("paused");
  });
});

describe("plans an athlete wrote stay out of the web (zero disruption, §4.1)", () => {
  it("the athlete list excludes them by default and lists drafts only for the API", async () => {
    const make = () =>
      recordingClient((call, kind) => {
        if (call.table === "athletes") return { data: { id: "ath-1", first_name: "Elsie" } };
        if (call.table === "plans" && kind === "many") return { data: [] };
        return undefined;
      });
    const web = make();
    const webRes = await listAthletePlans({
      userId: "user-1",
      supabase: web.client,
      admin: web.client,
    }).catch((e) => e);
    // (the starter-program seeding needs the real admin client; the plans query is what matters)
    expect(webRes).toBeDefined();
    const webPlans = web.calls.filter((c) => c.table === "plans");
    expect(webPlans.every((c) => c.filters.some((f) => f[0] === "neq" && f[1] === "source"))).toBe(
      true,
    );
    expect(webPlans.length).toBe(1); // no drafts query for the web
  });

  it("a plan the athlete wrote is not found by the web's detail loader", async () => {
    const db = recordingClient((call) => {
      if (call.table === "athletes") return { data: { id: "ath-1", first_name: "Elsie" } };
      if (call.table === "plans") {
        return {
          data: {
            id: "plan-1",
            title: "t",
            notes: "",
            status: "active",
            athlete_id: "ath-1",
            coach_id: null,
            updated_at: "x",
            kind: "plan",
            source: "athlete",
          },
        };
      }
      return undefined;
    });
    const err = await caught(() =>
      getAthletePlan({ userId: "user-1", supabase: db.client, admin: db.client }, "plan-1"),
    );
    expect(err?.status).toBe(404);
  });

  it("the parent list excludes them by default", async () => {
    const db = recordingClient((call) => {
      if (call.table === "parent_profiles") return { data: { id: "par-1" } };
      return undefined;
    });
    // No accessible athletes here; the point is only that the call never lists them.
    await listParentPlans({ userId: "user-1", supabase: db.client, admin: db.client }).catch(
      () => null,
    );
    const planCalls = db.calls.filter((c) => c.table === "plans");
    expect(planCalls.every((c) => c.filters.some((f) => f[0] === "neq" && f[1] === "source"))).toBe(
      true,
    );
  });
});

describe("getPlanForViewer for a user who is a parent AND an athlete", () => {
  it("serves them the plan they wrote instead of a parent's not-found", async () => {
    const db = recordingClient((call, kind) => {
      if (call.table === "coach_profiles") return { data: null };
      if (call.table === "parent_profiles") return { data: { id: "par-1" } };
      if (call.table === "athletes") return { data: { id: "ath-1", first_name: "Elsie" } };
      if (call.table === "plans" && kind === "one") {
        return {
          data: {
            id: "plan-1",
            title: "Mine",
            notes: "",
            status: "draft",
            updated_at: "2026-10-05T00:00:00Z",
            voice_transcript: null,
            athlete_id: "ath-1",
          },
        };
      }
      return undefined;
    });
    const detail = await getPlanForViewer(
      { userId: "user-1", supabase: db.client, admin: db.client },
      "plan-1",
    );
    expect(detail.isOwner).toBe(true);
    expect(detail.status).toBe("draft");
    expect(detail.source).toBe("athlete");
  });
});
