# Connect a coach later — elegant follow-up

## The mechanism (already built, just surfaced in more places)

When a parent signed up without an invite code, the system already mints them a personal 8-character invite code and a shareable URL of the form `/signup/coach?invite=CODE`. When any coach signs up through that link (or pastes the code on their roster), they're auto-linked to all of the parent's athletes, sports, goals, and lesson times.

This is the most elegant mechanism for the current app because:
- It mirrors how coach-initiated parent signup already works (one code, one link).
- It requires zero email/SMS plumbing — the parent shares it on whatever channel they already use with their coach.
- A coach who's already on Gradus can claim the parent from their own roster page without a re-signup.

We don't need a new mechanism. We need to make it findable from anywhere in the app, not just the dashboard.

## Where it should live

Three surfaces, sharing the same underlying `InviteCoachCard` component and `getOrCreateParentInviteCode` server fn:

1. **Parent dashboard (today)** — full card. No change.
2. **Parent settings (new)** — full card under a new "Coaches" group, so it's the canonical "where do I do this?" home even after the banner is dismissed or after a coach is linked.
3. **App-wide banner on every parent route (new)** — slim, one-line, persistent (no dismiss) until `hasAnyCoach === true`. Tapping it expands to reveal the link + code, or routes to settings.

### Why a banner, not a modal

A modal interrupts every page load. A persistent slim banner is the "you have an unfinished setup step" pattern (think Slack's "verify your email" or Linear's "connect GitHub" strip) — present but not blocking. It auto-disappears the moment a coach is linked, so it can't go stale.

### Banner behavior

- Renders inside the parent layout (`src/routes/_authenticated/parent.tsx`) above the `<Outlet />`, so every `/parent/*` route inherits it without per-page wiring.
- Driven by the same `getParentSignupStatus` query already used on the dashboard — no new server fn.
- Visible only when `hasParentProfile && hasAthletes && !hasAnyCoach`. It doesn't show during signup or for parents who already linked a coach.
- Collapsed state: single line — `"Invite your coach to see your athletes"` + a `Copy link` button + a chevron to expand. On mobile it stays one row.
- Expanded state: shows the same link + code controls as the card, inline.
- No "Dismiss" — dismissal would let the parent forget; the banner is intentionally sticky until resolved. The dashboard card collapses into the banner once we ship this so there's only one strong CTA per page.

### Settings entry

Add a "Coaches" group to `parent.settings.tsx` containing the full `InviteCoachCard`. Even after a coach is linked we keep the card visible there (with a softer headline like "Invite another coach") so a parent with multiple coaches can hand the same link to coach #2.

## Files touched

- `src/components/parent/invite-coach-banner.tsx` *(new)* — slim collapsible banner. Reuses the `getOrCreateParentInviteCode` server fn and the same copy-to-clipboard logic factored out of `invite-coach-card.tsx`.
- `src/routes/_authenticated/parent.tsx` — query `getParentSignupStatus`; render `<InviteCoachBanner />` above `<Outlet />` when `hasParentProfile && hasAthletes && !hasAnyCoach`. Guarded so it doesn't double up with the dashboard card (dashboard card stays, banner sits above it, and after this change the dashboard card can be removed in a future cleanup — out of scope here).
- `src/routes/_authenticated/parent.settings.tsx` — add a new `Coaches` settings group containing `<InviteCoachCard />`.
- `src/components/parent/invite-coach-card.tsx` — minor: extract the copy-clipboard helper so the banner can share it; tweak the headline copy so the same card reads naturally both when no coach is linked and when at least one already is.

No schema changes, no new server functions, no email/SMS work.

## Out of scope

- Email/SMS delivery of the invite (intentionally — earlier decision was "shareable link + code, no send").
- Coach directory / search.
- Banner dismissal or snooze.
- Removing the dashboard card (deferred; safe to keep both for now while validating the banner).
