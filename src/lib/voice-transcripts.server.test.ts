import { describe, expect, it } from "bun:test";
import {
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
  const query = (rows: Row[]) => {
    const self = {
      eq: (col: string, val: unknown) => query(rows.filter((r) => r[col] === val)),
      is: (col: string, val: unknown) => query(rows.filter((r) => (r[col] ?? null) === val)),
      not: (col: string, op: string, val: unknown) =>
        query(rows.filter((r) => (op === "is" && val === null ? r[col] != null : true))),
      or: (expr: string) => {
        // "transcript_failed_at.is.null,transcript_failed_at.lt.<iso>"
        const lt = expr.split("transcript_failed_at.lt.")[1];
        return query(
          rows.filter(
            (r) => r.transcript_failed_at == null || (r.transcript_failed_at as string) < lt,
          ),
        );
      },
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
  const admin = {
    from: () => ({
      select: () => query(messages),
      update: (patch: Row) => ({
        eq: (_col: string, id: string) => {
          updates.push({ id, patch });
          const row = messages.find((m) => m.id === id);
          if (row) Object.assign(row, patch);
          return Promise.resolve({ error: null });
        },
      }),
    }),
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

describe("transcribeVoiceNote", () => {
  it("uses bytes already in hand, stores the trimmed transcript, and clears any failure stamp", async () => {
    const { admin, updates, downloads } = fakeAdmin([{ id: "m1", kind: "voice" }]);
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
    expect(updates).toEqual([
      { id: "m1", patch: { transcript: "Nice loop today.", transcript_failed_at: null } },
    ]);
  });

  it("downloads a client-uploaded note from the bucket when no bytes are given", async () => {
    const { admin, downloads } = fakeAdmin([{ id: "m1", kind: "voice" }], {
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
    const { admin, updates } = fakeAdmin([{ id: "m1", kind: "voice" }]);
    const original = console.error;
    console.error = () => {};
    try {
      const a = await transcribeVoiceNote(
        admin,
        { messageId: "m1", audioPath: "missing.webm", mimeType: "audio/webm" },
        { transcribe: async () => "never", now: () => NOW },
      );
      expect(a).toBeNull();
      const b = await transcribeVoiceNote(
        admin,
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
    expect(updates.map((u) => u.patch)).toEqual([
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
