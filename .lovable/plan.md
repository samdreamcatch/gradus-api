## Problem
In `/coach/settings`, the **Plan** section checks `profile.foundingCoach` before it checks for an active paid Coach Pro subscription. A founding coach who upgrades to Coach Pro still sees the "Founding Coach — COACH • FREE" card, which makes it look like they haven't upgraded.

## Goal
- Show the "Founding Coach — Coach • Free" card only when a founding coach is actually on the free Coach tier.
- When a founding coach has upgraded to Coach Pro (`entitlement === "paid"` and `subscriptionTier === "coach_pro"`), show the Coach Pro plan card with the standard status and billing-management options.
- Still acknowledge their founding-coach identity in the paid view so it doesn't feel like a loss of status.

## Changes
1. In `src/routes/_authenticated/coach.settings.tsx`, refine the `PlanSection` rendering order:
   - Keep **club-covered** first.
   - Render the **paid Coach Pro** branch before the founding-coach branch, so an active Coach Pro subscription wins.
   - Restrict the founding-coach card to `profile.foundingCoach && profile.subscriptionTier !== "coach_pro"`.
   - In the paid Coach Pro card, add a small founding-coach indicator (e.g., status pill label "Founding Coach Pro" or a description line) when `profile.foundingCoach` is true.
2. Verify the logic matches the entitlement data returned by `getCoachProfile` in `src/lib/coach-profile.functions.ts`, where upgraded coaches have `entitlement: "paid"` and `subscriptionTier: "coach_pro"` while retaining `founding_coach: true`.

## Acceptance criteria
- A founding coach on the free Coach tier sees the existing "Founding Coach — Coach • Free" card with an upgrade prompt.
- A founding coach on a paid Coach Pro subscription sees the Coach Pro plan card, with status (Active/Trial/etc.) and the "Manage billing" / "Change plan" / "Join a club" rows.
- No database changes required; this is a UI-only fix.