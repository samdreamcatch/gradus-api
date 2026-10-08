import { describe, expect, it } from "bun:test";
import {
  NEVER_TRANSCRIBE,
  RETRY_AFTER_MS,
  SWEEP_BATCH,
  sweepVoiceTranscripts,
  transcribeVoiceNote,
} from "./voice-transcripts.server";

type Row = Record<string, unknown>;

/**
 * Fake admin: a `messages` row store with the chained reads the sweep issues
 * and `update().eq()` writes, plus a `voice-notes` storage bucket.
 */
function fakeAdmin(messages: Row[], files: Record<string, Uint8Array> = {}) {
  const updates: { id: string; patch: Row }[] = [];
  const downloads: string[] = [];
  type Filter = (r: Row) => boolean;
  const orFilter = (expr: string): Filter => {
    // "transcript_failed_at.is.null,transcript_failed_at.lt.<iso>"
    const lt = expr.split("transcript_failed_at.lt.")[1];
    return (r) => r.transcript_failed_at == null || (r.transcript_failed_at as string) < lt;
  };
  const query = (rows: Row[]) => {
    const self = {
      eq: (col: string, val: unknown) => query(rows.filter((r) => r[col] === val)),
      is: (col: string, val: unknown) => query(rows.filter((r) => (r[col] ?? null) === val)),
      not: (col: string, op: string, val: unknown) =>
        query(rows.filter((r) => (op === "is" && val === null ? r[col] != null : true))),
      or: (expr: string) => query(rows.filter(orFilter(expr))),
      order: (col: string, opts: { ascending: boolean }) =>
        query(
          [...rows].sort((a, b) =>
            opts.ascending
              ? String(a[col]).localeCompare(String(b[col]))
              : String(b[col]).localeCompare(String(a[col])),
          ),
        ),
      limit: (n: number) => query(rows.slice(0, n)),
      then: (resolve: (v: { data: Row[]; error: null }) => void) =>
        resolve({ data: rows, error: null }),
    };
    return self;
  };
  /** `update(patch)` with chained filters; applies on await or `.select()`, returning the rows it touched. */
  const update = (patch: Row) => {
    const filters: Filter[] = [];
    const apply = () => {
      const hit = messages.filter((m) => filters.every((f) => f(m)));
      for (const row of hit) {
        updates.push({ id: row.id as string, patch });
        Object.assign(row, patch);
      }
      return { data: hit.map((r) => ({ id: r.id })), error: null };
    };
    const chain = {
      eq: (col: string, val: unknown) => {
        filters.push((r) => r[col] === val);
        return chain;
      },
      is: (col: string, val: unknown) => {
        filters.push((r) => (r[col] ?? null) === val);
        return chain;
      },
      not: (col: string, op: string, val: unknown) => {
        filters.push((r) => (op === "is" && val === null ? r[col] != null : true));
        return chain;
      },
      or: (expr: string) => {
        filters.push(orFilter(expr));
        return chain;
      },
      select: () => Promise.resolve(apply()),
      then: (resolve: (v: { data: Row[]; error: null }) => void) => resolve(apply()),
    };
    return chain;
  };
  const admin = {
    from: () => ({ select: () => query(messages), update }),
    storage: {
      from: () => ({
        download: (path: string) => {
          downloads.push(path);
          const bytes = files[path];
          return Promise.resolve(
            bytes
              ? { data: new Blob([bytes as unknown as BlobPart]), error: null }
              : { data: null, error: new Error("not found") },
          );
        },
      }),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return { admin, updates, downloads };
}

const NOW = Date.UTC(2026, 8, 19, 16, 0, 0);

describe("transcribeVoiceNote: never a minor's audio (decision #48)", () => {
  it("skips a note whose sender is an athlete under 18, for good, without calling the service", async () => {
    const messages: Row[] = [
      {
        id: "m9",
        kind: "voice",
        audio_url: "r/u/old.m4a",
        sender_user_id: "minor-user",
        created_at: "2026-09-01",
      },
    ];
    const { admin, downloads } = fakeAdmin(messages, { "r/u/old.m4a": new Uint8Array([1]) });
    let calls = 0;
    const deps = {
      now: () => NOW,
      transcribe: async () => {
        calls += 1;
        return "never";
      },
      voiceAllowed: async (id: string) => (id === "minor-user" ? false : null),
    };
    const text = await transcribeVoiceNote(
      admin,
      { messageId: "m9", audioPath: "r/u/old.m4a", mimeType: "audio/mp4" },
      deps,
    );
    expect(text).toBeNull();
    expect(calls).toBe(0);
    expect(downloads).toEqual([]);
    expect(messages[0].transcript_failed_at).toBe(NEVER_TRANSCRIBE);
    // the sweep's back-off never ends for it
    const later = await sweepVoiceTranscripts(
      { admin },
      { ...deps, now: () => NOW + 365 * 24 * 60 * 60 * 1000 },
    );
    expect(later.scanned).toBe(0);
    expect(calls).toBe(0);
  });

  it("still transcribes an adult's or a coach's note", async () => {
    const { admin } = fakeAdmin([
      { id: "m8", kind: "voice", audio_url: "r/u/a.m4a", sender_user_id: "coach-user" },
    ]);
    const text = await transcribeVoiceNote(
      admin,
      {
        messageId: "m8",
        audioPath: "r/u/a.m4a",
        mimeType: "audio/mp4",
        bytes: new Uint8Array([1]),
      },
      { now: () => NOW, transcribe: async () => "Nice edge.", voiceAllowed: async () => null },
    );
    expect(text).toBe("Nice edge.");
  });
});

describe("transcribeVoiceNote", () => {
  it("uses bytes already in hand, stores the trimmed transcript, and clears any failure stamp", async () => {
    const { admin, updates, downloads } = fakeAdmin([
      { id: "m1", kind: "voice", audio_url: "r/u/a.m4a" },
    ]);
    const seen: { type: string; size: number }[] = [];
    const text = await transcribeVoiceNote(
      admin,
      {
        messageId: "m1",
        audioPath: "r/u/a.m4a",
        mimeType: "audio/mp4",
        bytes: new Uint8Array([1, 2, 3]),
      },
      {
        transcribe: async (audio) => {
          seen.push({ type: audio.type, size: audio.size });
          return "  Nice loop today.  ";
        },
      },
    );
    expect(text).toBe("Nice loop today.");
    expect(seen).toEqual([{ type: "audio/mp4", size: 3 }]);
    expect(downloads).toEqual([]);
    // the claim stamps a lease first, then the transcript lands and clears it
    expect(updates.map((u) => Object.keys(u.patch).sort())).toEqual([
      ["transcript_failed_at"],
      ["transcript", "transcript_failed_at"],
    ]);
    expect(typeof updates[0].patch.transcript_failed_at).toBe("string");
    expect(updates[1].patch).toEqual({
      transcript: "Nice loop today.",
      transcript_failed_at: null,
    });
  });

  it("downloads a client-uploaded note from the bucket when no bytes are given", async () => {
    const { admin, downloads } = fakeAdmin([{ id: "m1", kind: "voice", audio_url: "r/u/a.webm" }], {
      "r/u/a.webm": new Uint8Array([9]),
    });
    const text = await transcribeVoiceNote(
      admin,
      { messageId: "m1", audioPath: "r/u/a.webm", mimeType: "audio/webm" },
      { transcribe: async () => "hi" },
    );
    expect(text).toBe("hi");
    expect(downloads).toEqual(["r/u/a.webm"]);
  });

  it("records a failure instead of throwing when the service or the download fails", async () => {
    const { admin, updates } = fakeAdmin([{ id: "m1", kind: "voice", audio_url: "x" }]);
    const original = console.error;
    console.error = () => {};
    const second = fakeAdmin([{ id: "m1", kind: "voice", audio_url: "x" }]);
    try {
      const a = await transcribeVoiceNote(
        admin,
        { messageId: "m1", audioPath: "missing.webm", mimeType: "audio/webm" },
        { transcribe: async () => "never", now: () => NOW },
      );
      expect(a).toBeNull();
      // A second attempt on the same row inside the back-off is refused by the claim.
      expect(
        await transcribeVoiceNote(
          admin,
          { messageId: "m1", audioPath: "x", mimeType: "audio/webm", bytes: new Uint8Array([1]) },
          { transcribe: async () => "never", now: () => NOW },
        ),
      ).toBeNull();
      const b = await transcribeVoiceNote(
        second.admin,
        { messageId: "m1", audioPath: "x", mimeType: "audio/webm", bytes: new Uint8Array([1]) },
        {
          transcribe: async () => {
            throw new Error("503");
          },
          now: () => NOW,
        },
      );
      expect(b).toBeNull();
    } finally {
      console.error = original;
    }
    // claim + stamp for the first attempt; the refused retry writes nothing
    expect(updates.map((u) => u.patch)).toEqual([
      { transcript_failed_at: new Date(NOW).toISOString() },
      { transcript_failed_at: new Date(NOW).toISOString() },
    ]);
    expect(second.updates.map((u) => u.patch)).toEqual([
      { transcript_failed_at: new Date(NOW).toISOString() },
      { transcript_failed_at: new Date(NOW).toISOString() },
    ]);
  });
});

describe("sweepVoiceTranscripts", () => {
  const stale = new Date(NOW - RETRY_AFTER_MS - 60_000).toISOString();
  const recent = new Date(NOW - 60_000).toISOString();
  const rows = () => [
    {
      id: "new",
      kind: "voice",
      audio_url: "r/u/new.m4a",
      transcript: null,
      transcript_failed_at: null,
      created_at: "2026-09-19T15:59:00Z",
    },
    {
      id: "old",
      kind: "voice",
      audio_url: "r/u/old.webm",
      transcript: null,
      transcript_failed_at: null,
      created_at: "2026-09-01T10:00:00Z",
    },
    {
      id: "done",
      kind: "voice",
      audio_url: "r/u/done.m4a",
      transcript: "already",
      transcript_failed_at: null,
      created_at: "2026-09-19T15:58:00Z",
    },
    {
      id: "text",
      kind: "text",
      audio_url: null,
      transcript: null,
      transcript_failed_at: null,
      created_at: "2026-09-19T15:57:00Z",
    },
    {
      id: "retry",
      kind: "voice",
      audio_url: "r/u/retry.webm",
      transcript: null,
      transcript_failed_at: stale,
      created_at: "2026-09-10T10:00:00Z",
    },
    {
      id: "backoff",
      kind: "voice",
      audio_url: "r/u/backoff.webm",
      transcript: null,
      transcript_failed_at: recent,
      created_at: "2026-09-19T15:56:00Z",
    },
    {
      id: "nofile",
      kind: "voice",
      audio_url: null,
      transcript: null,
      transcript_failed_at: null,
      created_at: "2026-09-19T15:55:00Z",
    },
  ];

  it("transcribes untranscribed voice notes newest first, retrying stale failures and skipping fresh ones", async () => {
    const files = {
      "r/u/new.m4a": new Uint8Array([1]),
      "r/u/old.webm": new Uint8Array([2]),
      "r/u/retry.webm": new Uint8Array([3]),
    };
    const { admin, downloads } = fakeAdmin(rows(), files);
    const mimes: string[] = [];
    const result = await sweepVoiceTranscripts(
      { admin },
      {
        transcribe: async (audio) => {
          mimes.push(audio.type);
          return "ok";
        },
        now: () => NOW,
      },
    );
    expect(result).toEqual({ scanned: 3, transcribed: 3, failed: 0 });
    expect(downloads).toEqual(["r/u/new.m4a", "r/u/retry.webm", "r/u/old.webm"]);
    expect(mimes).toEqual(["audio/mp4", "audio/webm", "audio/webm"]);
  });

  it("caps a tick at the batch size and counts failures", async () => {
    const many = Array.from({ length: SWEEP_BATCH + 3 }, (_, i) => ({
      id: `m${i}`,
      kind: "voice",
      audio_url: `r/u/${i}.m4a`,
      transcript: null,
      transcript_failed_at: null,
      created_at: `2026-09-19T15:${String(10 + i).padStart(2, "0")}:00Z`,
    }));
    const { admin } = fakeAdmin(many, {});
    const original = console.error;
    console.error = () => {};
    try {
      const result = await sweepVoiceTranscripts(
        { admin },
        { transcribe: async () => "x", now: () => NOW },
      );
      expect(result).toEqual({ scanned: SWEEP_BATCH, transcribed: 0, failed: SWEEP_BATCH });
    } finally {
      console.error = original;
    }
  });
});

describe("transcribeVoiceNote claims and guards", () => {
  it("skips a note that already has a transcript or is inside another attempt's back-off", async () => {
    const done = fakeAdmin([{ id: "m1", kind: "voice", audio_url: "x", transcript: "already" }]);
    let calls = 0;
    const transcribe = async () => {
      calls += 1;
      return "again";
    };
    expect(
      await transcribeVoiceNote(
        done.admin,
        { messageId: "m1", audioPath: "x", mimeType: "audio/webm", bytes: new Uint8Array([1]) },
        { transcribe },
      ),
    ).toBeNull();
    const leased = fakeAdmin([
      {
        id: "m1",
        kind: "voice",
        audio_url: "x",
        transcript: null,
        transcript_failed_at: new Date(NOW - 60_000).toISOString(),
      },
    ]);
    expect(
      await transcribeVoiceNote(
        leased.admin,
        { messageId: "m1", audioPath: "x", mimeType: "audio/webm", bytes: new Uint8Array([1]) },
        { transcribe, now: () => NOW },
      ),
    ).toBeNull();
    expect(calls).toBe(0);
    expect(done.updates).toEqual([]);
  });

  it("does not write a transcript onto a note tombstoned meanwhile, and a failure never overwrites a transcript", async () => {
    const tomb = fakeAdmin([{ id: "m1", kind: "voice", audio_url: "x" }]);
    const original = console.error;
    console.error = () => {};
    try {
      await transcribeVoiceNote(
        tomb.admin,
        { messageId: "m1", audioPath: "x", mimeType: "audio/webm", bytes: new Uint8Array([1]) },
        {
          transcribe: async () => {
            // account deletion lands while ElevenLabs is working
            await tomb.admin.from().update({ audio_url: null }).eq("id", "m1");
            return "secret";
          },
        },
      );
    } finally {
      console.error = original;
    }
    expect(
      tomb.updates.some((u) => "transcript" in u.patch && u.patch.transcript === "secret"),
    ).toBe(false);
  });

  it("maps every stored extension to the container ElevenLabs expects", async () => {
    const files = {
      "r/u/a.aac": new Uint8Array([1]),
      "r/u/b.mp3": new Uint8Array([2]),
      "r/u/c.wav": new Uint8Array([3]),
    };
    const rows = Object.keys(files).map((p, i) => ({
      id: `m${i}`,
      kind: "voice",
      audio_url: p,
      transcript: null,
      transcript_failed_at: null,
      created_at: `2026-09-19T15:0${i}:00Z`,
    }));
    const { admin } = fakeAdmin(rows, files);
    const mimes: string[] = [];
    await sweepVoiceTranscripts(
      { admin },
      {
        transcribe: async (a) => {
          mimes.push(a.type);
          return "x";
        },
        now: () => NOW,
      },
    );
    expect(mimes.sort()).toEqual(["audio/aac", "audio/mpeg", "audio/wav"]);
  });
});
