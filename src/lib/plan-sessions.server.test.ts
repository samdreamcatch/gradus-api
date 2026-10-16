import { describe, expect, it } from "bun:test";
import { listPlanSessions, type SessionsContext } from "./plan-sessions.server";

/**
 * A chainable fake client: every query on `table` resolves to `rows[table]`.
 * `maybeSingle` resolves to the first row.
 */
function fakeClient(rows: Record<string, unknown[]>) {
  const chain = (table: string) => {
    const self: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "lt", "order", "limit"]) self[m] = () => self;
    self.maybeSingle = () => Promise.resolve({ data: rows[table]?.[0] ?? null, error: null });
    self.then = (resolve: (v: unknown) => void) =>
      resolve({ data: rows[table] ?? [], error: null });
    return self;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: (table: string) => chain(table) } as any;
}

describe("listPlanSessions", () => {
  it("gives the parent or athlete each move's rating in plan order", async () => {
    const supabase = fakeClient({
      plans: [{ id: "plan-1", athlete_id: "ath-1", athletes: { first_name: "Wren" } }],
      plan_sessions: [
        {
          id: "s-2",
          logged_at: "2026-10-15T17:00:00Z",
          duration_seconds: 1200,
          state_index: 2,
          note: "Loop felt shaky.",
          parent_id: "par-1",
          feedback_scope: "moves",
          plan_session_move_ratings: [
            { plan_move_id: "pm-2", move_name: "Loop jump", position: 1, state_index: 1 },
            { plan_move_id: "pm-1", move_name: "Waltz jump", position: 0, state_index: 4 },
          ],
        },
        {
          id: "s-1",
          logged_at: "2026-10-14T17:00:00Z",
          duration_seconds: 900,
          state_index: 3,
          note: "",
          parent_id: null,
          feedback_scope: "plan",
          plan_session_move_ratings: [],
        },
      ],
    });
    const admin = fakeClient({ parent_profiles: [{ id: "par-1", first_name: "Odette" }] });
    const ctx: SessionsContext = { userId: "par-user", supabase, admin };

    const log = await listPlanSessions(ctx, "plan-1");

    expect(log.sessions[0]).toMatchObject({
      feedbackScope: "moves",
      loggedByFirstName: "Odette",
      moveRatings: [
        { planMoveId: "pm-1", moveName: "Waltz jump", stateIndex: 4 },
        { planMoveId: "pm-2", moveName: "Loop jump", stateIndex: 1 },
      ],
    });
    expect(log.sessions[1]?.feedbackScope).toBe("plan");
    expect(log.sessions[1]?.moveRatings).toBeUndefined();
  });
});
