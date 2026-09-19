## What gets built

**1. Corpus file** — `scripts/voice-corpus.json`: ~12 cases, each with an id, the transcript text, the mode (create or edit), and what a good result looks like (expected move count range, whether a title/athlete is expected, whether a partial result is acceptable). Cases cover:

- clean 4–6 move figure-skating dictation with targets
- same content but rambling, with self-corrections ("no wait, make that thirty")
- targets spoken in mixed units (reps vs minutes) and vague ones ("a few minutes")
- move names that only fuzzy-match the library (misheard spins)
- an athlete name not on the roster (should surface as unresolved, not fail)
- a dictation with a title and notes but no moves
- one mid-sentence cut-off recording
- one 90-second-equivalent, 10+ move dictation
- an edit-mode dictation that changes two existing moves only

**2. Test seam** — export `slotTranscript` (and the existing `salvageSlots` / `extractJsonObject`) from `src/lib/voice.server.ts` for test use. No behaviour change.

**3. Runner** — `scripts/verify-voice.ts`, run with bun. For each corpus case it calls the structuring step with a fixed stub move library (no database), then prints a table: case id, moves returned, moves dropped, retry variant used, title, athlete name, and pass/fail against the case's expectation. Exits non-zero if any case produces zero moves where moves were expected.

**4. Offline unit tests** — `src/lib/voice.server.test.ts` covering the salvage path without any AI call: malformed move in the middle of a good list keeps the rest; code-fenced JSON is extracted; an entirely empty answer returns the `aiFailed` fallback rather than a silent empty plan.

## Notes

- The runner makes real model calls (one to three per case), so it is a manual verification script, not part of CI. The unit tests are deterministic and run with the normal test suite.
- Each case is run three times so intermittent failures show up as a rate, not a one-off.
- Transcription is out of scope here — it has been reliable; this exercises the structuring step, which is where the failures were.
- No database or schema changes.
