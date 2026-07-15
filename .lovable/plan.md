# Mirror parent-flow code UX to coach & athlete onboarding

Bring the collapsible "Optional" pattern, tooltip helper, and Badge treatment already shipped on `/signup/parent/athletes` to the two onboarding pages. Scoped strictly to presentation — no changes to validation, lookup logic, submission, or routing.

## Coach onboarding (`src/routes/_authenticated/coach.onboarding.tsx`)

The "Invite Parents" step currently renders `<InviteCard />` followed by a bare `PromoCodeField`. Coaches never enter a coach invite code, so only the promo field is affected.

- Wrap the `PromoCodeField` in a `Collapsible` from `@/components/ui/collapsible`.
- Trigger: full-width ghost `Button` with `text-accent-ink`, label "Optional — enter a promo code", rotating `ChevronDown` (180° when open, `transition-transform`).
- Auto-open state: `useState(Boolean(promoCode))` + `useEffect` that opens the collapsible when a promo code is prefilled (e.g. via `pending-promo-code`).
- Show `<Badge variant="secondary">Code applied</Badge>` in the trigger row when collapsed AND `promoCode` has a value.
- No new imports beyond `Collapsible*`, `Badge`, `ChevronDown`.

## Athlete onboarding (`src/routes/_authenticated/athlete.onboarding.tsx`) — "Connect with a coach" step

Today this step centers the 8-char coach code as the primary action with a "Look up coach" button, then shows `PromoCodeField`, then "Skip for now". The user chose to wrap both fields under one collapsible; that means the step no longer treats coach code as the required primary action. New shape:

- Keep the step header ("Connect with a coach") and its subheading, updated to reflect that both fields are now optional-and-collapsed:
  - New subheading: "Have a coach's invite code or a promo code? Add either now — or skip and add later from settings."
- Replace the current form body with:
  - A single `Collapsible`, default-closed unless `code` OR `promoCode` is prefilled (same `hasPrefill` pattern used on parent/athletes).
  - Trigger: ghost `Button`, label "Optional — enter a coach or promo code", rotating chevron, `Badge variant="secondary"` "Code applied" when collapsed with any value.
  - `CollapsibleContent` (`space-y-4 pt-1`):
    - Coach invite code block: `Label` "Coach invite code" + inline `<Badge variant="secondary" className="text-[10px] uppercase tracking-widest">Optional</Badge>` + small `HelpCircle` tooltip trigger. Tooltip content: current helper copy ("Have a coach's 8-character code? Enter it to link your athlete now. You can skip this and add a coach later."). The input keeps its current styling (`font-mono text-2xl tracking-[0.4em] uppercase h-14`, centered).
    - `PromoCodeField` unchanged (its own "Optional" badge already ships).
- Primary action button:
  - Relabel from "Look up coach" to "Continue".
  - Behavior: if `codeValid` → run existing `previewMut.mutate(...)` (coach lookup); if code is blank → call existing `handleSkip()` (which stashes any promo). Disabled while `previewMut.isPending`, or when a non-empty code is not yet 8 chars (invalid).
- Remove the separate "Skip for now" button — the single primary button now handles both paths.
- `TooltipProvider` wraps only the tooltip locally (matches the parent/athletes pattern).

## Out of scope

- `signup.coach.tsx` and `signup.athlete.adult.tsx` entry pages (no code inputs there).
- `PromoCodeField` — already updated to render the "Optional" Badge.
- Validation, server functions, redirects, sessionStorage plumbing, error copy.
- No new design tokens or components.

## Verification

- Typecheck clean.
- Manual: coach onboarding "Invite Parents" step shows collapsed promo trigger; opens when a stashed promo prefills. Athlete "Connect with a coach" step shows one collapsed trigger; opens when `?code=…` or a stashed promo prefills; tooltip on the HelpCircle shows the coach-code helper copy; "Continue" runs the coach lookup when a valid code is entered and skips otherwise.
