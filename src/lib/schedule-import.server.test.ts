import { describe, expect, it } from "bun:test";
import type { ApiContext } from "./api/auth";
import { createApiRouteHandler } from "./api/define-route";
import { ApiError } from "./api/errors";
import {
  commitScheduleImportResultSchema,
  parseScheduleImageInput,
  parseScheduleResultSchema,
} from "./api/schedule-import-schema";
import { parseLengthToMinutes } from "./schedule-import";
import {
  commitScheduleImport,
  commitScheduleImportInput,
  imageBytesFromDataUrl,
  lessonsFromModelText,
  MAX_IMAGE_BYTES,
  normalizeParsedLessons,
  parseScheduleImageBytes,
  parseScheduleImageUpload,
  type CommitScheduleImportDeps,
  type ParsedLesson,
  type ScheduleImageGenerate,
} from "./schedule-import.server";

/* -------------------------------------------------------------------------- */
/* Same small, stateful, in-memory Supabase-shaped fake as                    */
/* competition-recap.server.test.ts, plus an insert-error injector so a test  */
/* can stand in for the roster-cap trigger or a failed link.                  */
/* -------------------------------------------------------------------------- */

type Row = Record<string, any>;
type Admin = Parameters<typeof commitScheduleImport>[0]["admin"];

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `row_${idCounter}`;
}

type InsertError = { message: string; code?: string };

/**
 * `insertErrors[table]` makes `.insert()` on that table answer the given
 * Postgres-shaped error without writing (each entry is consumed once, in
 * order, so "first link fails, second succeeds" is expressible).
 * `selectErrors[table]` does the same for reads.
 */
function fakeAdmin(
  seed: Record<string, Row[]>,
  opts: {
    insertErrors?: Record<string, InsertError[]>;
    selectErrors?: Record<string, InsertError>;
  } = {},
) {
  const tables: Record<string, Row[]> = {};
  for (const [k, v] of Object.entries(seed)) tables[k] = v.map((r) => ({ ...r }));
  const inserted: Record<string, Row[]> = {};
  const deleted: Record<string, Row[]> = {};
  const insertErrors: Record<string, InsertError[]> = {};
  for (const [k, v] of Object.entries(opts.insertErrors ?? {})) insertErrors[k] = [...v];

  function builder(
    table: string,
    filters: Array<(r: Row) => boolean>,
    mode: "select" | "insert" | "update" | "delete",
    payload: Row | Row[] | null,
  ): any {
    function run(): { data: Row[]; error: InsertError | null } {
      tables[table] ??= [];
      if (mode === "insert") {
        const pending = insertErrors[table]?.shift();
        if (pending) return { data: [], error: pending };
        const arr = (Array.isArray(payload) ? payload : [payload!]).map((r) => ({
          id: nextId(),
          ...r,
        }));
        tables[table].push(...arr);
        (inserted[table] ??= []).push(...arr);
        return { data: arr, error: null };
      }
      if (mode === "update") {
        const rows = tables[table].filter((r) => filters.every((f) => f(r)));
        for (const r of rows) Object.assign(r, payload);
        return { data: rows, error: null };
      }
      if (mode === "delete") {
        const rows = tables[table].filter((r) => filters.every((f) => f(r)));
        tables[table] = tables[table].filter((r) => !filters.every((f) => f(r)));
        (deleted[table] ??= []).push(...rows);
        return { data: rows, error: null };
      }
      const selectError = opts.selectErrors?.[table];
      if (selectError) return { data: [], error: selectError };
      return { data: tables[table].filter((r) => filters.every((f) => f(r))), error: null };
    }

    const api: any = {
      select: () => api,
      eq: (c: string, v: unknown) => builder(table, [...filters, (r) => r[c] === v], mode, payload),
      in: (c: string, vs: unknown[]) =>
        builder(table, [...filters, (r) => vs.includes(r[c])], mode, payload),
      insert: (row: Row | Row[]) => builder(table, filters, "insert", row),
      // Upserts are only ever first writes in these flows; the fake treats them as inserts.
      upsert: (row: Row | Row[]) => builder(table, filters, "insert", row),
      order: () => api,
      update: (patch: Row) => builder(table, filters, "update", patch),
      delete: () => builder(table, filters, "delete", null),
      maybeSingle: async () => {
        const { data, error } = run();
        return { data: data[0] ?? null, error };
      },
      single: async () => {
        const { data, error } = run();
        return { data: data[0] ?? null, error };
      },
      then: (
        resolve: (v: { data: Row[]; error: InsertError | null }) => unknown,
        reject?: unknown,
      ) => Promise.resolve(run()).then(resolve, reject as never),
    };
    return api;
  }

  return {
    admin: { from: (table: string) => builder(table, [], "select", null) } as unknown as Admin,
    inserted,
    deleted,
    tables,
  };
}

async function caught(run: () => Promise<unknown>): Promise<ApiError | null> {
  try {
    await run();
    return null;
  } catch (err) {
    return err instanceof ApiError ? err : null;
  }
}

/* ---------------------------------------------------------------- fixtures */

const USER = "coach-user";
const COACH = {
  id: "coach-1",
  user_id: USER,
  first_name: "Sam",
  last_name: "Ortiz",
  organization_id: null,
  subscription_tier: null,
};
const MINTED = "f".repeat(48);
const NOW = new Date("2026-09-11T12:00:00.000Z");

type SentInvite = Parameters<NonNullable<CommitScheduleImportDeps["sendGuardianInvite"]>>[0];

function commitDeps(): { deps: CommitScheduleImportDeps; sent: SentInvite[] } {
  const sent: SentInvite[] = [];
  return {
    sent,
    deps: {
      newGuardianToken: () => MINTED,
      sendGuardianInvite: async (p) => {
        sent.push(p);
      },
      now: () => NOW,
    },
  };
}

const slot = (
  over: Partial<{
    dayOfWeek: number;
    startMinute: number;
    endMinute: number;
    frequency: "weekly" | "biweekly" | "twice_monthly" | "monthly";
  }> = {},
) => ({
  dayOfWeek: 2,
  startMinute: 960,
  endMinute: 1020,
  frequency: "weekly" as const,
  ...over,
});

function group(over: Partial<Record<string, unknown>> = {}) {
  return commitScheduleImportInput.parse({
    groups: [
      {
        key: "leo|lee|parent@example.com",
        firstName: "Leo",
        lastName: "Lee",
        guardianEmail: "Parent@Example.com",
        sport: "figure_skating",
        slots: [slot()],
        ...over,
      },
    ],
  }).groups[0];
}

const lesson = (over: Partial<ParsedLesson> = {}): ParsedLesson => ({
  firstName: "Leo",
  lastName: "Lee",
  day: "Tuesday",
  startTime: "4:00 PM",
  lengthMinutes: 45,
  frequency: "weekly",
  guardianEmail: null,
  athleteEmail: null,
  ...over,
});

const rosterFullMessage =
  "Roster full: the coach plan is limited to 5 athletes. Upgrade to add more.";

/* ------------------------------------------------------- model text → rows */

describe("lessonsFromModelText", () => {
  it("strips fences and reads a bare array", () => {
    const out = lessonsFromModelText(
      '```json\n[{"firstName":"Leo","lastName":"Lee","day":"Tue","startTime":"4pm","lengthMinutes":45,"frequency":"weekly","guardianEmail":null,"athleteEmail":null}]\n```',
    );
    expect(out).toEqual([lesson({ day: "Tue", startTime: "4pm" })]);
  });

  it("accepts a { lessons } or { elements } wrapper object", () => {
    const wrapped = lessonsFromModelText('{"lessons":[{"firstName":"Leo","lastName":"Lee"}]}');
    expect(wrapped).toEqual([
      lesson({ day: "", startTime: "", lengthMinutes: null, frequency: "" }),
    ]);
    const elements = lessonsFromModelText('{"elements":[{"name":"Mia Chen"}]}');
    expect(elements).toEqual([
      lesson({
        firstName: "Mia",
        lastName: "Chen",
        day: "",
        startTime: "",
        lengthMinutes: null,
        frequency: "",
      }),
    ]);
  });

  it("maps snake_case aliases, splits a full name, and treats a plain email as the guardian's", () => {
    const out = lessonsFromModelText(
      JSON.stringify([
        {
          athlete_name: "Mia Rose Chen",
          day_of_week: "Wed",
          start_time: "16:00",
          length_minutes: "60",
          repeats: "every other week",
          email: " Mom@Example.com ",
        },
      ]),
    );
    expect(out).toEqual([
      {
        firstName: "Mia",
        lastName: "Rose Chen",
        day: "Wed",
        startTime: "16:00",
        lengthMinutes: 60,
        frequency: "every other week",
        guardianEmail: "Mom@Example.com",
        athleteEmail: null,
      },
    ]);
  });

  it("drops rows without a name and elements that aren't objects; a non-array object is empty", () => {
    expect(lessonsFromModelText('[{"day":"Mon"}, 7, "x", {"firstName":"Leo"}]')).toEqual([
      lesson({ lastName: "", day: "", startTime: "", lengthMinutes: null, frequency: "" }),
    ]);
    expect(lessonsFromModelText('{"foo":1}')).toEqual([]);
    expect(lessonsFromModelText("[]")).toEqual([]);
  });

  it("is a 422 when there is no JSON to parse", () => {
    expect(() => lessonsFromModelText("Sorry, I can't read this.")).toThrow(
      "Couldn't read that photo. Try a clearer picture, or enter rows manually.",
    );
    try {
      lessonsFromModelText("nope");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect(err).toMatchObject({ code: "unprocessable", status: 422 });
    }
  });
});

/* ------------------------------------------------------------- normalizer */

describe("normalizeParsedLessons", () => {
  it("reads '4pm', '16:00' and '1600' as 960 and 'Tues.' as Tuesday", () => {
    const out = normalizeParsedLessons([
      lesson({ day: "Tues.", startTime: "4pm" }),
      lesson({ day: "tuesday", startTime: "16:00" }),
      lesson({ day: "2", startTime: "1600" }),
    ]);
    expect(out.map((l) => [l.dayOfWeek, l.startMinute])).toEqual([
      [2, 960],
      [2, 960],
      [2, 960],
    ]);
    expect(out[0]).toEqual({
      firstName: "Leo",
      lastName: "Lee",
      dayOfWeek: 2,
      startMinute: 960,
      lengthMinutes: 45,
      frequency: "weekly",
      guardianEmail: null,
      athleteEmail: null,
      rawDay: "Tues.",
      rawStartTime: "4pm",
      dayUnreadable: false,
      startTimeUnreadable: false,
    });
  });

  it("maps frequencies: 'every other week' → biweekly, 'twice a month' → twice_monthly, 'Monthly' → monthly, unknown → weekly", () => {
    const out = normalizeParsedLessons([
      lesson({ frequency: "every other week" }),
      lesson({ frequency: "twice a month" }),
      lesson({ frequency: "Monthly" }),
      lesson({ frequency: "whenever" }),
      lesson({ frequency: "" }),
    ]);
    expect(out.map((l) => l.frequency)).toEqual([
      "biweekly",
      "twice_monthly",
      "monthly",
      "weekly",
      "weekly",
    ]);
  });

  it("never invents a day or time: written-but-unreadable stays null and is flagged; absent is null and unflagged", () => {
    const out = normalizeParsedLessons([
      lesson({ day: "Someday", startTime: "late" }),
      lesson({ day: "", startTime: "  " }),
    ]);
    expect(out[0]).toMatchObject({
      dayOfWeek: null,
      startMinute: null,
      rawDay: "Someday",
      rawStartTime: "late",
      dayUnreadable: true,
      startTimeUnreadable: true,
    });
    expect(out[1]).toMatchObject({
      dayOfWeek: null,
      startMinute: null,
      rawDay: "",
      rawStartTime: "",
      dayUnreadable: false,
      startTimeUnreadable: false,
    });
  });

  it("defaults the length to 60 only when nothing usable came back, and lowercases emails", () => {
    const out = normalizeParsedLessons([
      lesson({ lengthMinutes: null, guardianEmail: " Mom@Example.com " }),
      lesson({ lengthMinutes: 0, athleteEmail: "LEO@example.com" }),
      lesson({ lengthMinutes: 90, guardianEmail: "" }),
    ]);
    expect(out.map((l) => l.lengthMinutes)).toEqual([60, 60, 90]);
    expect(out.map((l) => [l.guardianEmail, l.athleteEmail])).toEqual([
      ["mom@example.com", null],
      [null, "leo@example.com"],
      [null, null],
    ]);
  });

  it("parseLengthToMinutes reads '1.5 hours' as 90 (the review editor's parser; the model's length is numeric)", () => {
    expect(parseLengthToMinutes("1.5 hours")).toBe(90);
    expect(parseLengthToMinutes("45 min")).toBe(45);
    expect(parseLengthToMinutes("0:45")).toBe(45);
  });

  it("every normalized row satisfies the published schema", () => {
    const out = normalizeParsedLessons([lesson(), lesson({ day: "??", startTime: "??" })]);
    expect(parseScheduleResultSchema.safeParse({ lessons: out }).success).toBe(true);
  });
});

/* ------------------------------------------------------------- AI parse */

const okReply: ScheduleImageGenerate = async () => ({
  text: '[{"firstName":"Leo","lastName":"Lee","day":"Tuesday","startTime":"4:00 PM","lengthMinutes":45,"frequency":"weekly","guardianEmail":null,"athleteEmail":null}]',
});

describe("parseScheduleImageBytes", () => {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

  it("is 503 ai_unavailable with the web's string when the gateway key is missing", async () => {
    const err = await caught(() =>
      parseScheduleImageBytes(
        { bytes, mimeType: "image/jpeg" },
        { apiKey: null, generate: okReply },
      ),
    );
    expect(err).toMatchObject({
      code: "ai_unavailable",
      status: 503,
      message: "Photo import isn't available right now.",
    });
  });

  it("hands the model the bytes and media type directly, with the transcription prompt", async () => {
    const calls: Array<{ system: string; messages: unknown[] }> = [];
    const generate: ScheduleImageGenerate = async (args) => {
      calls.push({ system: args.system, messages: args.messages });
      return okReply(args);
    };
    const out = await parseScheduleImageBytes(
      { bytes, mimeType: "image/png" },
      { apiKey: "k", generate },
    );
    expect(out).toEqual({ lessons: [lesson()] });
    expect(calls).toHaveLength(1);
    expect(calls[0].system).toContain("Never invent names, emails, times or days.");
    const content = (calls[0].messages[0] as { content: Array<Record<string, unknown>> }).content;
    expect(content[0]).toMatchObject({ type: "text" });
    expect(String(content[0].text)).toContain("Reply with ONLY a JSON array");
    expect(content[1]).toEqual({ type: "image", image: bytes, mediaType: "image/png" });
  });

  it("is 503 ai_unavailable (web string kept) when the gateway throws", async () => {
    const err = await caught(() =>
      parseScheduleImageBytes(
        { bytes, mimeType: "image/jpeg" },
        {
          apiKey: "k",
          generate: async () => {
            throw new Error("upstream 500");
          },
        },
      ),
    );
    expect(err).toMatchObject({
      code: "ai_unavailable",
      status: 503,
      message: "Couldn't read that photo. Try a clearer picture, or enter rows manually.",
    });
  });

  it("is 422 unprocessable when the reply holds no JSON, and 200 with no lessons for an empty array", async () => {
    const err = await caught(() =>
      parseScheduleImageBytes(
        { bytes, mimeType: "image/jpeg" },
        { apiKey: "k", generate: async () => ({ text: "I see a blank page." }) },
      ),
    );
    expect(err).toMatchObject({ code: "unprocessable", status: 422 });
    const empty = await parseScheduleImageBytes(
      { bytes, mimeType: "image/jpeg" },
      { apiKey: "k", generate: async () => ({ text: "[]" }) },
    );
    expect(empty).toEqual({ lessons: [] });
  });
});

describe("imageBytesFromDataUrl", () => {
  it("decodes the web's base64 data URL into bytes and a media type", () => {
    const out = imageBytesFromDataUrl(
      `data:image/PNG;base64,${Buffer.from([1, 2, 3]).toString("base64")}`,
    );
    expect(out.mimeType).toBe("image/png");
    expect(Array.from(out.bytes)).toEqual([1, 2, 3]);
  });

  it("rejects a malformed data URL as an unreadable photo", () => {
    expect(() => imageBytesFromDataUrl("data:image/png")).toThrow(
      "Couldn't read that photo. Try a clearer picture, or enter rows manually.",
    );
    expect(() => imageBytesFromDataUrl("data:image/png,%E0%A4%A")).toThrow(
      "Couldn't read that photo. Try a clearer picture, or enter rows manually.",
    );
  });
});

describe("parseScheduleImageUpload (API composition)", () => {
  const jpeg = new Blob([new Uint8Array([0xff, 0xd8])], { type: "image/jpeg" });

  it("refuses a caller without a coach profile (422, API-only tightening)", async () => {
    const { admin } = fakeAdmin({ coach_profiles: [] });
    const err = await caught(() =>
      parseScheduleImageUpload(
        { admin, userId: USER },
        { image: jpeg },
        { apiKey: "k", generate: okReply },
      ),
    );
    expect(err).toMatchObject({
      code: "unprocessable",
      status: 422,
      message: "Coach profile not found",
    });
  });

  it("refuses HEIC (and anything outside JPEG/PNG/WebP) with 400 before spending an AI call", async () => {
    const { admin } = fakeAdmin({ coach_profiles: [COACH] });
    let calls = 0;
    const generate: ScheduleImageGenerate = async (a) => {
      calls += 1;
      return okReply(a);
    };
    for (const type of ["image/heic", "application/pdf", ""]) {
      const err = await caught(() =>
        parseScheduleImageUpload(
          { admin, userId: USER },
          { image: new Blob([new Uint8Array(4)], { type }) },
          { apiKey: "k", generate },
        ),
      );
      expect(err).toMatchObject({
        code: "validation_failed",
        status: 400,
        message: "Upload a JPEG or PNG photo.",
      });
    }
    expect(calls).toBe(0);
  });

  it("refuses a part over MAX_IMAGE_BYTES with 413 before the coach read or an AI call", async () => {
    // No coach profile on purpose: the size cap must fire before the DB read.
    const { admin } = fakeAdmin({ coach_profiles: [] });
    let calls = 0;
    const generate: ScheduleImageGenerate = async (a) => {
      calls += 1;
      return okReply(a);
    };
    const err = await caught(() =>
      parseScheduleImageUpload(
        { admin, userId: USER },
        { image: new Blob([new Uint8Array(MAX_IMAGE_BYTES + 1)], { type: "image/jpeg" }) },
        { apiKey: "k", generate },
      ),
    );
    expect(err).toMatchObject({
      code: "payload_too_large",
      status: 413,
      message: "That upload is too large.",
    });
    expect(calls).toBe(0);
  });

  it("accepts a part of exactly MAX_IMAGE_BYTES", async () => {
    const { admin } = fakeAdmin({ coach_profiles: [COACH] });
    let calls = 0;
    const generate: ScheduleImageGenerate = async (a) => {
      calls += 1;
      return okReply(a);
    };
    const out = await parseScheduleImageUpload(
      { admin, userId: USER },
      { image: new Blob([new Uint8Array(MAX_IMAGE_BYTES)], { type: "image/jpeg" }) },
      { apiKey: "k", generate },
    );
    expect(out.lessons).toHaveLength(1);
    expect(calls).toBe(1);
  });

  it("answers server-normalized rows for a coach's JPEG", async () => {
    const { admin } = fakeAdmin({ coach_profiles: [COACH] });
    const out = await parseScheduleImageUpload(
      { admin, userId: USER },
      { image: jpeg },
      { apiKey: "k", generate: okReply },
    );
    expect(out).toEqual({
      lessons: [
        {
          firstName: "Leo",
          lastName: "Lee",
          dayOfWeek: 2,
          startMinute: 960,
          lengthMinutes: 45,
          frequency: "weekly",
          guardianEmail: null,
          athleteEmail: null,
          rawDay: "Tuesday",
          rawStartTime: "4:00 PM",
          dayUnreadable: false,
          startTimeUnreadable: false,
        },
      ],
    });
  });
});

/* ----------------------------------------------- parse route pipeline */

function parseRoute(admin: Admin, generate: ScheduleImageGenerate = okReply) {
  process.env.API_V1_ENABLED = "true";
  const ctx = { userId: USER, supabase: {} as ApiContext["supabase"], admin } as ApiContext;
  return createApiRouteHandler(
    {
      method: "POST",
      path: "/api/v1/coach/schedule-import/parse",
      auth: "user",
      body: "multipart",
      partContentTypes: { image: "image/jpeg" },
      maxBodyBytes: MAX_IMAGE_BYTES,
      input: parseScheduleImageInput,
      output: parseScheduleResultSchema,
      handler: async ({ ctx, input }) =>
        parseScheduleImageUpload({ admin: ctx!.admin, userId: ctx!.userId }, input, {
          apiKey: "k",
          generate,
        }),
    },
    { admin, authenticate: async () => ctx },
  ).POST!;
}

const parseUrl = "https://gradus.training/api/v1/coach/schedule-import/parse";

describe("POST /coach/schedule-import/parse pipeline", () => {
  it("a multipart image part answers 200 with normalized rows", async () => {
    const { admin } = fakeAdmin({ coach_profiles: [COACH] });
    const form = new FormData();
    form.append("image", new Blob([new Uint8Array(64)], { type: "image/jpeg" }), "schedule.jpg");
    const res = await parseRoute(admin)({
      request: new Request(parseUrl, {
        method: "POST",
        headers: { authorization: "Bearer t" },
        body: form,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lessons).toHaveLength(1);
    expect(body.lessons[0]).toMatchObject({ firstName: "Leo", dayOfWeek: 2, startMinute: 960 });
  });

  it("a JSON body is 400 validation_failed", async () => {
    const { admin } = fakeAdmin({ coach_profiles: [COACH] });
    const res = await parseRoute(admin)({
      request: new Request(parseUrl, {
        method: "POST",
        headers: { authorization: "Bearer t", "content-type": "application/json" },
        body: JSON.stringify({ image: "data:image/png;base64,AAAA" }),
      }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("validation_failed");
  });

  it("an oversized Content-Length is 413 before the body is read", async () => {
    const { admin } = fakeAdmin({ coach_profiles: [COACH] });
    const res = await parseRoute(admin)({
      request: new Request(parseUrl, {
        method: "POST",
        headers: {
          authorization: "Bearer t",
          "content-type": "multipart/form-data; boundary=x",
          "content-length": String(MAX_IMAGE_BYTES + 1),
        },
        body: "ignored",
      }),
    });
    expect(res.status).toBe(413);
    expect((await res.json()).error.code).toBe("payload_too_large");
  });

  it("an oversized part with no Content-Length (chunked upload) is still 413 and spends no AI call", async () => {
    const { admin } = fakeAdmin({ coach_profiles: [COACH] });
    let calls = 0;
    const generate: ScheduleImageGenerate = async (a) => {
      calls += 1;
      return okReply(a);
    };
    const form = new FormData();
    form.append(
      "image",
      new Blob([new Uint8Array(13 * 1024 * 1024)], { type: "image/jpeg" }),
      "IMG_0002.jpg",
    );
    const request = new Request(parseUrl, {
      method: "POST",
      headers: { authorization: "Bearer t" },
      body: form,
    });
    // The route's Content-Length pre-check cannot see this upload; the
    // handler's own per-file cap is what holds.
    expect(request.headers.get("content-length")).toBeNull();
    const res = await parseRoute(admin, generate)({ request });
    expect(res.status).toBe(413);
    expect((await res.json()).error).toMatchObject({
      code: "payload_too_large",
      message: "That upload is too large.",
    });
    expect(calls).toBe(0);
  });

  it("an image/heic part is 400 validation_failed with the upload hint", async () => {
    const { admin } = fakeAdmin({ coach_profiles: [COACH] });
    const form = new FormData();
    form.append("image", new Blob([new Uint8Array(64)], { type: "image/heic" }), "IMG_0001.heic");
    const res = await parseRoute(admin)({
      request: new Request(parseUrl, {
        method: "POST",
        headers: { authorization: "Bearer t" },
        body: form,
      }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatchObject({
      code: "validation_failed",
      message: "Upload a JPEG or PNG photo.",
    });
  });
});

/* ----------------------------------------------------------------- commit */

describe("commitScheduleImport", () => {
  it("refuses a caller without a coach profile (422 'Coach profile not found')", async () => {
    const { admin } = fakeAdmin({ coach_profiles: [] });
    const err = await caught(() =>
      commitScheduleImport({ admin, userId: USER }, { groups: [group()] }),
    );
    expect(err).toMatchObject({
      code: "unprocessable",
      status: 422,
      message: "Coach profile not found",
    });
  });

  it("creates a new athlete with a claim token, links them, adds the sport and slots, and sends the guardian invite", async () => {
    const { admin, inserted } = fakeAdmin({ coach_profiles: [COACH] });
    const { deps, sent } = commitDeps();
    const out = await commitScheduleImport(
      { admin, userId: USER },
      { groups: [group({ slots: [slot(), slot({ dayOfWeek: 4, frequency: "monthly" })] })] },
      { apiContract: true },
      deps,
    );
    expect(out).toEqual({
      outcomes: [
        {
          key: "leo|lee|parent@example.com",
          name: "Leo Lee",
          status: "created",
          slotsAdded: 2,
          invited: "parent@example.com",
          message: null,
          reason: null,
          limit: null,
        },
      ],
    });
    expect(inserted.athletes).toEqual([
      {
        id: "row_1",
        first_name: "Leo",
        last_name: "Lee",
        parent_id: null,
        self_managed: false,
        motivation: "",
        guardian_email: "parent@example.com",
        guardian_first_name: null,
        guardian_last_name: null,
        guardian_claim_token: MINTED,
        guardian_invited_at: NOW.toISOString(),
        added_by_coach_id: "coach-1",
        invite_recipient: "guardian",
      },
    ]);
    expect(inserted.coach_athletes).toEqual([
      { id: "row_2", coach_id: "coach-1", athlete_id: "row_1", coach_ack_at: NOW.toISOString() },
    ]);
    expect(inserted.coach_athlete_sports).toEqual([
      { id: "row_3", coach_id: "coach-1", athlete_id: "row_1", sport: "figure_skating" },
    ]);
    expect(inserted.athlete_lesson_slots).toEqual([
      {
        id: "row_4",
        athlete_id: "row_1",
        coach_id: "coach-1",
        day_of_week: 2,
        start_minute: 960,
        end_minute: 1020,
        frequency: "weekly",
        weeks_of_month: [],
        starts_on: null,
      },
      {
        id: "row_5",
        athlete_id: "row_1",
        coach_id: "coach-1",
        day_of_week: 4,
        start_minute: 960,
        end_minute: 1020,
        frequency: "monthly",
        weeks_of_month: [1],
        starts_on: null,
      },
    ]);
    expect(sent).toEqual([
      {
        to: "parent@example.com",
        athleteName: "Leo Lee",
        coachName: "Sam Ortiz",
        token: MINTED,
        recipient: "guardian",
      },
    ]);
    expect(commitScheduleImportResultSchema.safeParse(out).success).toBe(true);
  });

  it("stores the parent or guardian's name the coach typed on the new athlete row (iOS Under 18 card), trimmed, empty as null", async () => {
    const { admin, inserted } = fakeAdmin({ coach_profiles: [COACH] });
    const { deps } = commitDeps();
    await commitScheduleImport(
      { admin, userId: USER },
      { groups: [group({ guardianFirstName: "  Devi ", guardianLastName: "Okonkwo" })] },
      { apiContract: true },
      deps,
    );
    expect(inserted.athletes[0]).toMatchObject({
      first_name: "Leo",
      guardian_first_name: "Devi",
      guardian_last_name: "Okonkwo",
    });
    // The contract accepts the fields as optional: an iOS build or the web
    // sheet that never sends them still writes null.
    expect(
      commitScheduleImportInput.parse({
        groups: [{ key: "k", firstName: "A", lastName: "B", slots: [slot()] }],
      }).groups[0],
    ).toMatchObject({
      guardianFirstName: "",
      guardianLastName: "",
    });
  });

  it("an Over 18 group (emailRecipient athlete) invites the athlete directly, in athlete voice (decision #59 amends #30)", async () => {
    const { admin, inserted } = fakeAdmin({ coach_profiles: [COACH] });
    const { deps, sent } = commitDeps();
    const out = await commitScheduleImport(
      { admin, userId: USER },
      {
        groups: [
          group({
            key: "adult",
            guardianEmail: "",
            athleteEmail: "Leo@Example.com",
            emailRecipient: "athlete",
          }),
        ],
      },
      {},
      deps,
    );
    expect(out.outcomes[0]).toMatchObject({ status: "created", invited: "leo@example.com" });
    expect(sent).toEqual([
      {
        to: "leo@example.com",
        athleteName: "Leo Lee",
        coachName: "Sam Ortiz",
        token: MINTED,
        recipient: "athlete",
      },
    ]);
    expect(inserted.athletes![0]).toMatchObject({
      guardian_email: "leo@example.com",
      invite_recipient: "athlete",
      guardian_first_name: null,
    });
  });

  it("with no email at all, creates the athlete without a token and sends nothing (server leniency, parity)", async () => {
    const { admin, inserted } = fakeAdmin({ coach_profiles: [COACH] });
    const { deps, sent } = commitDeps();
    const out = await commitScheduleImport(
      { admin, userId: USER },
      { groups: [group({ guardianEmail: "", athleteEmail: "" })] },
      {},
      deps,
    );
    expect(out.outcomes[0]).toMatchObject({ status: "created", invited: null, slotsAdded: 1 });
    expect(inserted.athletes![0]).toMatchObject({
      guardian_email: null,
      guardian_claim_token: null,
      guardian_invited_at: null,
    });
    expect(sent).toEqual([]);
  });

  it("writes the coach's starting levels as the new athlete's first goals row and a coach history row (decision #60)", async () => {
    const { admin, inserted } = fakeAdmin({ coach_profiles: [COACH] });
    const { deps } = commitDeps();
    const out = await commitScheduleImport(
      { admin, userId: USER },
      { groups: [group({ currentLevelKey: "pre_juvenile", seasonGoalKey: "juvenile" })] },
      { apiContract: true },
      deps,
    );
    expect(out.outcomes[0]).toMatchObject({ status: "created", slotsAdded: 1 });
    expect(inserted.athlete_goals).toEqual([
      expect.objectContaining({
        athlete_id: inserted.athletes[0].id,
        coach_id: "coach-1",
        sport: "figure_skating",
        current_level_key: "pre_juvenile",
        season_goal_key: "juvenile",
        long_term_goal: "",
      }),
    ]);
    expect(inserted.athlete_goals_history).toEqual([
      expect.objectContaining({
        athlete_id: inserted.athletes[0].id,
        sport: "figure_skating",
        changed_by_role: "coach",
        changed_by_user_id: USER,
        current_level_key: "pre_juvenile",
        season_goal_key: "juvenile",
        long_term_goal: "",
        previous_current_level_key: null,
      }),
    ]);
  });

  it("keeps the goals a linked athlete already has: a re-import's starting levels never overwrite them", async () => {
    const { admin, inserted } = fakeAdmin({
      coach_profiles: [COACH],
      athletes: [{ id: "a-existing", first_name: "Leo", last_name: "Lee" }],
      coach_athletes: [{ coach_id: "coach-1", athlete_id: "a-existing" }],
      athlete_goals: [
        {
          athlete_id: "a-existing",
          sport: "figure_skating",
          coach_id: "coach-1",
          current_level_key: "juvenile",
          season_goal_key: "intermediate",
          long_term_goal: "Pass the test.",
        },
      ],
    });
    const { deps } = commitDeps();
    const out = await commitScheduleImport(
      { admin, userId: USER },
      { groups: [group({ currentLevelKey: "pre_juvenile", seasonGoalKey: "juvenile" })] },
      { apiContract: true },
      deps,
    );
    expect(out.outcomes[0]).toMatchObject({ status: "linked" });
    expect(inserted.athlete_goals).toBeUndefined();
    expect(inserted.athlete_goals_history).toBeUndefined();
  });

  it("never writes starting levels onto an athlete reused by name, even one with no goals yet (PRD #60: only when the group creates the athlete)", async () => {
    const { admin, inserted } = fakeAdmin({
      coach_profiles: [COACH],
      athletes: [{ id: "a-existing", first_name: "Leo", last_name: "Lee" }],
      coach_athletes: [{ coach_id: "coach-1", athlete_id: "a-existing" }],
    });
    const { deps } = commitDeps();
    const out = await commitScheduleImport(
      { admin, userId: USER },
      { groups: [group({ currentLevelKey: "pre_juvenile", seasonGoalKey: "juvenile" })] },
      { apiContract: true },
      deps,
    );
    expect(out.outcomes[0]).toMatchObject({ status: "linked" });
    expect(inserted.athlete_goals).toBeUndefined();
    expect(inserted.athlete_goals_history).toBeUndefined();
  });

  it("refuses a group with one starting-level key, an unknown key, or levels without a sport", () => {
    const base = {
      key: "k",
      firstName: "Leo",
      lastName: "Lee",
      slots: [slot()],
      sport: "figure_skating",
    };
    const parse = (over: Record<string, unknown>) =>
      commitScheduleImportInput.safeParse({ groups: [{ ...base, ...over }] }).success;
    expect(parse({ currentLevelKey: "juvenile" })).toBe(false);
    expect(parse({ currentLevelKey: "ntrp_3_0", seasonGoalKey: "juvenile" })).toBe(false);
    expect(parse({ sport: "", currentLevelKey: "juvenile", seasonGoalKey: "intermediate" })).toBe(
      false,
    );
    expect(parse({ currentLevelKey: "juvenile", seasonGoalKey: "intermediate" })).toBe(true);
    expect(parse({ currentLevelKey: "", seasonGoalKey: null })).toBe(true);
  });

  it("links an athlete already on THIS coach's roster by name (case and spacing insensitive) and only adds slots — no new row, no invite", async () => {
    const { admin, inserted } = fakeAdmin({
      coach_profiles: [COACH],
      athletes: [{ id: "ath-1", first_name: "leo", last_name: "LEE" }],
      coach_athletes: [{ id: "link-1", coach_id: "coach-1", athlete_id: "ath-1" }],
    });
    const { deps, sent } = commitDeps();
    const out = await commitScheduleImport(
      { admin, userId: USER },
      { groups: [group({ firstName: "  Leo ", lastName: "Lee" })] },
      {},
      deps,
    );
    expect(out.outcomes).toEqual([
      {
        key: "leo|lee|parent@example.com",
        name: "Leo Lee",
        status: "linked",
        slotsAdded: 1,
        invited: null,
        message: null,
        reason: null,
        limit: null,
      },
    ]);
    expect(inserted.athletes ?? []).toEqual([]);
    expect(inserted.coach_athletes ?? []).toEqual([]);
    expect(inserted.athlete_lesson_slots).toHaveLength(1);
    expect(sent).toEqual([]);
  });

  it("de-duplicates slots on day + start for a linked athlete and says how many already existed", async () => {
    const { admin, inserted } = fakeAdmin({
      coach_profiles: [COACH],
      athletes: [{ id: "ath-1", first_name: "Leo", last_name: "Lee" }],
      coach_athletes: [{ id: "link-1", coach_id: "coach-1", athlete_id: "ath-1" }],
      athlete_lesson_slots: [
        { id: "s1", coach_id: "coach-1", athlete_id: "ath-1", day_of_week: 2, start_minute: 960 },
      ],
    });
    const { deps } = commitDeps();
    const out = await commitScheduleImport(
      { admin, userId: USER },
      { groups: [group({ slots: [slot(), slot({ dayOfWeek: 5 })] })] },
      {},
      deps,
    );
    expect(out.outcomes[0]).toMatchObject({
      status: "linked",
      slotsAdded: 1,
      message: "1 lesson(s) already existed",
    });
    expect(inserted.athlete_lesson_slots).toHaveLength(1);
    expect(inserted.athlete_lesson_slots![0]).toMatchObject({ day_of_week: 5, start_minute: 960 });
  });

  it("a same-named athlete on another coach's roster is not matched (duplicate row by design)", async () => {
    const { admin, inserted } = fakeAdmin({
      coach_profiles: [COACH],
      athletes: [{ id: "ath-other", first_name: "Leo", last_name: "Lee" }],
      coach_athletes: [{ id: "link-x", coach_id: "coach-9", athlete_id: "ath-other" }],
    });
    const { deps } = commitDeps();
    const out = await commitScheduleImport(
      { admin, userId: USER },
      { groups: [group()] },
      {},
      deps,
    );
    expect(out.outcomes[0].status).toBe("created");
    expect(inserted.athletes).toHaveLength(1);
  });

  it("pre-checks the plan cap from athleteLimitForTier: a coach-tier roster of 4 has room for one, the rest are skipped with reason roster_full and the limit", async () => {
    const existing = Array.from({ length: 4 }, (_, i) => ({
      id: `ath-${i}`,
      first_name: `A${i}`,
      last_name: "X",
    }));
    const { admin, inserted } = fakeAdmin({
      coach_profiles: [COACH],
      athletes: existing,
      coach_athletes: existing.map((a, i) => ({
        id: `l-${i}`,
        coach_id: "coach-1",
        athlete_id: a.id,
      })),
    });
    const { deps, sent } = commitDeps();
    const out = await commitScheduleImport(
      { admin, userId: USER },
      {
        groups: [
          group({ key: "one" }),
          group({ key: "two", firstName: "Mia", lastName: "Chen", guardianEmail: "m@example.com" }),
          group({ key: "again", firstName: "A0", lastName: "X" }),
        ],
      },
      { apiContract: true },
      deps,
    );
    expect(out.outcomes).toHaveLength(3);
    expect(out.outcomes[0]).toMatchObject({
      key: "one",
      status: "created",
      reason: null,
      limit: null,
    });
    expect(out.outcomes[1]).toEqual({
      key: "two",
      name: "Mia Chen",
      status: "skipped",
      slotsAdded: 0,
      invited: null,
      message: "Roster limit reached (5 athletes on your plan).",
      reason: "roster_full",
      limit: 5,
    });
    // Already rostered: never counts against the cap.
    expect(out.outcomes[2]).toMatchObject({ key: "again", status: "linked", slotsAdded: 1 });
    expect(inserted.athletes).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });

  it("coach_pro allows 50 and a club coach (organization_id set) is never skipped", async () => {
    const existing = Array.from({ length: 6 }, (_, i) => ({
      id: `ath-${i}`,
      first_name: `A${i}`,
      last_name: "X",
    }));
    const links = existing.map((a, i) => ({ id: `l-${i}`, coach_id: "coach-1", athlete_id: a.id }));
    const { deps } = commitDeps();

    const pro = fakeAdmin({
      coach_profiles: [{ ...COACH, subscription_tier: "coach_pro" }],
      athletes: existing,
      coach_athletes: links,
    });
    const proOut = await commitScheduleImport(
      { admin: pro.admin, userId: USER },
      { groups: [group()] },
      {},
      deps,
    );
    expect(proOut.outcomes[0].status).toBe("created");

    const club = fakeAdmin({
      coach_profiles: [{ ...COACH, organization_id: "org-1" }],
      athletes: existing,
      coach_athletes: links,
    });
    const clubOut = await commitScheduleImport(
      { admin: club.admin, userId: USER },
      { groups: [group()] },
      {},
      deps,
    );
    expect(clubOut.outcomes[0].status).toBe("created");
  });

  it("a slot that ends before it starts fails the whole group with reason ends_before_start and writes nothing", async () => {
    const { admin, inserted } = fakeAdmin({ coach_profiles: [COACH] });
    const { deps, sent } = commitDeps();
    const out = await commitScheduleImport(
      { admin, userId: USER },
      {
        groups: [
          group({ slots: [slot(), slot({ dayOfWeek: 3, startMinute: 600, endMinute: 600 })] }),
        ],
      },
      {},
      deps,
    );
    expect(out.outcomes).toEqual([
      {
        key: "leo|lee|parent@example.com",
        name: "Leo Lee",
        status: "failed",
        slotsAdded: 0,
        invited: null,
        message: "Lesson ends before it starts.",
        reason: "ends_before_start",
        limit: null,
      },
    ]);
    expect(inserted.athletes ?? []).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("rolls the new athlete row back when the coach_athletes link fails, reports link_failed, and sends no invite", async () => {
    const { admin, tables, deleted } = fakeAdmin(
      { coach_profiles: [COACH] },
      { insertErrors: { coach_athletes: [{ message: "boom" }] } },
    );
    const { deps, sent } = commitDeps();
    const out = await commitScheduleImport(
      { admin, userId: USER },
      { groups: [group()] },
      { apiContract: true },
      deps,
    );
    expect(out.outcomes).toEqual([
      {
        key: "leo|lee|parent@example.com",
        name: "Leo Lee",
        status: "failed",
        slotsAdded: 0,
        invited: null,
        message: "boom",
        reason: "link_failed",
        limit: null,
      },
    ]);
    expect(tables.athletes).toEqual([]);
    expect(deleted.athletes).toHaveLength(1);
    expect(sent).toEqual([]);
  });

  it("the DB roster-cap trigger inside a group stays a per-group failed outcome with reason roster_full — the function resolves, never throws", async () => {
    const { admin, tables } = fakeAdmin(
      { coach_profiles: [COACH] },
      { insertErrors: { coach_athletes: [{ message: rosterFullMessage, code: "23514" }] } },
    );
    const { deps } = commitDeps();
    const out = await commitScheduleImport(
      { admin, userId: USER },
      {
        groups: [
          group({ key: "first" }),
          group({ key: "second", firstName: "Mia", lastName: "Chen" }),
        ],
      },
      { apiContract: true },
      deps,
    );
    expect(out.outcomes).toHaveLength(2);
    expect(out.outcomes[0]).toEqual({
      key: "first",
      name: "Leo Lee",
      status: "failed",
      slotsAdded: 0,
      invited: null,
      message: rosterFullMessage,
      reason: "roster_full",
      limit: 5,
    });
    expect(out.outcomes[1]).toMatchObject({ key: "second", status: "created" });
    // The failed athlete row was rolled back; the second group's row remains.
    expect(tables.athletes!.map((a) => a.first_name)).toEqual(["Mia"]);
  });

  it("a failing athlete or slot insert is a failed outcome with no reason and the loop continues", async () => {
    const { admin } = fakeAdmin(
      { coach_profiles: [COACH] },
      {
        insertErrors: {
          athletes: [{ message: "athletes down" }],
          athlete_lesson_slots: [{ message: "slots down" }],
        },
      },
    );
    const { deps } = commitDeps();
    const out = await commitScheduleImport(
      { admin, userId: USER },
      { groups: [group({ key: "a" }), group({ key: "b", firstName: "Mia", lastName: "Chen" })] },
      {},
      deps,
    );
    expect(out.outcomes).toHaveLength(2);
    expect(out.outcomes[0]).toMatchObject({
      key: "a",
      status: "failed",
      message: "athletes down",
      reason: null,
    });
    expect(out.outcomes[1]).toMatchObject({
      key: "b",
      status: "failed",
      message: "slots down",
      reason: null,
    });
  });

  it("web parity: the same input yields the same outcomes with and without apiContract", async () => {
    const seed = {
      coach_profiles: [COACH],
      athletes: [{ id: "ath-1", first_name: "Leo", last_name: "Lee" }],
      coach_athletes: [{ id: "link-1", coach_id: "coach-1", athlete_id: "ath-1" }],
    };
    const input = { groups: [group(), group({ key: "new", firstName: "Mia", lastName: "Chen" })] };
    const a = await commitScheduleImport(
      { admin: fakeAdmin(seed).admin, userId: USER },
      input,
      {},
      commitDeps().deps,
    );
    const b = await commitScheduleImport(
      { admin: fakeAdmin(seed).admin, userId: USER },
      input,
      { apiContract: true },
      commitDeps().deps,
    );
    expect(a).toEqual(b);
    expect(a.outcomes.map((o) => o.status)).toEqual(["linked", "created"]);
  });

  it("a failed roster read surfaces as a database error instead of silently importing against an empty roster", async () => {
    const { admin } = fakeAdmin(
      { coach_profiles: [COACH] },
      { selectErrors: { coach_athletes: { message: "relation missing" } } },
    );
    await expect(
      commitScheduleImport({ admin, userId: USER }, { groups: [group()] }, {}, commitDeps().deps),
    ).rejects.toThrow("Something went wrong. Please try again.");
  });
});

/* ---------------------------------------------- commit route pipeline */

describe("POST /coach/schedule-import/commit pipeline", () => {
  it("the roster-cap trigger never becomes a route-level 409 roster_full — it is a 200 with a failed outcome", async () => {
    process.env.API_V1_ENABLED = "true";
    const { admin } = fakeAdmin(
      { coach_profiles: [COACH] },
      { insertErrors: { coach_athletes: [{ message: rosterFullMessage, code: "23514" }] } },
    );
    const ctx = { userId: USER, supabase: {} as ApiContext["supabase"], admin } as ApiContext;
    const { POST } = createApiRouteHandler(
      {
        method: "POST",
        path: "/api/v1/coach/schedule-import/commit",
        auth: "user",
        input: commitScheduleImportInput,
        output: commitScheduleImportResultSchema,
        handler: async ({ ctx, input }) =>
          commitScheduleImport(
            { admin: ctx!.admin, userId: ctx!.userId },
            input,
            { apiContract: true },
            commitDeps().deps,
          ),
      },
      { admin, authenticate: async () => ctx },
    );
    const res = await POST!({
      request: new Request("https://gradus.training/api/v1/coach/schedule-import/commit", {
        method: "POST",
        headers: { authorization: "Bearer t", "content-type": "application/json" },
        body: JSON.stringify({
          groups: [
            {
              key: "k",
              firstName: "Leo",
              lastName: "Lee",
              guardianEmail: "parent@example.com",
              slots: [slot()],
            },
          ],
        }),
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.outcomes).toHaveLength(1);
    expect(body.outcomes[0]).toMatchObject({
      status: "failed",
      reason: "roster_full",
      limit: 5,
      message: rosterFullMessage,
    });
  });

  it("a non-coach is 422 unprocessable and a malformed group is 400 validation_failed", async () => {
    process.env.API_V1_ENABLED = "true";
    const { admin } = fakeAdmin({ coach_profiles: [] });
    const ctx = { userId: USER, supabase: {} as ApiContext["supabase"], admin } as ApiContext;
    const { POST } = createApiRouteHandler(
      {
        method: "POST",
        path: "/api/v1/coach/schedule-import/commit",
        auth: "user",
        input: commitScheduleImportInput,
        output: commitScheduleImportResultSchema,
        handler: async ({ ctx, input }) =>
          commitScheduleImport(
            { admin: ctx!.admin, userId: ctx!.userId },
            input,
            { apiContract: true },
            commitDeps().deps,
          ),
      },
      { admin, authenticate: async () => ctx },
    );
    const url = "https://gradus.training/api/v1/coach/schedule-import/commit";
    const headers = { authorization: "Bearer t", "content-type": "application/json" };
    const notCoach = await POST!({
      request: new Request(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          groups: [{ key: "k", firstName: "Leo", lastName: "Lee", slots: [slot()] }],
        }),
      }),
    });
    expect(notCoach.status).toBe(422);
    expect((await notCoach.json()).error.code).toBe("unprocessable");

    const bad = await POST!({
      request: new Request(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          groups: [{ key: "k", firstName: "Leo", lastName: "Lee", slots: [] }],
        }),
      }),
    });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe("validation_failed");
  });
});
