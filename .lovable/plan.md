## Goal

Figure out why this user's voice plan came back empty, and make sure the next coach who hits the same edge case (long dictation, sport-specific vocabulary, no library matches) gets a usable result instead of a blank plan.

## What we know vs. don't know

Known: recording was 95s (over the 90s client cap), two LLM calls completed, the resulting plan has 0 moves / no athlete / no notes, no server logs were emitted because the code only logs on thrown errors.

Unknown without new telemetry: what the transcript actually said, what the slotter returned, whether moves were dropped at filter time, whether the athlete name failed to resolve.

## Changes

### 1. Capture diagnostics on every voice attempt (server)

In `src/lib/voice.server.ts`:
- After `transcribeWithElevenLabs`, `console.info` the transcript length and first 200 chars.
- After `slotTranscript`, `console.info` a compact summary: `{ title, athleteName, moveCount, moveNames, leftoverLen }`.
- In `applyDraft`, count moves filtered out by the `name?.trim() || matchExistingMoveId` guard and log that count.
- On any caught error in `buildDraft`, include the transcript length in the log line.

This is the cheapest way to unblock future debugging — next time this happens we read the worker logs and see exactly where it broke.

### 2. Persist the transcript on the plan

Add a nullable `voice_transcript text` column to `plans` via migration, write it in `applyDraft` for both create and edit modes. Surface it in the plan editor as a collapsible "What you said" panel so the coach can recover their dictation when parsing fails (and we can read it after-the-fact when investigating).

### 3. Better empty-result UX (client)

In `src/components/coach/voice-fab.tsx`:
- When `result.appliedMoveCount === 0` and `mode === "create"`, show a `toast.warning` instead of `toast.success`: "Couldn't pick out moves from that — your dictation is saved on the plan."
- When `mode === "edit"` and 0 moves applied, same warning.

Keeps the plan (so notes/transcript aren't lost) but tells the coach to expect a manual pass.

### 4. Raise the recording cap to match real dictation length

In `src/hooks/use-voice-capture.ts` default `maxMs` from 90_000 → 120_000, and update `MAX_AUDIO_BYTES` in `src/lib/voice.server.ts` from 8 MB → 12 MB plus the matching "keep under 120 seconds" copy. The "Wrapping up at 90 s" warning text in `voice-fab.tsx` becomes "Wrapping up at 120 s".

### 5. Loosen the move filter so figure-skating-style moves aren't silently dropped

Today `applyDraft` keeps a move only if `name.trim()` is non-empty or it's an existing-id update. That's correct, but the slotting prompt currently encourages the LLM to leave `name` null when only a description was given. Tweak the system prompt in `slotTranscript` to require `name` for every move (use a short noun phrase derived from the dictation if the coach didn't name it explicitly, e.g. "Double salchow reps"). Add one more few-shot example covering a long multi-move dictation.

### 6. Verify against the user's actual recording

After deploying, replay the audio from the screen recording (extract with `ffmpeg`) against the live `voiceBuildPlan` endpoint in a test coach account and confirm we now get ≥1 move plus a usable transcript/notes block. Capture before/after screenshots.

## Out of scope (for this pass)

- Sport-specific custom vocabulary lists for ElevenLabs. We pass the coach's library names already; pulling in a curated figure-skating glossary is a separate, larger task once we confirm from logs that mis-transcription (not slotting) is the dominant failure mode.
- Resuming a cut-off recording / chunked uploads.

## Technical notes

- Migration adds one nullable text column; no RLS changes required (existing plan policies cover it).
- Logs land in worker logs; readable via `stack_modern--server-function-logs` with `search: "voice"`.
- No new dependencies.
