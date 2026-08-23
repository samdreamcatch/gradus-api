# Stop showing strangers' accounts — let the invite link do the identifying

Today, when a coach imports a schedule or adds an athlete, we search every Gradus account and show cards for possible matches — masked name, masked email, sport and level. Even masked ("Sasha W."), that lets anyone with a coach account type a name and learn a person exists, what sport they do, and roughly who their guardian is. Standard practice is to disclose nothing about an account the coach isn't connected to, and let the person on the other side prove who they are.

## Answers to your three questions

**Can we reuse the invite infrastructure?** Yes — it already does exactly this job. Every coach-added athlete gets a one-time claim link (`/g/<token>`) emailed to the address the coach typed. Whoever opens that link, signed in as *any* account, attaches the athlete to themselves. That's the connection mechanism; we don't need a match screen at all.

**What if the person's account uses a different email?** It still works, and this is the key point: the claim link is a secret, not an email check. If the coach types `mom@work.com` but the parent's Gradus login is `mom@gmail.com`, the email lands at the work address, she taps the link, signs in with her Gmail account, and the athlete lands on that account. No email equality required.

**Could the email carry the coach code instead?** It effectively already does — the claim token is stronger than a coach code, because it's single-purpose, scoped to one athlete, and identifies the coach too. A plain coach code (`/i/CODE`) is shareable and reusable, so it can't stand in for identity. Keeping the guardian claim token is the right call; if the recipient is an adult athlete rather than a parent, the same token routes them to the adult path.

**How do we know it's the same person?** We don't, and we shouldn't guess. Possession of the emailed link is the proof. The coach asserts an email; the person who reads that inbox confirms it. Name similarity is never treated as evidence.

## The change

The "match your lessons to athletes" review step goes away. Nothing about anyone else's account is shown to the coach — no name, no initial, no email, no sport, no level.

Per row, the server decides quietly:

- **Already on your roster** — attaches to that athlete, no duplicate, no card.
- **Anyone else** — a pending athlete record is created under the name and email the coach typed, and the claim link goes out. Identical behavior whether or not a Gradus account already exists at that address, so nothing is inferable from what the coach sees.
- **Name-only similarity is ignored completely.**

## Avoiding duplicate athletes at claim time

Since we no longer merge accounts up front, the merge moves to the claim page, where it's safe — the person is looking at their *own* athletes:

On `/g/<token>`, if the signed-in parent already has an athlete whose name matches the pending one, they see: "Is this your existing athlete, Leon Gillespie?" → **Yes, same athlete** links the coach to the existing record and discards the pending one; **No, add as new** keeps both. If there's no name match, it claims as it does today.

## What the coach sees

Both the import sheet and the "Add athlete" step in the lesson slot sheet go straight from the details form to the result:

- "Added to Wednesday 4:00pm" (existing roster athlete)
- "Invite sent to p••••@gmail.com — they'll appear once they accept"

## Technical notes

`src/lib/schedule-import.functions.ts`
- Delete `matchScheduleRows`, the `MatchCandidate` / `MatchResult` types, the `maskEmail` / `firstNameLastInitial` / `redactFullName` helpers, and the whole cross-account lookup block (guardian-email pool, `athletes`/`parent_profiles` by `user_id`, the `last_name` sweep, guardian names, `athlete_goals`).
- `commitScheduleImport` resolves the athlete server-side and drops the client-supplied `matchedAthleteId` from its input schema. Order per group: (1) reuse an athlete already in `coach_athletes` for this coach with a matching normalized first+last name; (2) otherwise create the pending athlete + `guardian_claim_token` + `coach_athletes` row and send `sendGuardianInvite`.
- `ImportOutcome.name` stays the name the coach typed; statuses become `created` | `linked` | `failed`.

`src/components/coach/schedule-import-sheet.tsx`
- Remove the match step, its mutation/state and the candidate list markup. Review → commit.

`src/components/coach/lesson-slot-sheet.tsx`
- Remove the match-review step from `NewAthleteForm`; submit goes straight to `addAthleteWithGuardian`.
- Remove `linkExistingAthleteToRoster` from `src/lib/coach-roster-mutations.functions.ts` — it links a client-chosen athlete id and is unreachable once the match UI is gone.

`src/lib/guardian.functions.ts` + `src/routes/g.$token.tsx`
- `getGuardianClaimSummary` additionally returns the claimer's own same-name athletes (id + full name — their own data) so the page can offer the merge choice.
- New `mergeGuardianClaim` server fn: given the token and one of *their own* athlete ids, move the coach link (`coach_athletes`, `coach_athlete_sports`, `athlete_lesson_slots`) from the pending athlete onto the existing one, then delete the pending row. Verify the target athlete belongs to the caller's parent profile before touching anything.

No schema changes.
