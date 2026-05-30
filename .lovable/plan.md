# Voice-to-Plan for Coaches

## Goal
A coach taps a mic FAB on `/coach/plans`, holds, speaks their plan in natural language ("Plan for Sarah — forehand topspin, 20 reps, focus on low-to-high swing path; then split-step footwork, 5 minutes…"), releases, and within ~2-3 seconds sees a fully populated plan editor with every voice-derived field highlighted in pen-accent so they can scan, tweak, and approve.

The same flow works inside an existing plan to add/modify moves.

---

## UX Flow

### 1. Entry — Floating mic FAB on plans list
- Round 64px FAB pinned bottom-right of `/coach/plans` (above the bottom nav), filled with the user's `--accent` pen color, paper-style `--shadow-page`, with a `Mic` icon.
- Tap-and-hold to record. Visual states:
  - **Idle** — solid pen color, subtle pulse.
  - **Recording** — expanded, animated `--accent-wash` ripple, live waveform (driven by mic `AnalyserNode`), elapsed timer (`mm:ss`), Caveat hint: *"Speaking…"*.
  - **Transcribing** — spinner + Caveat *"Catching that…"*.
  - **Parsing** — spinner + Caveat *"Organizing…"*.
- Release → stops recording. Swipe-up-and-release → cancels.
- A small `Mic` button is also added inside the plan editor header (top-right cluster) so the same gesture works to *add to / modify* an open plan.

### 2. Capture
- Browser MediaRecorder (`audio/webm; codecs=opus`), 16 kHz mono.
- Cap at 90 s per take with a visible warning at 75 s.
- On release, upload blob to a server function.

### 3. Transcribe (ElevenLabs Scribe batch)
- Server function `transcribeVoice` (in `src/lib/voice.functions.ts`) POSTs the blob to `https://api.elevenlabs.io/v1/speech-to-text` with `model_id=scribe_v2`, `language_code=eng`, `diarize=false`, `tag_audio_events=false`.
- Returns `{ text }` to the client.

### 4. Parse (Lovable AI Gemini, structured output)
- Server function `parseVoicePlan` takes `{ transcript, mode, currentPlan, athleteRoster, moveLibrary }`:
  - `mode`: `"create"` (FAB on list) or `"edit"` (mic inside an existing plan).
  - In `edit` mode, current plan + moves are passed so the model can patch rather than replace.
  - `athleteRoster` and `moveLibrary` are sent as compact `{id, name}` lists so the model can resolve names to IDs.
- Uses `@ai-sdk/openai-compatible` → Lovable AI Gateway → `google/gemini-3-flash-preview` with `Output.object({ schema })`.
- Zod schema returns a `PlanDraft`:
  ```ts
  {
    title?: string,
    athleteId?: string | null,  // matched from roster
    athleteNameUnresolved?: string,  // if name spoken but not found
    notes?: string,
    moves: Array<{
      action: "add" | "update" | "remove",
      moveId?: string,         // for update/remove
      libraryMoveId?: string,  // if matched to existing library move
      name: string,
      description?: string,
      cue?: string,
      why?: string,
      targetKind: "reps" | "mins",
      targetValue: number,
      position?: number,
    }>
  }
  ```
- System prompt explicitly instructs: use roster IDs, prefer library matches, infer reps vs mins from phrasing ("20 reps", "5 minutes"), keep cues short, never invent athletes.

### 5. Apply & diff-highlight (auto-apply)
- Client receives `PlanDraft`. Behavior:
  - **Create mode**: a new draft plan is created server-side (reusing existing `createPlan`), `PlanDraft` is applied to it, the editor sheet opens at that plan.
  - **Edit mode**: changes are applied to the current open plan in-place via existing `updatePlan`, `updatePlanMove`, `addLibraryMovesToPlan`, `removePlanMove`, `reorderPlanMoves`.
- Every field/move touched by voice gets a transient `data-voice-touched` flag stored in component state (NOT in DB) keyed by field path. The flag drives a `pen-highlight` underline + soft `--accent-wash` background. Flag clears when the coach edits that field, or on a global "Looks good" tap.
- A slim approve bar slides up from the bottom of the editor:
  - Caveat label: *"From your voice — tweak anything, then approve"*
  - Counter: *"4 fields, 3 moves"*
  - `Approve` button (pen-filled) → clears all highlights.
  - `Undo` ghost button → reverts to pre-voice snapshot.
- Unresolved athlete names show inline as a `Pick athlete` chip rather than guessing.

### 6. Errors & edge cases
- Mic permission denied → toast with one-tap "Open settings" hint.
- Transcript empty / under 1 s → toast *"Didn't catch that"*, no API calls.
- ElevenLabs 401/quota → toast *"Voice service unavailable"*, log full error server-side via `dbError` pattern.
- Lovable AI 429 → *"Too many requests, try again in a moment"*. 402 → *"Add credits to keep using voice"*.
- Parse returns zero moves and no field changes → toast *"Nothing actionable heard"*, keep transcript visible in a small `Show what I heard` accordion.

---

## Technical Details

### Files to add
- `src/lib/voice.functions.ts` — `transcribeVoice` (multipart upload to ElevenLabs) + `parseVoicePlan` (Lovable AI structured output). Both `createServerFn` + `requireSupabaseAuth`. Use `dbError` helper for sanitized errors.
- `src/lib/ai-gateway.server.ts` — provider helper (if not already present) per `ai-sdk-lovable-gateway`.
- `src/components/coach/voice-fab.tsx` — the mic FAB w/ recorder, states, waveform.
- `src/components/coach/voice-approve-bar.tsx` — bottom approve/undo bar.
- `src/hooks/use-voice-capture.ts` — encapsulates MediaRecorder + AnalyserNode + push-to-talk gestures (mouse + touch + keyboard space-bar fallback).
- `src/lib/voice-apply.ts` — pure client helper that takes a `PlanDraft` and produces an ordered batch of server-fn calls + a `touched` map for highlights.

### Files to modify
- `src/routes/_authenticated/coach.plans.index.tsx` — mount `<VoiceFab mode="create" />`.
- `src/routes/_authenticated/coach.plans.$planId.tsx` — mount `<VoiceFab mode="edit" planId={planId} />` in header cluster; wire `voice-touched` highlights into existing `MoveField` and plan-level fields; render `<VoiceApproveBar />`.
- `src/components/coach/move-field.tsx` — accept an optional `highlighted` prop that applies `pen-highlight` styling around the display state (no behavior change otherwise).

### Secrets
- New secret: `ELEVENLABS_API_KEY` (request via `add_secret` after user confirms the plan).
- `LOVABLE_API_KEY` — already provisioned.

### Server-fn boundaries
- `transcribeVoice`: accepts `FormData` (audio blob), returns `{ text }`. Server function (not server route) — called via `useServerFn`.
- `parseVoicePlan`: accepts `{ transcript, mode, planId? }`. Server-side loads roster + library + (if edit) current plan, calls Gemini, returns `PlanDraft`.
- All existing plan-write server fns are reused; no new write endpoints.

### Design system compliance
- FAB uses `bg-accent`, `text-accent-foreground`, `shadow-page`, `rounded-pill`.
- Diff highlight = existing `pen-highlight` utility + `--accent-wash` background, no new colors.
- Recording ripple animates with `--accent` at low opacity; waveform bars use `--accent-ink`.
- All copy uses Caveat for prompts ("Speaking…", "Catching that…", "From your voice"), Atkinson Hyperlegible for buttons.

### Out of scope (deliberately, for this iteration)
- No conversational back-and-forth agent (push-to-talk only).
- No saved voice transcripts in DB (transient only; coach can retake).
- No multi-language UI (Scribe call hardcoded to `eng`; can be lifted later).
- No streaming partial transcripts (batch is fast enough at ≤90 s).

---

## Open items I'll confirm during build
- Whether `coach.plans.index.tsx` already has a bottom nav that I need to offset the FAB above (will inspect when I get to that file).
- Whether the `Mic` icon already exists in the project's `lucide-react` imports or needs adding (it does — already in `lucide-react`).

Once you approve, I'll request the `ELEVENLABS_API_KEY` secret first, then build.