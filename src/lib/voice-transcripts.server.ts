/**
 * Voice-note transcripts (PRD §6.7 item 3, amended 2026-09-19; pre-QA gate P4).
 *
 * Every voice note gets a server-side transcript stored on `messages.transcript`
 * and returned to both clients. It is the WCAG 1.2.1 text alternative, and it
 * gives iOS users the content of web-recorded WebM notes the app cannot play.
 *
 * Two producers share `transcribeVoiceNote`:
 * - `sendMessage` kicks it off right after the insert (deferred past the
 *   response with `inBackground`; the guardian mirror awaits the same promise
 *   when it needs the text, so a note is never transcribed twice).
 * - The `voice-transcripts` cron hook sweeps notes still missing a transcript
 *   (a failed or interrupted send-time attempt, and every note recorded before
 *   this shipped), newest first, a few per tick.
 *
 * A failure stamps `transcript_failed_at`; the sweep retries after
 * `RETRY_AFTER_MS` so a transient ElevenLabs outage is not permanent.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { dbError } from "./db-error";

type Client = SupabaseClient<Database>;
/** `transcript` / `transcript_failed_at` are not in the generated types until Lovable regenerates them. */
type Untyped = { from: (table: string) => any; storage: { from: (bucket: string) => any } };

export type TranscribeFn = (audio: Blob, vocabularyHints?: string[]) => Promise<string>;

export type TranscriptDeps = {
  transcribe?: TranscribeFn;
  now?: () => number;
};

export type VoiceNoteRef = {
  messageId: string;
  audioPath: string;
  mimeType: string;
  /** Already in memory on the web's inline-upload path; downloaded otherwise. */
  bytes?: Uint8Array | null;
};

/** Small on purpose: the sweep runs after the hook's response, inside the Worker's post-response budget. */
export const SWEEP_BATCH = 3;
/** A failed attempt is retried after this long. */
export const RETRY_AFTER_MS = 6 * 60 * 60 * 1000;

async function defaultTranscribe(audio: Blob, hints?: string[]): Promise<string> {
  const { transcribeWithElevenLabs } = await import("./voice.server");
  return transcribeWithElevenLabs(audio, hints);
}

/**
 * Transcribe one note and store the result. Resolves to the transcript, or
 * `null` on failure (recorded on the row). Never throws.
 */
export async function transcribeVoiceNote(
  admin: Client,
  note: VoiceNoteRef,
  deps: TranscriptDeps = {},
): Promise<string | null> {
  const db = admin as unknown as Untyped;
  const now = deps.now?.() ?? Date.now();
  const nowIso = new Date(now).toISOString();
  const retryBefore = new Date(now - RETRY_AFTER_MS).toISOString();
  // Claim the note first: the stamp doubles as a lease, so an overlapping sweep
  // or a concurrent send-time attempt skips it instead of paying ElevenLabs twice.
  let claimed: { data: unknown[] | null; error: { message?: string } | null };
  try {
    claimed = await db
      .from("messages")
      .update({ transcript_failed_at: nowIso })
      .eq("id", note.messageId)
      .is("transcript", null)
      .or(`transcript_failed_at.is.null,transcript_failed_at.lt.${retryBefore}`)
      .select("id");
  } catch (err) {
    console.error("[transcripts] claim failed", err instanceof Error ? err.message : String(err));
    return null;
  }
  if (claimed.error || !claimed.data?.length) return null;
  try {
    let bytes = note.bytes ?? null;
    if (!bytes) {
      const { data: blob, error } = await db.storage.from("voice-notes").download(note.audioPath);
      if (error || !blob) throw error ?? new Error("voice note missing from storage");
      bytes = new Uint8Array(await (blob as Blob).arrayBuffer());
    }
    const transcribe = deps.transcribe ?? defaultTranscribe;
    const text = (
      await transcribe(new Blob([bytes as unknown as BlobPart], { type: note.mimeType }))
    ).trim();
    // `audio_url IS NOT NULL`: a note tombstoned by account deletion while
    // this ran must not get its text written back.
    const { error } = await db
      .from("messages")
      .update({ transcript: text, transcript_failed_at: null })
      .eq("id", note.messageId)
      .not("audio_url", "is", null);
    if (error) throw error;
    return text;
  } catch (err) {
    console.error("[transcripts] transcription failed", {
      messageId: note.messageId,
      error: err instanceof Error ? err.message : String(err),
    });
    // The claim already stamped `transcript_failed_at`; leave it so the sweep
    // backs off, but never over a transcript that landed meanwhile.
    try {
      await db
        .from("messages")
        .update({ transcript_failed_at: nowIso })
        .eq("id", note.messageId)
        .is("transcript", null);
    } catch (stampErr) {
      console.error(
        "[transcripts] failure stamp failed",
        stampErr instanceof Error ? stampErr.message : String(stampErr),
      );
    }
    return null;
  }
}

/** Extension → MIME for notes stored before the client sent a type with the path. */
function mimeFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "m4a":
    case "mp4":
      return "audio/mp4";
    case "ogg":
      return "audio/ogg";
    case "aac":
      return "audio/aac";
    case "mp3":
      return "audio/mpeg";
    case "wav":
      return "audio/wav";
    default:
      return "audio/webm";
  }
}

export type SweepResult = { scanned: number; transcribed: number; failed: number };

/**
 * Transcribe up to `SWEEP_BATCH` voice notes that have no transcript yet and
 * are not in their retry back-off, newest first.
 */
export async function sweepVoiceTranscripts(
  ctx: { admin: Client },
  deps: TranscriptDeps = {},
): Promise<SweepResult> {
  const db = ctx.admin as unknown as Untyped;
  const now = deps.now?.() ?? Date.now();
  const retryBefore = new Date(now - RETRY_AFTER_MS).toISOString();
  const res = await db
    .from("messages")
    .select("id, audio_url, transcript_failed_at")
    .eq("kind", "voice")
    .is("transcript", null)
    .not("audio_url", "is", null)
    .or(`transcript_failed_at.is.null,transcript_failed_at.lt.${retryBefore}`)
    .order("created_at", { ascending: false })
    .limit(SWEEP_BATCH);
  if (res.error) {
    // Until migration 20260919200000 is applied the column does not exist; that is not an error worth a 500.
    if (res.error.code === "42703") {
      console.error(
        "[transcripts] messages.transcript is missing; sweep skipped until the migration is applied",
      );
      return { scanned: 0, transcribed: 0, failed: 0 };
    }
    dbError(res.error);
  }
  const rows = (res.data ?? []) as { id: string; audio_url: string }[];

  let transcribed = 0;
  let failed = 0;
  for (const row of rows) {
    const text = await transcribeVoiceNote(
      ctx.admin,
      { messageId: row.id, audioPath: row.audio_url, mimeType: mimeFromPath(row.audio_url) },
      deps,
    );
    if (text === null) failed += 1;
    else transcribed += 1;
  }
  return { scanned: rows.length, transcribed, failed };
}
