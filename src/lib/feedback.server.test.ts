import { describe, expect, it } from "bun:test";
import { detectRole, feedbackInput, submitFeedback } from "./feedback.server";

/**
 * A chainable fake: `counts[table]` answers awaited head/count selects and
 * `inserts` records every inserted row by table.
 */
function fakeAdmin(counts: Record<string, number>) {
  const inserts: { table: string; row: Record<string, unknown> }[] = [];
  const chain = (table: string) => {
    const self: Record<string, unknown> = {};
    for (const m of ["select", "eq"]) self[m] = () => self;
    self.insert = (row: Record<string, unknown>) => {
      inserts.push({ table, row });
      return self;
    };
    self.then = (resolve: (v: unknown) => void) =>
      resolve({ data: null, count: counts[table] ?? 0, error: null });
    return self;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { admin: { from: (table: string) => chain(table) } as any, inserts };
}

describe("detectRole", () => {
  it("prefers coach over parent over athlete over admin", async () => {
    const all = { coach_profiles: 1, parent_profiles: 1, athletes: 1, user_roles: 1 };
    expect(await detectRole(fakeAdmin(all).admin, "u")).toBe("coach");
    expect(await detectRole(fakeAdmin({ ...all, coach_profiles: 0 }).admin, "u")).toBe("parent");
    expect(
      await detectRole(fakeAdmin({ ...all, coach_profiles: 0, parent_profiles: 0 }).admin, "u"),
    ).toBe("athlete");
    expect(await detectRole(fakeAdmin({ user_roles: 1 }).admin, "u")).toBe("admin");
  });

  it("is unknown when the caller has no profile or role", async () => {
    expect(await detectRole(fakeAdmin({}).admin, "u")).toBe("unknown");
  });
});

describe("submitFeedback", () => {
  it("inserts the message with the detected role and nulls for absent context", async () => {
    const fake = fakeAdmin({ parent_profiles: 1 });
    const result = await submitFeedback(
      { userId: "u", admin: fake.admin },
      feedbackInput.parse({ message: "  Love it  " }),
    );
    expect(result).toEqual({ ok: true });
    expect(fake.inserts).toEqual([
      {
        table: "feedback",
        row: {
          user_id: "u",
          role: "parent",
          message: "Love it",
          path: null,
          user_agent: null,
          viewport: null,
        },
      },
    ]);
  });

  it("keeps path, userAgent, and viewport when given", async () => {
    const fake = fakeAdmin({ coach_profiles: 1 });
    await submitFeedback(
      { userId: "u", admin: fake.admin },
      feedbackInput.parse({ message: "m", path: "/coach", userAgent: "ua", viewport: "390x844" }),
    );
    expect(fake.inserts[0]?.row).toMatchObject({
      role: "coach",
      path: "/coach",
      user_agent: "ua",
      viewport: "390x844",
    });
  });
});

describe("feedbackInput", () => {
  it("trims the message and enforces 1..2000 characters", () => {
    expect(feedbackInput.safeParse({ message: "   " }).success).toBe(false);
    expect(feedbackInput.safeParse({ message: "x".repeat(2000) }).success).toBe(true);
    expect(feedbackInput.safeParse({ message: "x".repeat(2001) }).success).toBe(false);
  });

  it("caps path/userAgent at 500 and viewport at 32, and accepts null for each", () => {
    expect(feedbackInput.safeParse({ message: "m", path: "p".repeat(501) }).success).toBe(false);
    expect(feedbackInput.safeParse({ message: "m", userAgent: "u".repeat(501) }).success).toBe(
      false,
    );
    expect(feedbackInput.safeParse({ message: "m", viewport: "v".repeat(33) }).success).toBe(false);
    expect(
      feedbackInput.safeParse({ message: "m", path: null, userAgent: null, viewport: null })
        .success,
    ).toBe(true);
  });
});
