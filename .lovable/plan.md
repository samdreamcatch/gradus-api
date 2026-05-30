# Granola-style Voice-to-Plan Parsing

## Goal
Replace the current single-pass voice parser with a Granola-style pipeline that:
1. Slots each piece of what the coach said into the right structured field (title, athlete, move name/cue/why/target, etc.) instead of dumping into notes.
2. Records the verbatim transcript phrase behind every filled field, so the coach can verify what the AI heard.
3. Rewrites leftover spoken content into clean athlete/parent-facing notes — no filler, no AI prefix.

## What Granola actually does (in plain terms)
- **Segment, then slot.** Instead of asking the model to fill a whole template at once, the transcript is broken into intent chunks and each chunk is routed to the field it belongs to.
- **Template-aware prompting with examples.** The model sees each field's *purpose* and example inputs, not just a JSON schema — so rambling notes land in clean buckets instead of all in "Summary."
- **Source anchoring.** Every structured field links back to the transcript span it came from, so the user can see *why* the model placed something where it did and trust/edit it.

## New pipeline

```text
audio → ElevenLabs Scribe → transcript
                              │
                              ▼
           ┌─────────────────────────────┐
       1.  │  Slot pass (Gemini Flash)   │  one LLM call, structured output
           │  → fields + sourceQuote per │  few-shot prompt teaches the field
           │    field + leftover[]       │  mapping
           └─────────────────────────────┘
                              │
                              ▼
           ┌─────────────────────────────┐
       2.  │  Deterministic resolution   │  no LLM
           │  athlete name → roster id   │  normalize + Levenshtein on first name
           │  span offsets from quotes   │  case-insensitive substring search
           └─────────────────────────────┘
                              │
                              ▼
           ┌─────────────────────────────┐
       3.  │  Notes cleanup (Gemini)     │  second LLM call, only if leftover
           │  leftover (+ existing       │  produces athlete/parent-facing
           │  notes in edit mode) →      │  prose — no "Notes:" prefix, no
           │  clean prose                │  "um/uh/like" filler, no labels
           └─────────────────────────────┘
                              │
                              ▼
                       apply to DB
```

Per voice take: ~2 Gemini Flash calls (~$0.001-0.003). At 10-20 plans/week per coach that's ~$0.10-0.25/coach/month — negligible.

## Why this fixes today's failure mode
The current pipeline (`src/lib/voice.functions.ts:198-204`) catches any parse error and dumps the **raw transcript** into `notes`. That's how a 20-second voice take with five drills ends up as one wall of "um okay so for Sarah let's do twenty…" in the notes field. The new pipeline:
- Lowers the chance of parse failure (looser schema, few-shot examples, smaller per-field decisions).
- On the rare hard failure, returns `{ moves: [], notes: null }` instead of dumping raw text — better to surface "nothing landed" than ship ugly text to the athlete.
- Always runs leftover through the cleanup pass, so anything that *does* land in notes reads clean.

## Source-quote UI ("hover to see source")
Every field that voice filled gets a small **"From your voice"** affordance under it (Caveat font, accent-ink color). Tap it (mobile) or hover it (desktop) to reveal the exact phrase from the transcript that produced it:

> **Cue:** Keep racquet face closed
> *From your voice:* "...keep the racquet face closed, this is to fix that wristy contact..."

Implementation: inline reveal under the field — no popover/overlay machinery. Works the same on touch and mouse. Disappears when the coach clears the highlight (already wired via `clearMoveTouch` / `clearPlanTouch`).

## Notes cleanup behavior (coach's spec)
- **No prefix.** No "Notes:", no "AI noted:", no quotes. Reads as if the coach wrote it.
- **No filler.** Strip "um", "uh", "like", "you know", "okay so", "I mean", self-corrections.
- **Athlete/parent-facing voice.** Convert "I want her to focus on…" → "Focus on…" where natural.
- **Tight.** One short paragraph OR up to 3 short bullets.
- **Merge, don't append.** In edit mode, the cleanup pass receives the existing notes and produces a single combined result (no duplication, no contradiction).
- **Empty is fine.** If leftover is just filler, return empty string — better than ugly notes.

## Concrete changes

### `src/lib/voice.functions.ts` — full rewrite of the parse stage
- New `slotTranscript()` — one structured-output Gemini call with rich system prompt + 2 few-shot examples. Returns schema with `*Quote` fields per slot and a top-level `leftover` string.
- New `cleanupNotes()` — second Gemini call: leftover (+ existing notes in edit mode) → clean prose.
- New `resolveAthlete()` — deterministic TS: exact match → first-name match → starts-with → Levenshtein ≤ 2 on first name.
- New `locateQuote()` — finds quote char offsets in the transcript (case-insensitive, whitespace-collapsing); stores `{ start, end, quote }` per field.
- Non-destructive merge in edit mode: only overwrite a field when the slot pass returned a non-empty value.
- Hard fallback returns `{ moves: [], notes: null }` instead of dumping raw transcript.

### `src/lib/voice-touched-store.ts` — extend snapshot shape
Add (optional, back-compat):
- `transcript?: string`
- `sources?: { plan?: {...}, moves?: Record<string, {...}> }` with `{ start, end, quote }` spans.
Existing `plan` booleans and `moves` string-array shapes are unchanged.

### `src/components/coach/voice-fab.tsx`
- Update `onVoiceApplied` callback type to include the new `transcript` + `sources` fields.

### `src/components/coach/move-field.tsx`
- New optional prop: `sourceQuote?: string`.
- When `highlighted && sourceQuote`, render a small "From your voice" link under the display button. Click toggles inline reveal of the quote.

### `src/routes/_authenticated/coach.plans.$planId.tsx`
- Read `touched.sources` and pass the right quote to each `MoveField` and plan-level field's `sourceQuote` prop.
- Merge `sources` in the in-place `onVoiceApplied` handler the same way `touched.moves` is merged today.

## Out of scope (deferring deliberately)
- Embeddings-based move/library resolution. Levenshtein is enough for current roster sizes; revisit if it misses.
- Streaming/partial transcription.
- Multi-turn voice ("undo that last move").

## Open items resolved with the coach
- **Cost at scale:** ~$0.001-0.003 per take, ~$0.25/coach/month max at 20 plans/week — fine.
- **Source UI:** inline reveal under each highlighted field (not a hover popover), works on touch and mouse.
- **Notes cleanup:** no prefix, no filler, athlete/parent-facing — implemented in `cleanupNotes()`.
