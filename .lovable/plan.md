## Goal

When a coach's add-athlete action is rejected by the roster-cap trigger, surface it as a design-system nudge that points at Coach Pro — not a raw red toast. Also make the "at cap" state visible on the roster page before they try.

## Where the error surfaces today

The DB trigger throws `Roster full: the <tier> plan is limited to <n> athletes. Upgrade to add more.` at any `coach_athletes` insert. Coach-initiated inserts run through **one** UI path: `EnterInviteCodeCard` (rendered inside the roster page's "Add athlete" sheet). It currently `toast.error(msg)`s the raw exception.

The parent-side path (`add-coach-by-code-card.tsx`) hits the same trigger, but the parent isn't the person who can upgrade — handled separately below.

## Design choices (reuses existing pieces)

- **Nudge medium: enriched `sonner` toast** with an action button. Sonner action toasts already appear elsewhere in the app, honor the design tokens, and don't require a new overlay — which keeps us aligned with the overlay doctrine (Sheet / Popover / AlertDialog only; no plain Dialog for informational content).
- **CTA reuse: `UpgradeToProRow`** for the on-page banner when at cap. Same row used in settings, so the messaging and the "coming soon" state stay in one component. It already gates behind `isCoachProAvailable()`.
- **Copy tone: coach's-notebook plain-spoken**, no upsell tone. "Roster's full — 25 out of 25. Coach Pro raises it to 75."

## Changes

### 1. Shared detector + copy — `src/lib/roster-limits.ts` (new)

```ts
export function isRosterFullError(err: unknown): boolean;
export function rosterFullCopy(tier: "coach" | "coach_pro"): {
  title: string; description: string;
};
```

Small helper so both the roster page and the invite card use identical phrasing. `isRosterFullError` matches the trigger's message prefix (`/Roster full/i`).

### 2. Coach-side toast — `src/components/coach/enter-invite-code-card.tsx`

In the `catch`, before falling back to the generic toast, check `isRosterFullError(err)`. If matched:

- If `isCoachProAvailable()` → `toast.error("Roster's full", { description: "You're at 25 athletes on the Coach plan. Upgrade to Coach Pro to add up to 75.", action: { label: "Upgrade", onClick: () => navigate({ to: "/coach/paywall", search: { tier: "coach_pro" } }) } })`.
- If not (flag off) → same title/description with "Coach Pro is coming soon — it'll raise this to 75 athletes." and no action button.

Tier and cap come from the already-loaded `coachProfile` (via `useQuery(coachProfileQueryOptions)`) so the numbers match what settings shows.

### 3. On-page nudge when at cap — `src/routes/_authenticated/coach.roster.tsx`

Below the sticky header, when `rosterFull`, render an inline callout using the existing `paper-surface` utility (matches the roster's notebook look):

```
┌─────────────────────────────────────────────┐
│ Roster's full — 25 / 25                     │
│ Coach Pro raises this to 75 athletes.       │
│ [ UpgradeToProRow ]                         │
└─────────────────────────────────────────────┘
```

- Wraps `<UpgradeToProRow />` — its disabled "Soon" state handles the pre-launch case for free.
- Only shown when `athleteLimit !== null && athletes.length >= athleteLimit`. Club coaches (unlimited) never see it.
- The Add-athlete button stays disabled (already done last turn); we drop the awkward `(25/25)` count from the label since the banner now carries it — button just reads "Add athlete" with a tooltip.

### 4. Parent-side polish (small) — `src/components/parent/add-coach-by-code-card.tsx`

Same `isRosterFullError` check, but the message is coach-agnostic and has no upgrade CTA (parent can't upgrade someone else): `toast.error("That coach's roster is full right now. Ask them to make room and try again.")`. Prevents the parent from seeing raw "Coach plan is limited to 25 athletes" phrasing that isn't actionable for them.

## Explicitly out of scope

- No changes to the trigger message itself — it stays as the machine-readable source that `isRosterFullError` matches.
- No changes to `UpgradeToProRow`, the paywall route, or pricing.
- No proactive "you're one away" warning at 24/25 — over-engineering for now; can add later using the same `athleteCount` / `athleteLimit` fields already on the DTO.

## Files touched

- `src/lib/roster-limits.ts` (new)
- `src/components/coach/enter-invite-code-card.tsx`
- `src/routes/_authenticated/coach.roster.tsx`
- `src/components/parent/add-coach-by-code-card.tsx`
