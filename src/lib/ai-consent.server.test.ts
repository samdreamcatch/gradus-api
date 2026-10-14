import { describe, expect, it } from "bun:test";
import { ApiError } from "./api/errors";
import {
  CURRENT_AI_CONSENT_VERSION,
  assertAiConsent,
  getAiConsent,
  setAiConsent,
  voiceTranscriptAllowed,
} from "./ai-consent.server";

type Row = { user_id: string; granted: boolean; version: string; decided_at: string };

/** Just the `ai_consents` calls the module makes. Test-only. */
function fakeAdmin(
  rows: Row[] = [],
  opts: { missingTable?: boolean; athletes?: { user_id: string; birthdate: string | null }[] } = {},
) {
  const missing = { code: "PGRST205", message: "missing" };
  return {
    rows,
    from: (table: string) => {
      if (table === "athletes") {
        return {
          select: () => ({
            eq: async (_c: string, id: string) => ({
              data: (opts.athletes ?? []).filter((a) => a.user_id === id),
              error: null,
            }),
          }),
        };
      }
      if (table !== "ai_consents") throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: (_c: string, id: string) => ({
            maybeSingle: async () =>
              opts.missingTable
                ? { data: null, error: missing }
                : { data: rows.find((r) => r.user_id === id) ?? null, error: null },
          }),
        }),
        upsert: async (row: Row) => {
          if (opts.missingTable) return { error: missing };
          const i = rows.findIndex((r) => r.user_id === row.user_id);
          if (i >= 0) rows[i] = row;
          else rows.push(row);
          return { error: null };
        },
      };
    },
  } as any;
}

describe("ai consent", () => {
  it("is unasked with no row, and after an answer for an older version", async () => {
    expect((await getAiConsent(fakeAdmin(), "u1")).state).toBe("unasked");
    const old = fakeAdmin([
      { user_id: "u1", granted: true, version: "2020-01-01", decided_at: "x" },
    ]);
    expect((await getAiConsent(old, "u1")).state).toBe("unasked");
  });

  it("records allow and decline for the current version", async () => {
    const admin = fakeAdmin();
    expect((await setAiConsent(admin, "u1", true)).state).toBe("granted");
    expect(admin.rows[0].version).toBe(CURRENT_AI_CONSENT_VERSION);
    expect((await getAiConsent(admin, "u1")).state).toBe("granted");
    await setAiConsent(admin, "u1", false);
    expect((await getAiConsent(admin, "u1")).state).toBe("declined");
    expect(admin.rows).toHaveLength(1);
  });

  it("refuses AI with 403 ai_consent_required unless granted", async () => {
    for (const admin of [
      fakeAdmin(),
      fakeAdmin([
        { user_id: "u1", granted: false, version: CURRENT_AI_CONSENT_VERSION, decided_at: "x" },
      ]),
    ]) {
      const err = await assertAiConsent(admin, "u1").catch((e) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect(err.code).toBe("ai_consent_required");
      expect(err.status).toBe(403);
    }
    const ok = fakeAdmin([
      { user_id: "u1", granted: true, version: CURRENT_AI_CONSENT_VERSION, decided_at: "x" },
    ]);
    await assertAiConsent(ok, "u1");
  });

  it("never lets an athlete under 18, or with no birthdate, allow or use AI", async () => {
    for (const birthdate of ["2015-05-01", null]) {
      const athletes = [{ user_id: "u1", birthdate }];
      const err = await setAiConsent(fakeAdmin([], { athletes }), "u1", true).catch((e) => e);
      expect(err.code).toBe("ai_unavailable_for_minors");
      const granted = fakeAdmin(
        [{ user_id: "u1", granted: true, version: CURRENT_AI_CONSENT_VERSION, decided_at: "x" }],
        { athletes },
      );
      expect((await assertAiConsent(granted, "u1").catch((e) => e)).code).toBe("ai_unavailable_for_minors");
    }
    // Declining is always allowed.
    const minor = fakeAdmin([], { athletes: [{ user_id: "u1", birthdate: "2015-05-01" }] });
    expect((await setAiConsent(minor, "u1", false)).state).toBe("declined");
  });

  it("stops voice transcripts only after Not now", async () => {
    expect(await voiceTranscriptAllowed(fakeAdmin(), "u1")).toBe(true);
    const declined = fakeAdmin([
      { user_id: "u1", granted: false, version: CURRENT_AI_CONSENT_VERSION, decided_at: "x" },
    ]);
    expect(await voiceTranscriptAllowed(declined, "u1")).toBe(false);
  });

  it("fails closed before the migration is applied", async () => {
    const admin = fakeAdmin([], { missingTable: true });
    expect((await getAiConsent(admin, "u1")).state).toBe("unasked");
    const err = await setAiConsent(admin, "u1", true).catch((e) => e);
    expect(err.status).toBe(503);
  });
});
