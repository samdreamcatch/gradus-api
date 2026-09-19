# Verify the voice plan pipeline on real dictations

The structuring fix is in, but so far it has been checked against one recording. This plan builds a repeatable way to run a spread of realistic dictations through the same code path the app uses, and to see exactly what each one produced.

Two parts:

1. **A dictation corpus** — a set of written transcripts that mirror how coaches actually talk: clean multi-move dictations, rambling ones, half-finished sentences, moves with no target, unknown athlete names, mumbled or misheard move names, plans with no moves at all, and one very long multi-move dictation.
2. **A runner** — a script that feeds each transcript through the real structuring step and prints a per-case report: moves produced, moves salvaged, moves dropped, title, athlete match, and whether it fell back to the simplified retry.

Nothing about the app's behaviour changes. This is verification only; no database writes and no plans created.
