# Connection Experience — Audit & Test Plan

## Actors

- **Coach** (`coach_profiles`, has `coach_invite_codes`)
- **Parent** (`parent_profiles`, has `parent_invite_codes` + per-athlete `athlete_invite_codes`)
- **Child Athlete** (`athletes` with `parent_id`, no `user_id` until claimed)
- **Adult / self-managed Athlete** (`athletes.self_managed = true`, own `user_id`, has `adult_athlete_invite_codes`)

Every connection is a row in `coach_athletes` (link) with two ack timestamps: `coach_ack_at` (coach side celebration) and `other_ack_at` (parent/athlete side celebration). The `ConnectionCelebration` modal reads pending rows via `getPendingConnectionCelebrations` and marks them acked via `acknowledgeConnection`.

## Connection matrix — who can initiate what

| Initiator → Target | Mechanism | Server fn | Writes | Celebration surfaces on |
|---|---|---|---|---|
| **Parent → Coach** (link existing athletes) | Parent enters coach's 8-char code in Settings → picks sports | `previewCoachByInviteCode` + `linkAthleteToCoach` (`parent-settings.functions.ts`) | `coach_athletes`, `coach_athlete_sports` | Coach (roster), Parent (self) |
| **Parent → Coach** (during parent signup) | `/signup/parent` `?invite=CODE` or entered manually; auto-links every athlete created in wizard | `createParentAthletes` + inline code lookup (`parent-signup.functions.ts:270–327`) | `coach_athletes`, `coach_athlete_sports` (all coach's sports) | Coach, Parent |
| **Coach → Parent** (post-signup claim) | Coach enters parent's invite code | `claimParentInvite` (`parent-signup.functions.ts:767`) | `coach_athletes` for every athlete under parent, `coach_athlete_sports`, backfills `athlete_goals.coach_id` + `athlete_lesson_slots.coach_id`, sets `athlete_primary_coaches` | Coach, Parent |
| **Coach → Adult Athlete** (post-signup claim) | Coach enters adult-athlete's invite code | `claimAdultAthleteInvite` (`adult-athlete-invite.functions.ts:130`) | `coach_athletes`, `coach_athlete_sports`, `athlete_primary_coaches` | Coach, Adult Athlete |
| **Coach → Adult Athlete** (during coach signup) | `/signup/coach` `?invite=CODE` from adult athlete link | `getAdultAthleteByInviteCode` preview + link at signup finish (in `adult-athlete-signup.functions.ts` — `coach_athletes` insert lines 231–243, 447, 478, 553) | same as above | Coach, Adult Athlete |
| **Parent → Child Athlete** (create) | Parent generates per-athlete code in Settings → athlete uses it at `/signup/athlete` | `athlete-signup.functions.ts` claims the pre-created `athletes` row (line 85) and attaches `user_id` | `athletes.user_id`, `athlete_users` | — (no celebration; there's no roster row change) |
| **Coach → Child Athlete** | Not direct. Only via the parent above. | — | — | — |

There is **no path** for an Adult Athlete to initiate a link to a Coach they don't already have a code for (adult athletes give their code out; coaches claim it). Confirm this is intentional before shipping.

## Celebration surfacing rules (per `ConnectionCelebration`)

Mounted at each role's layout:
- `src/routes/_authenticated/coach.tsx` → `role="coach"`
- `src/routes/_authenticated/parent.tsx` → `role="parent"`
- `src/routes/_authenticated/athlete.tsx` → `role="adult-athlete"`

Grouping:
- **Coach view** groups by parent (so 2 siblings under one parent = 1 modal saying "You're connected with Alex & Jamie"). Self-managed athletes group by athlete.
- **Parent view** groups by coach (so linking a coach to 2 kids in one action = 1 modal). Shows `roomId` if the message room already exists.
- **Adult-athlete view** — one modal per coach link, no grouping needed.

Ack is one-directional per side: coach dismissing does not ack the parent side and vice versa. Unlinking (`unlinkAthleteFromCoach`, `removeAthleteFromRoster`) deletes the `coach_athletes` row, so a pending unacked celebration silently disappears.

## Known gaps found while auditing

1. **Child-athlete never celebrates.** A child athlete signing in after their parent linked a coach sees no modal — `getPendingConnectionCelebrations` only handles `self_managed` athletes. If we want kids to see "You're connected with Coach Tami!", the athlete branch needs to drop the `self_managed` filter (and layout needs to mount `<ConnectionCelebration role="…">` at `_authenticated/athlete` with a role that isn't `adult-athlete`).
2. **Parent-signup path auto-acks nothing.** After `/signup/parent?invite=…` the parent lands on `/parent/plans` and immediately sees the celebration modal for the coach they just entered. That's arguably duplicative with the signup wizard's own "connected" confirmation — decide whether to auto-ack `other_ack_at` when the link is created in-wizard.
3. **Coach-signup with `?invite=` (adult athlete)** — same duplication risk: coach finishes onboarding and immediately sees the celebration for the athlete they just claimed.
4. **`removeAthleteFromRoster` doesn't rotate `other_ack_at`.** If a coach unlinks before the parent has acked, the parent's celebration for that link vanishes silently. Probably fine, but worth logging.

## Dev-mode test plan

DevTools (`Wrench` button, top-left) already has an account switcher, onboarding reset, and athlete-invite minter. Seeded accounts (from `dev-accounts.ts`):

- `coach@test.dev` — Tami Taylor
- `parent@test.dev` — Parent of Jamie
- `parent2@test.dev` — Parent of Beverly
- `athlete@test.dev` / `athlete6@test.dev` — Tami's child athletes
- `adult-athlete@test.dev` — Dani California (self-managed)

### Path A — Parent adds Coach in Settings (existing parent + existing coach)
1. DevTools → sign in as **Tami (coach)**. Navigate to `/coach/settings` → copy invite code.
2. DevTools → sign in as a **fresh parent** (reset onboarding on `parent2@test.dev`, or seed a new one). Complete signup without a code.
3. Go to `/parent/settings`, expand an athlete → "Add coach by code" → paste code → pick sports → link.
4. **Expected:** parent immediately sees celebration modal ("You're connected with Tami Taylor!") on `/parent/plans`.
5. DevTools → back to Tami. **Expected:** coach celebration modal on `/coach` (grouped by parent, showing all newly-linked athletes).
6. Dismiss both. Reload each. **Expected:** modal does not re-appear.

### Path B — Parent signs up with `?invite=CODE`
1. Sign in as Tami, copy invite code.
2. Sign out. Open `/signup/parent?invite=<CODE>` in a private window (or DevTools → reset onboarding on a parent account and re-enter the wizard).
3. Complete parent → athletes → goals → schedule.
4. **Expected:** Parent lands on `/parent/plans`, celebration fires for Tami (unless we decide to auto-ack — see gap #2).
5. Switch to Tami → celebration fires with all newly-created athletes grouped.

### Path C — Coach claims Parent invite code
1. Sign in as a parent that has at least 1 athlete but no coach. Copy parent invite code (Settings → Invite a coach).
2. Sign in as a coach with no link to that parent (reset Tami's link, or use a fresh coach account).
3. Coach Settings → "Add parent by code" flow → paste code → confirm.
4. **Expected:** coach celebration groups all of that parent's athletes into one modal. Parent celebration fires on next parent visit.

### Path D — Adult athlete → Coach
1. DevTools → sign in as `adult-athlete@test.dev`. Go to Settings → copy adult-athlete invite code.
2. Sign in as a coach with no existing link. Settings → "Add adult athlete by code" (or `/signup/coach?invite=<CODE>` for the signup-time variant).
3. **Expected:** coach celebration for Dani; adult-athlete celebration for the coach.

### Path E — Coach signs up with `?invite=CODE` (adult athlete-initiated)
1. Copy adult athlete code as in D.
2. Sign out. Open `/signup/coach?invite=<CODE>`. Complete coach signup + onboarding.
3. **Expected:** Coach lands on `/coach`, celebration fires. Sign in as adult athlete → celebration fires.

### Path F — Child athlete signup (no celebration expected today)
1. Sign in as parent, DevTools → "Mint code → Confirm screen" (creates unclaimed athlete + code, jumps to `/signup/athlete/confirm?code=…`).
2. Complete `/signup/athlete/account`.
3. Sign in as the new athlete. **Expected today:** no celebration modal. **Track as gap #1** if we want to change that.

### Path G — Sibling grouping (coach side)
1. Reset Tami's roster (unlink Jamie & Beverly via `/coach/roster` → athlete detail sheet → remove).
2. Sign in as `parent@test.dev` (parent of Jamie & Beverly if they're under the same parent, otherwise use `?invite` to add Tami during a fresh parent signup with 2 athletes).
3. Add Tami by code. **Expected:** coach sees a single modal grouping both siblings ("You're connected with Jamie & Beverly!").

### Path H — Idempotency + unlink cleanup
1. Establish a link (any path above), do NOT ack on the coach side.
2. As parent, unlink the coach from Settings → athlete disclosure → coach row → "Unlink".
3. Sign in as coach. **Expected:** no stale celebration modal (row deleted).
4. Re-link. **Expected:** brand new pending celebration appears.

### Dev harness gaps to close before running the matrix
- No dev button to **unlink** a coach ↔ athlete pair without navigating deep into Settings. Consider adding a "Reset all my links" utility to `dev-tools.tsx` scoped to the current user.
- No dev seed for a **parent with no coach yet** — Path A currently requires resetting `parent2@test.dev` mid-run. Add a `parent-nolink@test.dev` seeded account.
- No dev seed for a **coach with no roster** — Path C needs a fresh coach. Add `coach-empty@test.dev`.
- `mintDevAthleteInvite` covers child-athlete signup but there's no equivalent `mintDevAdultAthleteInviteCode` / `mintDevCoachInviteCode` dev shortcut for pasting codes. Nice-to-have for Path D/E.

## Technical notes

- Grouping and ack logic all live in `src/lib/connection-celebration.functions.ts`.
- Modal UI: `src/components/connection-celebration.tsx` + the design mocks at `/coach/celebration-preview`.
- Any change to link creation must set `coach_ack_at` / `other_ack_at` to `NULL` (the default) — some future admin backfill should not accidentally set both to `now()`.
- If we add child-athlete celebrations, the athlete layout needs a distinct `role` value ("child-athlete"?) and the server fn must branch on `athletes.user_id = auth.uid()` regardless of `self_managed`.
