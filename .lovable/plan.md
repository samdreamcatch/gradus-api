# Connection Experience — Plain-English Audit & Test Plan

## Who can connect to whom

Four kinds of people use Gradus:

- **Coach** — runs a roster of athletes.
- **Parent** — manages one or more of their kids on the platform.
- **Child athlete** — a kid whose account is set up by their parent.
- **Adult athlete** — someone training for themselves (no parent involved).

Every connection is a two-sided handshake. When a link is made, **both sides**
should see a celebration modal ("You're connected with…") the next time they
open the app. Each side dismisses their own modal independently.

## Every way a connection can be made today

| Who starts it | How it happens | Who celebrates |
|---|---|---|
| **Parent adds a coach** (in Settings) | Parent types the coach's 8-character invite code, picks which sports | Parent + Coach |
| **Parent adds a coach during signup** | New parent visits a `?invite=…` link from a coach, or types the code during signup | Parent + Coach |
| **Coach adds a parent's whole family** | Coach types a parent's invite code — links every kid the parent has | Coach + Parent |
| **Coach adds an adult athlete** | Coach types the adult athlete's invite code | Coach + Adult athlete |
| **Coach signs up from an adult athlete's invite link** | New coach visits `/signup/coach?invite=…` from an adult athlete | Coach + Adult athlete |
| **Parent creates a child athlete account** | Parent generates a code, kid uses it to sign up | *Nobody* (see gap #1) |

There is **no way today** for an adult athlete to initiate a connection to a
new coach — they can only hand out their code and wait for the coach to use
it. Worth confirming that's intentional.

## How the celebration modal decides what to show

- **Coach side** groups siblings under one parent into a single modal
  ("You're connected with Alex & Jamie!"). Adult athletes each get their own.
- **Parent side** groups by coach — if a coach gets linked to two of your kids
  in one action, you see one modal covering both.
- **Adult athlete side** — one modal per coach.
- Dismissing on one side doesn't dismiss the other side.
- If someone unlinks before the other side has seen their celebration, that
  celebration silently goes away.

## Gaps we found

1. **Child athletes never see a celebration.** If a parent links a new coach,
   the parent sees the celebration and the coach sees the celebration, but
   the kid opens the app and sees nothing. If we want kids to see
   "You're connected with Coach Tami!", we need to add it.
2. **Parent signup shows the celebration right after the wizard.** A parent
   who joined via a coach's invite link just finished a wizard that said
   "You're connected." Then they land on their plans page and see a modal
   saying the same thing. Might feel redundant — decide whether to skip it
   in this case.
3. **Same duplication for coaches** who sign up from an adult athlete's
   invite link.
4. **Silent cleanup on unlink.** If a coach removes an athlete before the
   parent has seen the celebration, the parent's celebration disappears
   without a trace. Probably fine, but flagging it.

## Test plan (how to walk through every path in dev)

The dev tools panel (wrench icon, top-left corner) lets you switch accounts
and reset onboarding without signing out. Seeded test accounts:

- `coach@test.dev` — Tami Taylor (a coach)
- `parent@test.dev` — parent of Jamie
- `parent2@test.dev` — parent of Beverly
- `athlete@test.dev`, `athlete6@test.dev` — Tami's kid athletes
- `adult-athlete@test.dev` — Dani California (adult athlete)

### Path A — Parent adds an existing coach
1. Sign in as Tami, go to Coach Settings, copy her invite code.
2. Switch to a parent with no coach yet. Go to Parent Settings, open an
   athlete, "Add coach by code", paste, pick sports, link.
3. **Expect:** parent immediately sees the celebration modal.
4. Switch back to Tami. **Expect:** Tami sees a celebration modal with the
   newly-linked athletes grouped together.
5. Dismiss both, reload each. **Expect:** the modals stay dismissed.

### Path B — Parent signs up from a coach's invite link
1. As Tami, copy the invite code.
2. Sign out, open `/signup/parent?invite=<CODE>` in a fresh session.
3. Finish the parent signup wizard.
4. **Expect:** parent lands on their plans page and sees the celebration
   (unless we decide to skip it — see gap #2).
5. Switch to Tami. **Expect:** celebration with all the new athletes grouped.

### Path C — Coach adds a whole family via parent code
1. Sign in as a parent with no coach. Copy their parent invite code.
2. Switch to a coach with no link to that parent. Add the parent by code.
3. **Expect:** coach sees one grouped modal covering every kid. Parent sees
   the celebration on their next visit.

### Path D — Coach adds an adult athlete
1. Sign in as Dani (adult athlete), copy her invite code.
2. Switch to a coach with no link to Dani. Add her by code.
3. **Expect:** coach sees celebration for Dani, Dani sees celebration for
   the coach.

### Path E — Coach signs up from an adult athlete's invite link
1. Copy Dani's invite code.
2. Sign out, open `/signup/coach?invite=<CODE>`, finish coach signup.
3. **Expect:** coach lands on their home page and sees the celebration.
   Switch to Dani, **expect** celebration.

### Path F — Child athlete signs up (no celebration today)
1. As a parent, use dev tools "Mint code → Confirm screen" to create a kid
   invite and jump to their signup page.
2. Finish the athlete account creation.
3. Sign in as the new kid. **Expect today:** nothing. Track as gap #1 if we
   want to add it.

### Path G — Sibling grouping on the coach side
1. Unlink Jamie and Beverly from Tami's roster.
2. As their parent, add Tami back in one go.
3. **Expect:** Tami sees a single modal like "You're connected with
   Jamie & Beverly!"

### Path H — Unlink and re-link
1. Make a fresh connection, but don't dismiss the coach's celebration.
2. As the parent, unlink the coach.
3. Sign in as the coach. **Expect:** no stale modal.
4. Re-link. **Expect:** a brand new celebration.

## Dev tooling gaps to close before running these

- No one-click way to unlink a coach ↔ athlete pair — today you have to dig
  into Settings. Would be handy to add "Reset all my connections" to dev tools.
- No pre-seeded "parent with no coach" account — Path A currently requires
  resetting an existing parent partway through.
- No pre-seeded "coach with an empty roster" — Path C needs one.
- Dev tools can mint child-athlete invite codes but not adult-athlete or
  coach invite codes. Nice-to-have for Paths D and E.
