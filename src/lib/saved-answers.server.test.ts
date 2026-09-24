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
  let insertedPayload: unknown;
  const self: Record<string, unknown> = {};
  for (const m of ["select", "order"]) self[m] = () => self;
  self.insert = (payload: unknown) => {
    insertedPayload = payload;
    return self;
  };
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
    get insertedPayload() {
      return insertedPayload;
    },
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
    // A row saved before L5 (or from the web): no sources, unknown grounding.
    expect(result).toEqual([
      {
        id: "a1",
        sport: "hockey",
        question: "q",
        answer: "a",
        createdAt: "2026-01-01T00:00:00Z",
        sources: [],
        grounded: null,
        safety: false,
      },
    ]);
  });

  it("returns an empty array when there are no rows", async () => {
    const { client } = fakeClient({ list: [] });
    expect(await listSavedAnswers({ userId: "u1", supabase: client })).toEqual([]);
  });
});

describe("saveAnswer", () => {
  it("inserts scoped to the caller and returns the new id", async () => {
    const fake = fakeClient({ insertResult: { data: { id: "a1" }, error: null } });
    const result = await saveAnswer(
      { userId: "u1", supabase: fake.client },
      saveAnswerInput.parse({ sport: "hockey", question: "why?", answer: "because" }),
    );
    expect(result).toEqual({ id: "a1" });
    expect(fake.insertedPayload).toEqual({
      user_id: "u1",
      sport: "hockey",
      question: "why?",
      answer: "because",
    });
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

const source = {
  index: 1,
  title: "Rules of Golf",
  publisher: "USGA",
  edition: "2023",
  section: "Rule 13.1",
  page: 91,
  resourceId: "5b1f3c1e-8a0a-4a8e-9a55-0c1f5d1b2a3c",
  externalUrl: null,
};

describe("saved answers keep their sources (L5)", () => {
  it("saves the sources and flags when the client sends them", async () => {
    const fake = fakeClient({ insertResult: { data: { id: "a2" }, error: null } });
    await saveAnswer(
      { userId: "u1", supabase: fake.client },
      saveAnswerInput.parse({
        sport: "golf",
        question: "why?",
        answer: "because [1]",
        sources: [source],
        grounded: true,
        safety: false,
      }),
    );
    expect(fake.insertedPayload).toMatchObject({
      sources: [source],
      grounded: true,
      safety: false,
    });
  });

  it("reads them back, and ignores a malformed stored list", async () => {
    const { client } = fakeClient({
      list: [
        {
          id: "a",
          sport: "golf",
          question: "q",
          answer: "a",
          created_at: "t",
          sources: [source],
          grounded: true,
          safety: true,
        },
        {
          id: "b",
          sport: "golf",
          question: "q",
          answer: "a",
          created_at: "t",
          sources: [{ nope: 1 }],
          grounded: false,
          safety: false,
        },
      ],
    });
    const [a, b] = await listSavedAnswers({ userId: "u1", supabase: client });
    expect(a).toMatchObject({ sources: [source], grounded: true, safety: true });
    expect(b).toMatchObject({ sources: [], grounded: false, safety: false });
  });

  it("still saves, without the new columns, before the migration is applied", async () => {
    const payloads: unknown[] = [];
    let attempt = 0;
    const self: Record<string, unknown> = {};
    self.insert = (p: unknown) => (payloads.push(p), self);
    self.select = () => self;
    self.single = async () =>
      ++attempt === 1
        ? {
            data: null,
            error: {
              code: "PGRST204",
              message: "Could not find the 'grounded' column in the schema cache",
            },
          }
        : { data: { id: "a3" }, error: null };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = { from: () => self } as any;
    const result = await saveAnswer(
      { userId: "u1", supabase: client },
      saveAnswerInput.parse({ sport: "golf", question: "why?", answer: "a", sources: [source] }),
    );
    expect(result).toEqual({ id: "a3" });
    expect(payloads[1]).toEqual({ user_id: "u1", sport: "golf", question: "why?", answer: "a" });
  });
});
