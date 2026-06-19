Generate a single markdown reference doc at `/mnt/documents/voice-and-move-matching-catalog.md` that surfaces the two code surfaces you want to review. No code changes.

## Doc structure

### Part 1 — Voice-to-text (audio in → structured plan/session output)

Cover the full pipeline, file by file, with line ranges and verbatim excerpts for the important parts:

- **`src/hooks/use-voice-capture.ts`** (211 lines) — browser `MediaRecorder` lifecycle, mime-type selection, blob assembly, upload trigger.
- **`src/components/coach/voice-fab.tsx`** (311 lines) — the floating voice button: recording state, UI, calls `use-voice-capture`, dispatches results to the plan/session forms.
- **`src/lib/voice-touched-store.ts`** (27 lines) — shared store tracking which fields the voice flow has filled (so manual edits aren't clobbered).
- **`src/lib/voice-types.ts`** (45 lines) — DTOs returned by the voice server functions (verbatim).
- **`src/lib/voice.functions.ts`** (137 lines) — `createServerFn` entrypoints called by the client: upload + transcription orchestration, loads the coach's move library, hands off to `voice.server.ts` extractor.
- **`src/lib/voice.server.ts`** (709 lines) — the AI core:
  - Zod schema for extracted moves (incl. `matchExistingMoveId`).
  - System/user prompt construction (CREATE vs EDIT mode), library injection at line ~157.
  - `generateObject` call against the Lovable AI Gateway.
  - DB write path: upserts plan moves, reuses library move when matched (lines ~572–667).
- **`src/components/dev/dev-tools.tsx`** — dev-only voice helpers (brief mention).
- **Audio storage**: `voice-notes` Supabase bucket (referenced from voice.server / voice.functions).

For each file: purpose, where it's called from, key inputs/outputs, the AI model and Gateway endpoint used, and any caching/freshness behavior.

### Part 2 — Matching custom moves against the library

This logic lives almost entirely inside the voice pipeline, not in the move CRUD UI. Cover:

- **`src/lib/voice.server.ts`**:
  - `levenshtein(a, b)` (line 200) — verbatim helper.
  - `resolveLibraryMove(spoken, library)` (line ~261) — three-pass matcher: exact, prefix/substring, then bounded Levenshtein distance on the first word. Verbatim.
  - Prompt instruction at lines 148–149 telling the model when to set `matchExistingMoveId` (EDIT vs CREATE mode).
  - `KNOWN MOVES (library, name — category)` block injected into the prompt at lines 157–159 (capped at 150 entries).
  - Post-extraction reconciliation at lines ~402–412: prefers the model's `matchExistingMoveId`; falls back to `resolveLibraryMove` on the spoken name.
  - `mergeAppend` (line ~292) — how matched-library copy is merged with newly-spoken copy (description/cue/why).
  - DB write path (lines ~572, ~636–667): when matched, updates the existing `moves` row and links `plan_moves.move_id` to the library move id.
- **`src/lib/voice.functions.ts`** lines 89–132 — how the coach's library is loaded from `moves` and passed to the extractor as the `LibraryMove[]` context.
- **`src/components/coach/move-field.tsx`** + **`src/components/coach/move-sheet.tsx`** — note explicitly that these are CRUD-only and do NOT do fuzzy matching; the "duplicate" action (move-sheet.tsx ~201) is a literal copy, not a similarity match.
- **`src/lib/moves.functions.ts`** — note that library seeding (`seed_coach_library` RPC at line 81) populates the candidate set the matcher draws from; no client-side similarity logic here either.

### Format

- One section per part, with a short overview and a table of files.
- Per-file subsections with: path, line count, role, callers, and verbatim code excerpts for the matching-critical functions (`levenshtein`, `resolveLibraryMove`, `mergeAppend`, the prompt block, the reconciliation loop, the DB write).
- Cross-references between the two parts (the matcher only runs inside the voice flow).
- A short closing "Gaps / notable risks" section flagging:
  - 150-move library cap in the prompt (silent truncation).
  - First-word Levenshtein on `resolveLibraryMove` — collapses "Forehand crosscourt" and "Forehand down the line" to the same first-word match.
  - No matching surface in manual move creation — coaches typing a new move that already exists in their library get no suggestion.

### Out of scope

- No code changes.
- No coverage of unrelated AI prompts (Ask Gradus, pre-lesson briefing, coach athlete summary) — those live in the existing `/mnt/documents/ai-prompts-catalog.md`.
- No edits to that prior catalog.