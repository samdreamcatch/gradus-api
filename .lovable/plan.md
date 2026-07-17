## Goal
Gate the "Also coached by" → other-coach plans sheet behind Pro/Club. Individual `coach`-tier users see the entry but can't open it, with a design-system-native lock affordance.

## Where
- `src/components/coach/also-coached-by-list.tsx` — render the lock state.
- `src/components/coach/athlete-detail-sheet.tsx` — pass tier + only wire `setOpenOtherCoachId` when unlocked.

## Behavior
- Compute `canViewOtherCoachPlans = effectiveTier === "coach_pro" || effectiveTier === "club"` from `useCoachProfile()` in `AthleteDetailSheet` and pass as `locked` prop to `AlsoCoachedByList`.
- When `locked`:
  - Row is rendered as a non-interactive card (same `<div>` branch already used for plan-less coaches — dashed border, muted text) so it visually reads as unavailable.
  - Replace the `ChevronRight` on entries that have plans with a `Lock` icon (lucide) plus a small pill that says `PRO` using the same pill treatment already used by `UpgradeToProRow`'s "Soon" chip: `rounded-full bg-elevated px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-text-secondary`.
  - Meta line reads "Upgrade to see plans" in `text-text-tertiary` instead of the active/benched counts, keeping the counts hidden to avoid leaking info.
  - `OtherCoachPlansSheet` is not mounted / receives no coachId (skip the setter call entirely).
- When unlocked: unchanged behavior.

## Design tokens reused
- `Lock` icon from lucide (already used elsewhere).
- Pill styling copied verbatim from `UpgradeToProRow`'s "Soon" chip.
- Dashed-border non-interactive card variant already present in `also-coached-by-list.tsx`.

## Non-goals
- No changes to `OtherCoachPlansSheet`.
- No routing to paywall on tap (matches current "Coach Pro coming soon" state; club upgrade lives in settings).
- No server-side gating change (this list is a UI-only reveal; the sheet's data fetch is not exposed unless opened).