import { describe, expect, it } from "bun:test";
import {
  listSportRequests,
  requestSport,
  sportRequestEmail,
  sportRequestInput,
  type SportRequestEmail,
} from "./sport-requests.server";
import { sportDisplayLabel } from "./coach-sports";

function fakeDb(opts: { insertError?: unknown; selectError?: unknown; rows?: unknown[] } = {}) {
  const inserts: Array<Record<string, unknown>> = [];
  const db = {
    from: (table: string) => ({
      insert: async (row: Record<string, unknown>) => {
        inserts.push({ table, ...row });
        return { error: opts.insertError ?? null };
      },
      select: () => ({
        order: () => ({
          limit: async () => ({ data: opts.rows ?? [], error: opts.selectError ?? null }),
        }),
      }),
    }),
  };
  return { db, inserts };
}

describe("requestSport", () => {
  it("stores the request with the caller's role and emails the team", async () => {
    const { db, inserts } = fakeDb();
    const sent: SportRequestEmail[] = [];
    const result = await requestSport(
      {
        userId: "user-1",
        email: "coach@example.com",
        admin: db,
        role: async () => "coach",
        notify: async (m) => {
          sent.push(m);
        },
      },
      sportRequestInput.parse({ sport: "  Pickleball ", source: "coach_onboarding" }),
    );
    expect(result).toEqual({ ok: true });
    expect(inserts).toEqual([
      {
        table: "sport_requests",
        user_id: "user-1",
        role: "coach",
        requested_sport: "Pickleball",
        source: "coach_onboarding",
      },
    ]);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("support@gradussports.com");
    expect(sent[0].subject).toBe("Sport request: Pickleball");
    expect(sent[0].text).toContain(
      'A coach (coach@example.com) asked Gradus to add "Pickleball" from coach onboarding.',
    );
  });

  it("a failed email never fails the request", async () => {
    const { db, inserts } = fakeDb();
    const result = await requestSport(
      {
        userId: "user-1",
        email: null,
        admin: db,
        role: async () => "coach",
        notify: async () => {
          throw new Error("queue down");
        },
      },
      { sport: "Pickleball", source: "coach_settings" },
    );
    expect(result).toEqual({ ok: true });
    expect(inserts).toHaveLength(1);
  });

  it("collapses control characters and line breaks before storing or emailing", async () => {
    const { db, inserts } = fakeDb();
    const sent: SportRequestEmail[] = [];
    await requestSport(
      {
        userId: "user-1",
        email: null,
        admin: db,
        role: async () => "coach",
        notify: async (m) => {
          sent.push(m);
        },
      },
      sportRequestInput.parse({
        sport: "Polo\r\nBcc: x@example.invalid\t ",
        source: "coach_settings",
      }),
    );
    expect(inserts[0].requested_sport).toBe("Polo Bcc: x@example.invalid");
    expect(sent[0].subject).toBe("Sport request: Polo Bcc: x@example.invalid");
  });

  it("rejects a name that is only control characters", async () => {
    const { db, inserts } = fakeDb();
    await expect(
      requestSport(
        {
          userId: "user-1",
          email: null,
          admin: db,
          role: async () => "coach",
          notify: async () => {},
        },
        sportRequestInput.parse({ sport: "\u0007\u0008", source: "coach_settings" }),
      ),
    ).rejects.toMatchObject({ code: "validation_failed", status: 400 });
    expect(inserts).toHaveLength(0);
  });

  it("refuses athletes and parents (only coaches see the picker)", async () => {
    for (const role of ["athlete", "parent"]) {
      const { db, inserts } = fakeDb();
      const sent: SportRequestEmail[] = [];
      await expect(
        requestSport(
          {
            userId: "user-1",
            email: null,
            admin: db,
            role: async () => role,
            notify: async (m) => {
              sent.push(m);
            },
          },
          sportRequestInput.parse({ sport: "Pickleball", source: "coach_settings" }),
        ),
      ).rejects.toMatchObject({ code: "wrong_role", status: 403 });
      expect(inserts).toHaveLength(0);
      expect(sent).toHaveLength(0);
    }
  });

  it("rejects an empty or overlong name", () => {
    expect(sportRequestInput.safeParse({ sport: "   ", source: "coach_signup" }).success).toBe(
      false,
    );
    expect(
      sportRequestInput.safeParse({ sport: "x".repeat(81), source: "coach_signup" }).success,
    ).toBe(false);
    expect(sportRequestInput.safeParse({ sport: "Polo", source: "athlete" }).success).toBe(false);
  });
});

describe("sportRequestEmail", () => {
  it("uses the right article for each role", () => {
    const base = { sport: "Polo", email: null, source: "coach_settings" as const };
    expect(sportRequestEmail({ ...base, role: "admin" }).text).toMatch(/^An admin asked/);
    expect(sportRequestEmail({ ...base, role: "coach" }).text).toMatch(/^A coach asked/);
    expect(sportRequestEmail({ ...base, role: "unknown" }).text).toMatch(/^A user asked/);
  });

  it("escapes what the coach typed in the HTML part", () => {
    const m = sportRequestEmail({
      sport: "<b>Polo</b>",
      role: "unknown",
      email: null,
      source: "coach_signup",
    });
    expect(m.html).not.toContain("<b>Polo</b>");
    expect(m.text).toContain('A user asked Gradus to add "<b>Polo</b>" from coach sign-up.');
  });
});

describe("listSportRequests", () => {
  it("reads as empty until the migration is applied", async () => {
    const { db } = fakeDb({
      selectError: { code: "PGRST205", message: "Could not find the table" },
    });
    expect(await listSportRequests(db)).toEqual([]);
  });

  it("maps rows newest first as stored", async () => {
    const { db } = fakeDb({
      rows: [
        {
          id: "r1",
          requested_sport: "Pickleball",
          role: "coach",
          source: "coach_onboarding",
          created_at: "2026-10-08T12:00:00Z",
          resolved_at: null,
        },
      ],
    });
    expect(await listSportRequests(db)).toEqual([
      {
        id: "r1",
        sport: "Pickleball",
        role: "coach",
        source: "coach_onboarding",
        createdAt: "2026-10-08T12:00:00Z",
        resolvedAt: null,
      },
    ]);
  });
});

describe("sportDisplayLabel", () => {
  it("reads a catalog sport by its label", () => {
    expect(sportDisplayLabel("figure_skating")).toBe("Figure Skating");
  });

  it("never shows a custom key's prefix or random suffix", () => {
    expect(sportDisplayLabel("custom_new_sport_c715f")).toBe("New Sport");
    expect(sportDisplayLabel("custom_beatboxing_a1b2c")).toBe("Beatboxing");
  });

  it("leaves other unknown keys alone", () => {
    expect(sportDisplayLabel("legacy_key")).toBe("legacy_key");
  });
});
