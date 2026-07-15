## Goal

On `/signup/parent/athletes`, replace the two separate labeled fields (Coach invite code, Promo code) with a single collapsible section titled **"Optional — enter a coach or promo code"** that reveals both inputs when opened.

## File touched

- `src/routes/signup.parent.athletes.tsx` — only presentational changes; no logic/state changes.

## Component choices (all existing)

- `Collapsible`, `CollapsibleTrigger`, `CollapsibleContent` from `@/components/ui/collapsible`
- `Button` (`variant="ghost"`) as the trigger, containing the label + a rotating `ChevronDown` from `lucide-react`
- `Badge` from `@/components/ui/badge` for the "Code applied" hint
- Existing `Input` for the coach code and existing `PromoCodeField` untouched

## UX behavior (per answered questions)

1. **Trigger style — Ghost button with chevron.** Full-width, left-aligned, `text-primary` label, chevron on the right that rotates 180° when open (`data-[state=open]:rotate-180`, `transition-transform`). No border; sits between "Add another athlete" and the Continue button (i.e., where the two field blocks used to live).
2. **Default state — Auto-open when prefilled.** Compute `hasPrefill = Boolean(initialCoachCode) || Boolean(initialPromoCode)` from the same URL/sessionStorage sources already read today, and pass to `Collapsible defaultOpen={hasPrefill}`. Link-invited users still see their code immediately.
3. **Prefill indicator — "Code applied" badge.** When collapsed AND a code is present, render a small `<Badge variant="secondary">Code applied</Badge>` inside the trigger row next to the label. Hidden when the section is open (so it doesn't duplicate the visible field). Uses the accent-neutral secondary badge already in the system — no new color tokens.

## Layout inside `CollapsibleContent`

Same two field blocks that exist today, in the same order, unchanged:

```text
Coach invite code (optional)
[ input ]
Have a coach's 8-character code? …

Promo code (optional)
[ PromoCodeField ]
```

Wrap in `space-y-4` to match sibling section spacing. No changes to labels, helper text, validation, or submission logic.

## Out of scope

- Coach and adult-athlete onboarding pages (`coach.onboarding.tsx`, `athlete.onboarding.tsx`) — unchanged for now. Can mirror this pattern in a follow-up if desired.
- No changes to page 1 signup routes.
- No new design tokens, no new components, no logic changes.

## Verification

- Typecheck passes.
- Manual: visit `/signup/parent/athletes` → section collapsed, badge hidden. Visit `/signup/parent/athletes?code=ABCD1234` → section open, coach code prefilled. Collapse it → badge appears.
