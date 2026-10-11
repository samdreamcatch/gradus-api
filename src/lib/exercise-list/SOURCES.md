# Open exercise list: sources

`exercises.json` is step 2 of the AI move-draft lookup (PRD decision #53):
the Gradus library first, then this list, then the model's own recognition
check. It holds **facts only**. Regenerate it with
`bun scripts/import-exercise-list.ts`; the script pins the upstream commits
below, so a re-run reproduces the file byte for byte until someone bumps them.

## Where the facts come from

| Repository | Pinned commit | File | License |
|---|---|---|---|
| [yuhonas/free-exercise-db](https://github.com/yuhonas/free-exercise-db) | `f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5` | `dist/exercises.json` | Unlicense |
| [exercemus/exercises](https://github.com/exercemus/exercises) | `0ee5b742928b0c910883fa1c0c2cfaf26c4ee180` | `exercises.json` | MIT for the code; a few entries carry their own license |

free-exercise-db is a restructured copy of
[wrkout/exercises.json](https://github.com/wrkout/exercises.json) (Unlicense),
and almost every exercemus entry is one of those same exercises, so the three
repositories are effectively one list of about 870 gym exercises. The import
keeps free-exercise-db's version when a name appears in both, adds
exercemus's aliases to it, and keeps the 13 exercemus entries whose names
don't match anything in free-exercise-db (machine and bench-press variants).
The result is 888 exercises.

## What is imported

Per exercise: `name`, `aliases`, `category`, `equipment`, `primaryMuscles`,
`secondaryMuscles`, and, where free-exercise-db has them, `force`,
`mechanic` and `level`. Muscle and equipment names are mapped onto
free-exercise-db's vocabulary ("abs" becomes "abdominals"). These are facts
about an exercise (what it is called, what it uses, what it works), which
copyright doesn't cover.

## What is deliberately not imported

- **`instructions`, `description` and `tips`.** The instruction text in these
  repositories matches Bodybuilding.com's exercise pages almost word for word
  (free-exercise-db's "Barbell Full Squat" opens with the same sentence as
  Bodybuilding.com's Barbell Full Squat page, about doing the lift inside a
  squat rack), and Bodybuilding.com's terms don't allow reuse. The Unlicense
  on the repositories can't grant rights their authors didn't hold, so none
  of that text is stored, shown, or sent to the AI model. The model gets the
  facts above and writes its own description, cue and why.
- **`images` and `video`.** The wrkout maintainer says the images were scraped
  and shouldn't be used commercially. Gradus moves are text only anyway.
- **Entries with their own `license` field.** exercemus has one entry from
  wger.de under CC-BY-SA 3.0 ("Dumbbell Skullcrusher"); share-alike terms
  don't fit a closed app, so the import skips any entry carrying a license.
- **`variation_on`, `tempo`, ids and the `exercises_to_merge` section** of
  exercemus, which the drafts don't need.

`exercise-list.test.ts` fails if the committed file ever contains one of the
excluded fields or a licensed entry.
