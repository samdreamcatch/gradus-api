# Reducing signup friction without losing parent transparency

## The real problem

Two different frictions are being conflated:

1. **Athlete friction** — a minor hits "Are you 18 or older?" and lying is the fastest path to using the app. The gate asks for a *claim*, not a *fact*, and rewards the wrong answer.
2. **Coach friction** — a coach can only grow their roster by convincing a *third party* (the parent) to download an app, create an account, and enter a code. The coach is blocked on someone who isn't in the room.

Parent transparency is the non-negotiable. The goal is to move the parent from **a blocker in the signup path** to **a notified party who can upgrade to a full account whenever they want**.

## Recommended direction: "Guardian on file, not guardian in app"

The single highest-leverage change: **stop requiring a parent account to exist before an athlete can be active.** Require a *guardian email address* instead. That email address becomes the transparency mechanism immediately (copies of coach communications, plans, session activity) and becomes an account the moment the parent clicks a link in any of those emails.

This is a smaller change than it sounds, because the pieces already exist: athletes already support a null parent, parent invite codes already exist, and transactional email already sends.

### What each person experiences

**Under-18 athlete signing up alone**
- Replace the "Are you 18 or older?" yes/no question with a date-of-birth field. A date is a fact; a yes/no is an invitation to lie.
- Under 18 → one extra field: "Parent or guardian email." That's the whole added friction. They continue straight into the app with a coach code, plans, everything.
- The parent gets an email: "Your athlete joined Gradus with Coach X. Here's what they're doing. Create your free account to see everything." No code to type — the link claims the athlete.

**Coach adding a youth athlete**
- New "Add athlete" on the roster: first name, last name, birthdate, guardian email. The athlete is on the roster instantly; the coach is never blocked.
- The guardian gets an email: "Coach X added your athlete to Gradus." with a claim link.
- The athlete gets a join link/code from the coach as they do today.

**Parent who never registers**
- Receives email copies of coach→athlete messages and a weekly digest (plans assigned, sessions logged, lessons confirmed). Every email carries the claim link and an unsubscribe-from-digests option (never from safety-relevant notices).
- Transparency holds without a download. This alone removes most of the coach's argument that parent onboarding is too much friction.

### Handling the 30-day idea

A hard 30-day lockout punishes the athlete for the parent's inaction and creates support tickets. Recommend a **nudge ladder with one soft gate** instead:

- Day 0–30: full access, in-app banner "Parent not connected yet — resend invite."
- Day 30+: still full access for training (plans, sessions, resources), but **messaging with the coach becomes parent-visible-or-nothing**: it keeps working while emails are being delivered, and pauses only if the guardian email hard-bounces or unsubscribes. Bad email address is the actual risk; elapsed time isn't.
- Coaches see a "Guardian pending" chip on the roster row so accountability is visible to the person who can fix it fastest.

### Anti-abuse, kept light

- Birthdate is written once and locked (already true for adults). Changing it later is a support action.
- Guardian email can't equal the athlete's own email.
- Coach-entered guardian emails are logged with the coach as actor, so a pattern of fake guardian addresses is visible in the admin panel.

## Options considered and why not

| Option | Verdict |
| --- | --- |
| Keep the 18+ yes/no gate, add scarier warnings | Doesn't work — the incentive to lie is unchanged. |
| Require parent account before athlete is active (today) | Highest transparency, highest drop-off. This is the status quo that's failing. |
| Athlete active, parent required within 30 days or lockout | Punishes the wrong person; creates dead accounts and support load. |
| **Guardian email on file + email mirroring + claim link** | **Recommended.** Near-zero added friction, transparency from day one, parent converts on their own schedule. |
| Coach-added athletes with no guardian at all | Fails the transparency requirement outright. |

## Technical shape (for reference)

- `athletes`: add `guardian_email`, `guardian_email_verified_at`, `guardian_claimed_at`, `guardian_invited_at`. Relax the 18+ trigger so a minor row is valid when `guardian_email` is present and `parent_id` is null.
- Athlete signup: swap the age question for date of birth; branch to a guardian-email field for minors. Reuse the existing coach-code linking path unchanged.
- Coach roster: new `addAthleteWithGuardian` server function (coach-scoped, respects existing roster caps).
- Claim flow: reuse `parent_invite_codes` machinery behind a tokenized email link, so a parent who clicks lands in the normal parent signup with the athlete pre-attached.
- Email: new templates (guardian invite, message copy, weekly digest) in the existing registry; digest via the existing cron pattern.
- Admin: guardian status column and a "guardian pending / bounced" filter.

## Suggested rollout

1. Date of birth replaces the 18+ question, guardian email for minors, guardian invite email + claim link.
2. Coach "Add athlete" with guardian email.
3. Email mirroring of coach communications and the weekly digest.
4. Nudge ladder, bounce handling, admin visibility.
