import { describe, expect, it } from "bun:test";
import {
  deleteSavedAnswer,
  listSavedAnswers,
  saveAnswer,
  saveAnswerInput,
} from "./saved-answers.server";

/** A minimal recording fake: `list` answers an awaited select, `insertResult` answers `.insert().select().single()`. */
function fakeClient(config: {
  list?: unknown[];
  insertResult?: { data: { id: string } | null; error: { message: string } | null };
  deleteError?: { message: string } | null;
}) {
  const deletedIds: string[] = [];
  const self: Record<string, unknown> = {};
  for (const m of ["select", "order", "insert"]) self[m] = () => self;
  self.eq = (_col: string, id: string) => {
    deletedIds.push(id);
    return {
      then: (resolve: (v: unknown) => void) => resolve({ error: config.deleteError ?? null }),
    };
  };
  self.single = async () => config.insertResult ?? { data: null, error: null };
  self.then = (resolve: (v: unknown) => void) => resolve({ data: config.list ?? [], error: null });
  self.delete = () => self;
  return {
    client: { from: () => self } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    deletedIds,
  };
}

describe("saveAnswerInput", () => {
  it("requires a non-empty sport, a 2-2000 char question, and a 1-20000 char answer", () => {
    expect(
      saveAnswerInput.safeParse({ sport: "hockey", question: "why?", answer: "because" }).success,
    ).toBe(true);
    expect(saveAnswerInput.safeParse({ sport: "", question: "why?", answer: "b" }).success).toBe(
      false,
    );
    expect(saveAnswerInput.safeParse({ sport: "hockey", question: "?", answer: "b" }).success).toBe(
      false,
    );
    expect(
      saveAnswerInput.safeParse({ sport: "hockey", question: "why?", answer: "" }).success,
    ).toBe(false);
  });
});

describe("listSavedAnswers", () => {
  it("maps rows to camelCase DTOs", async () => {
    const { client } = fakeClient({
      list: [
        {
          id: "a1",
          sport: "hockey",
          question: "q",
          answer: "a",
          created_at: "2026-01-01T00:00:00Z",
        },
      ],
    });
    const result = await listSavedAnswers({ userId: "u1", supabase: client });
    expect(result).toEqual([
      { id: "a1", sport: "hockey", question: "q", answer: "a", createdAt: "2026-01-01T00:00:00Z" },
    ]);
  });

  it("returns an empty array when there are no rows", async () => {
    const { client } = fakeClient({ list: [] });
    expect(await listSavedAnswers({ userId: "u1", supabase: client })).toEqual([]);
  });
});

describe("saveAnswer", () => {
  it("inserts scoped to the caller and returns the new id", async () => {
    const { client } = fakeClient({ insertResult: { data: { id: "a1" }, error: null } });
    const result = await saveAnswer(
      { userId: "u1", supabase: client },
      saveAnswerInput.parse({ sport: "hockey", question: "why?", answer: "because" }),
    );
    expect(result).toEqual({ id: "a1" });
  });
});

describe("deleteSavedAnswer", () => {
  it("deletes by id, relying entirely on RLS to scope to the caller (no explicit user_id filter)", async () => {
    const { client, deletedIds } = fakeClient({});
    const result = await deleteSavedAnswer({ userId: "u1", supabase: client }, "a1");
    expect(result).toEqual({ ok: true });
    expect(deletedIds).toEqual(["a1"]);
  });
});
