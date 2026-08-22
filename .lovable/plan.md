# Stop showing strangers' accounts in the match step

Today, when a coach imports a schedule or adds an athlete, we look across every Gradus account and show cards for possible matches — masked name, masked email, sport and level. Even masked ("Sasha W."), that lets anyone with a coach account type a name and learn that a person exists, what sport they do, and roughly who their guardian is. Standard practice is to disclose nothing about an account the coach isn't connected to, and let the person on the other side consent first.

## The change

The "match your lessons to athletes" review step goes away entirely. Nothing about anyone else's account is shown to the coach — no name, no initial, no email, no sport, no level.

Instead the server decides quietly, per row:

- **Already on your roster** — the row attaches to that existing athlete. No duplicate is created, no card is shown.
- **The email you typed already has a Gradus account** — we do not create a second athlete record and we do not tell the coach an account exists. We send that email the same invite as always; when the person accepts, they land on their existing account and the connection to this coach becomes real. Until they accept, the coach sees the athlete under the name and email *they* typed, marked pending.
- **No email, or an email we've never seen** — a pending athlete record is created and invited, exactly as today.
- **Name-only similarity is ignored completely.** A typed name is a guess, not proof, and acting on it is how a directory gets scraped. Two people with the same name stay separate until an email or an accepted invite connects them.

The coach's end state is unchanged: their lessons land on the calendar, their roster fills in, and the invite goes out. The only difference is they no longer see a screen listing people they don't know.

## What the coach sees instead

Both the import sheet and the single "Add athlete" step in the lesson slot sheet go straight from the details form to the result. The result summary says one of:

- "Added to Wednesday 4:00pm" (existing roster athlete)
- "Invite sent to p••••@gmail.com — they'll appear once they accept" (pending, whether or not an account already existed)

That wording is identical for "account exists" and "account doesn't exist", so nothing about the other person is inferable from it.

## Technical notes

`src/lib/schedule-import.functions.ts`

- Delete `matchScheduleRows` and the `MatchCandidate` / `MatchResult` types, plus the now-unused `maskEmail`, `firstNameLastInitial`, `redactFullName` helpers and the cross-account lookup block (guardian-email pool, `parent_profiles` / `athletes` by `user_id`, the `last_name` sweep, guardian names, `athlete_goals`).
- `commitScheduleImport` resolves the athlete itself and no longer trusts a client-supplied `matchedAthleteId` — drop that field from the input schema. Resolution order per group, all via `supabaseAdmin`:
  1. Athlete already in `coach_athletes` for this coach whose normalized first+last name matches → reuse.
  2. Otherwise, if an email was given, look up an existing athlete reachable from that email (athlete `guardian_email`, the athlete's own `user_id` account, or a `parent_profiles` row for that account) **scoped to that one email**. If found, insert a `coach_athletes` row with `coach_ack_at` set and `other_ack_at` null (pending, awaiting their approval) against the existing athlete id, and send the invite. Never surface the found athlete's fields in the response.
  3. Otherwise create the pending athlete + `guardian_claim_token` + invite, as today.
- `ImportOutcome.name` stays the name the coach typed. New status set: `created` | `pending` | `linked` (roster reuse only). Never echo a resolved athlete's stored name.

`src/components/coach/schedule-import-sheet.tsx`

- Remove the match step, its `useMutation`/state, the candidate list UI and the "Matches an existing Gradus account" / "Not connected yet" markup. Review step → commit directly.

`src/components/coach/lesson-slot-sheet.tsx`

- Remove the match-review step from `NewAthleteForm`; submitting goes straight to create/invite.
- `linkExistingAthleteToRoster` in `src/lib/coach-roster-mutations.functions.ts` is no longer reachable from the UI (it links an arbitrary athlete id chosen client-side) — remove it.

No schema changes; the pending-connection semantics already exist via `coach_athletes.other_ack_at`.
