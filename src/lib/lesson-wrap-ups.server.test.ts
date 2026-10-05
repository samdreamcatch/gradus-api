import { describe, expect, it } from "bun:test";
import { ApiError } from "./api/errors";
import { recordLessonWrapUp } from "./lesson-wrap-ups.server";

type Write = { table: string; op: string; payload: unknown; options: unknown };

/**
 * A chainable fake: `rows[table]` answers `maybeSingle` (a missing key is `null`), `opts.writes`
 * records every upsert with its payload and options, and `opts.errors["table.op"]` makes that
 * write come back with the error.
 */
function fakeClient(
  rows: Record<string, unknown | null>,
  opts: { writes?: Write[]; errors?: Record<string, { code: string; message: string }> } = {},
) {
  const chain = (table: string) => {
    const self: Record<string, unknown> = {};
    let op: string | null = null;
    self.select = () => self;
    self.eq = () => self;
    self.upsert = (payload: unknown, options: unknown) => {
      op = "upsert";
      opts.writes?.push({ table, op, payload, options });
      return self;
    };
    self.maybeSingle = async () => ({ data: rows[table] ?? null, error: null });
    self.then = (resolve: (v: unknown) => void) =>
      resolve({ data: null, error: op ? (opts.errors?.[`${table}.${op}`] ?? null) : null });
    return self;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: (table: string) => chain(table) } as any;
}

async function caught(run: () => Promise<unknown>): Promise<ApiError | null> {
  try {
    await run();
    return null;
  } catch (err) {
    return err instanceof ApiError ? err : null;
  }
}

const coach = { coach_profiles: { id: "coach-1" } };
/** The coach has athlete `a1` on their roster; any other athlete id reads as not rostered. */
const roster = { coach_athletes: { athlete_id: "a1" } };
const wrapUp = (athleteId: string) => ({
  athleteId,
  lessonDate: "2026-10-05",
  action: "dismissed" as const,
});

describe("recordLessonWrapUp stays on the coach's roster", () => {
  it("an athlete not on the roster is 403 and writes nothing", async () => {
    const writes: Write[] = [];
    const supabase = fakeClient({ ...coach }, { writes });
    const err = await caught(() =>
      recordLessonWrapUp({ userId: "u", supabase }, wrapUp("a-stranger")),
    );
    expect(err?.status).toBe(403);
    expect(err?.code).toBe("forbidden");
    expect(err?.message).toBe("Athlete is not on your roster");
    expect(writes).toEqual([]);
  });

  it("an athlete on the roster gets the upsert, keyed on (coach, athlete, date)", async () => {
    const writes: Write[] = [];
    const supabase = fakeClient({ ...coach, ...roster }, { writes });
    await expect(recordLessonWrapUp({ userId: "u", supabase }, wrapUp("a1"))).resolves.toEqual({
      ok: true,
    });
    expect(writes).toEqual([
      {
        table: "lesson_wrap_ups",
        op: "upsert",
        payload: {
          coach_id: "coach-1",
          athlete_id: "a1",
          lesson_date: "2026-10-05",
          action: "dismissed",
        },
        options: { onConflict: "coach_id,athlete_id,lesson_date" },
      },
    ]);
  });

  it("the database's refusal (the roster policy, if it ever disagrees) is the same 403", async () => {
    const supabase = fakeClient(
      { ...coach, ...roster },
      {
        errors: {
          "lesson_wrap_ups.upsert": {
            code: "42501",
            message: 'new row violates row-level security policy for table "lesson_wrap_ups"',
          },
        },
      },
    );
    const err = await caught(() => recordLessonWrapUp({ userId: "u", supabase }, wrapUp("a1")));
    expect(err?.status).toBe(403);
    expect(err?.message).toBe("Athlete is not on your roster");
  });

  it("any other database error stays a generic failure, not a roster answer", async () => {
    const supabase = fakeClient(
      { ...coach, ...roster },
      { errors: { "lesson_wrap_ups.upsert": { code: "XX000", message: "boom" } } },
    );
    const original = console.error;
    console.error = () => {};
    try {
      await expect(recordLessonWrapUp({ userId: "u", supabase }, wrapUp("a1"))).rejects.toThrow(
        "Something went wrong. Please try again.",
      );
    } finally {
      console.error = original;
    }
  });

  it("a caller who is not a coach is 403 wrong_role, before any roster lookup", async () => {
    const writes: Write[] = [];
    const supabase = fakeClient({}, { writes });
    const err = await caught(() => recordLessonWrapUp({ userId: "u", supabase }, wrapUp("a1")));
    expect(err?.status).toBe(403);
    expect(err?.code).toBe("wrong_role");
    expect(writes).toEqual([]);
  });
});
