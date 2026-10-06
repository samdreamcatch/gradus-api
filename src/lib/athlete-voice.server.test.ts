import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { ApiError } from "./api/errors";
import { applyAthleteDraft, buildAthletePlanFromVoice, withoutWords } from "./athlete-voice.server";
import { recordingClient, type Call } from "./recording-client.test-util";
import { transcribeWithElevenLabs, type LibraryMove } from "./voice.server";

const SECRET = "my double axel nine times and my secret-words-xyzzy cue";

const has = (call: Call, method: string, column: string, value: unknown) =>
  call.filters.some((f) => f[0] === method && f[1] === column && f[2] === value);

/** Captures everything the code under test writes to the console. */
function captureConsole() {
  const lines: string[] = [];
  const saved = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };
  const grab =
    () =>
    (...args: unknown[]) => {
      lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    };
  console.log = grab();
  console.info = grab();
  console.warn = grab();
  console.error = grab();
  return {
    lines,
    restore() {
      Object.assign(console, saved);
    },
  };
}

const realFetch = globalThis.fetch;
const realEnv = { ...process.env };

beforeEach(() => {
  process.env.ELEVENLABS_API_KEY = "test-key";
  delete process.env.LOVABLE_API_KEY;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  process.env = { ...realEnv };
});

function stubTranscription(text: string) {
  const requests: Array<{ url: string; body: unknown }> = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), body: init?.body });
    return new Response(JSON.stringify({ text }), { status: 200 });
  }) as typeof fetch;
  return requests;
}

const audio = () => new Blob([new Uint8Array([1, 2, 3, 4])], { type: "audio/mp4" });

describe("transcribeWithElevenLabs quiet mode", () => {
  it("logs a preview of the words by default (the coach path is unchanged)", async () => {
    stubTranscription(SECRET);
    const out = captureConsole();
    try {
      await transcribeWithElevenLabs(audio(), []);
    } finally {
      out.restore();
    }
    expect(out.lines.join("\n")).toContain("secret-words-xyzzy");
  });

  it("logs the length only when quiet", async () => {
    stubTranscription(SECRET);
    const out = captureConsole();
    let text = "";
    try {
      text = await transcribeWithElevenLabs(audio(), [], { quiet: true });
    } finally {
      out.restore();
    }
    expect(text).toBe(SECRET);
    expect(out.lines.join("\n")).not.toContain("secret-words-xyzzy");
    expect(out.lines.join("\n")).toContain(String(SECRET.length));
  });
});

describe("buildAthletePlanFromVoice: transcribe and discard (decision #37)", () => {
  const athleteRow = { id: "ath-1", first_name: "Elsie", account_state: "active" };

  it("sends the audio only to the transcription service and never logs the words", async () => {
    const requests = stubTranscription(SECRET);
    const { client, calls } = recordingClient((call) => {
      if (call.table === "athletes") return { data: athleteRow };
      return undefined;
    });
    // Reaching the structuring step with no AI configured fails after the
    // transcription: the point is what happened to the audio and the words.
    const out = captureConsole();
    let err: unknown = null;
    try {
      await buildAthletePlanFromVoice(
        { userId: "user-1", supabase: client },
        { audio: audio(), mode: "create" },
      );
    } catch (e) {
      err = e;
    } finally {
      out.restore();
    }
    expect(err).not.toBeNull();

    // one outbound request, to the transcription host, carrying the clip
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("https://api.elevenlabs.io/v1/speech-to-text");
    // no storage use anywhere: the fake client has no `storage`, and nothing wrote
    expect(calls.some((c) => c.op === "insert" || c.op === "update")).toBe(false);
    expect((client as { storage?: unknown }).storage).toBeUndefined();
    // the words appear in no log line, success or failure
    expect(out.lines.join("\n")).not.toContain("secret-words-xyzzy");
  });

  it("refuses a paused athlete before spending anything on transcription", async () => {
    const requests = stubTranscription(SECRET);
    const { client } = recordingClient((call) =>
      call.table === "athletes" ? { data: { ...athleteRow, account_state: "paused" } } : undefined,
    );
    let err: unknown = null;
    try {
      await buildAthletePlanFromVoice(
        { userId: "user-1", supabase: client },
        { audio: audio(), mode: "create" },
      );
    } catch (e) {
      err = e;
    }
    expect(err instanceof ApiError && err.code === "paused").toBe(true);
    expect(requests).toHaveLength(0);
  });

  it("an edit of a plan that is not theirs 404s before transcription", async () => {
    const requests = stubTranscription(SECRET);
    const { client } = recordingClient((call) =>
      call.table === "athletes" ? { data: athleteRow } : { data: null },
    );
    let err: unknown = null;
    try {
      await buildAthletePlanFromVoice(
        { userId: "user-1", supabase: client },
        { audio: audio(), mode: "edit", planId: "someone-elses" },
      );
    } catch (e) {
      err = e;
    }
    expect(err instanceof ApiError && err.status === 404).toBe(true);
    expect(requests).toHaveLength(0);
  });
});

describe("withoutWords: what the 24-hour replay row keeps (decision #37)", () => {
  const full = {
    planId: "plan-1",
    transcript: SECRET,
    touched: {
      plan: { title: true },
      moves: { "pm-1": ["name", "target"] },
      newMoveIds: ["pm-1"],
      transcript: SECRET,
      sources: {
        plan: { title: { quote: "double axel", start: 3, end: 14 } },
        moves: { "pm-1": { name: { quote: "double axel", start: 3, end: 14 } } },
      },
    },
    unresolvedAthleteName: null,
    appliedMoveCount: 1,
    droppedMoveCount: 0,
    aiFailed: false,
  };

  it("drops the transcript and every quote, and keeps the plan, flags and counts", () => {
    const kept = withoutWords(full);
    const text = JSON.stringify(kept);
    expect(text).not.toContain("secret-words-xyzzy");
    expect(text).not.toContain("double axel");
    expect(kept.transcript).toBe("");
    expect(kept.touched.transcript).toBeUndefined();
    expect(kept.touched.sources).toBeUndefined();
    expect(kept.planId).toBe("plan-1");
    expect(kept.touched.plan).toEqual({ title: true });
    expect(kept.touched.moves).toEqual({ "pm-1": ["name", "target"] });
    expect(kept.touched.newMoveIds).toEqual(["pm-1"]);
    expect(kept.appliedMoveCount).toBe(1);
  });

  it("does not change the result the caller gets", () => {
    withoutWords(full);
    expect(full.transcript).toBe(SECRET);
    expect(full.touched.sources).toBeDefined();
  });
});

describe("applyAthleteDraft", () => {
  const seed: LibraryMove = {
    id: "seed-1",
    name: "Double axel",
    category: "Jumps",
    description: "Take off forward.",
    cue: "Tight arms",
    why: "Rotation",
    defaultTargetKind: "reps",
    defaultTargetValue: 10,
  };

  it("creates a draft that is the athlete's own, keeps the transcript, links no library move, and ignores a spoken athlete name", async () => {
    const { client, calls } = recordingClient((call, kind) => {
      if (call.table === "plans" && call.op === "insert") return { data: { id: "plan-new" } };
      if (call.table === "plan_moves" && call.op === "insert") return { data: { id: "pm-new" } };
      if (call.table === "plan_moves" && kind === "one") return { data: null };
      return undefined;
    });
    const result = await applyAthleteDraft(
      client,
      "ath-1",
      "create",
      undefined,
      {
        title: "Axel day",
        athleteId: "someone-else", // the athlete slot is never honored
        unresolvedAthleteName: "Sarah",
        notes: "Warm up first.",
        moves: [
          {
            libraryMoveId: "seed-1",
            name: "Double axel",
            description: "Nine clean ones.",
            cue: "",
            why: "",
            targetKind: "reps",
            targetValue: 9,
            targetFromVoice: true,
            sources: { name: "double axel", target: "nine times" },
          },
        ],
        sources: { title: "axel" },
      },
      SECRET,
      [seed],
    );

    const plan = calls.find((c) => c.table === "plans" && c.op === "insert")!;
    expect(plan.payload).toEqual({
      athlete_id: "ath-1",
      kind: "plan",
      source: "athlete",
      status: "draft",
      title: "Axel day",
      notes: "Warm up first.",
      voice_transcript: SECRET,
    });
    expect(JSON.stringify(plan.payload)).not.toContain("someone-else");

    const pm = calls.find((c) => c.table === "plan_moves" && c.op === "insert")!;
    expect(pm.payload).toEqual(
      expect.objectContaining({
        plan_id: "plan-new",
        move_id: null,
        name: "Double axel",
        // the curriculum's wording is kept and the spoken part appended
        description: "Take off forward. Nine clean ones.",
        cue: "Tight arms",
        target_value: 9,
      }),
    );
    expect(result.planId).toBe("plan-new");
    expect(result.transcript).toBe(SECRET);
    expect(result.unresolvedAthleteName).toBeNull();
    expect(result.touched.plan.athleteId).toBeUndefined();
    expect(result.appliedMoveCount).toBe(1);
    expect(result.aiFailed).toBe(false);
  });

  it("an empty draft from a failed AI step still saves the words on a new plan", async () => {
    const { client, calls } = recordingClient((call) =>
      call.table === "plans" && call.op === "insert" ? { data: { id: "plan-new" } } : undefined,
    );
    const result = await applyAthleteDraft(
      client,
      "ath-1",
      "create",
      undefined,
      { moves: [], aiFailed: true },
      SECRET,
      [],
    );
    const plan = calls.find((c) => c.table === "plans" && c.op === "insert")!;
    expect((plan.payload as { voice_transcript: string }).voice_transcript).toBe(SECRET);
    expect(result.aiFailed).toBe(true);
    expect(result.appliedMoveCount).toBe(0);
  });

  it("edit mode only touches a plan the athlete wrote, and pins every write to it", async () => {
    const notOwned = recordingClient(() => ({ data: null }));
    const err = await applyAthleteDraft(
      notOwned.client,
      "ath-1",
      "edit",
      "plan-9",
      { moves: [] },
      SECRET,
      [],
    ).catch((e) => e);
    expect(err instanceof ApiError && err.status === 404).toBe(true);
    expect(notOwned.calls.some((c) => c.op !== "select")).toBe(false);

    const { client, calls } = recordingClient((call, kind) => {
      if (call.table === "plans" && kind === "one") {
        return { data: { id: "plan-1", title: "t", notes: "", status: "draft" } };
      }
      if (call.table === "plan_moves" && kind === "one") return { data: { id: "pm-1" } };
      return undefined;
    });
    await applyAthleteDraft(
      client,
      "ath-1",
      "edit",
      "plan-1",
      {
        title: "Renamed",
        moves: [
          {
            matchExistingMoveId: "pm-1",
            name: "",
            description: "",
            cue: "Softer knees",
            why: "",
            targetKind: "reps",
            targetValue: 10,
          },
        ],
      },
      SECRET,
      [],
    );
    const planUpdates = calls.filter((c) => c.table === "plans" && c.op === "update");
    expect(planUpdates.length).toBeGreaterThan(0);
    for (const u of planUpdates) {
      expect(has(u, "eq", "athlete_id", "ath-1")).toBe(true);
      expect(has(u, "eq", "source", "athlete")).toBe(true);
    }
    const moveUpdate = calls.find((c) => c.table === "plan_moves" && c.op === "update")!;
    expect(moveUpdate.payload).toEqual({ cue: "Softer knees" });
    expect(has(moveUpdate, "eq", "plan_id", "plan-1")).toBe(true);
  });
});
