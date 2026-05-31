Apply the aggressive density direction (you picked) across the design system. Roughly ~30–35% less vertical space, no color/font/component changes.

## Scope: vertical only

Touch padding, gaps, row heights, and section margins. Do not change colors, fonts, radii, shadows, or component structure.

## 1. UI primitives (`src/components/ui/*`)

Tighten the defaults so every screen inherits the change for free.

- **button.tsx** — default `h-9 py-2` → `h-8 py-1.5`; `sm` `h-8` → `h-7`; `lg` `h-10` → `h-9`; icon `h-9 w-9` → `h-8 w-8`.
- **card.tsx** — `CardHeader` / `CardContent` / `CardFooter` `p-6` → `p-4`; header `space-y-1.5` → `space-y-1`.
- **input.tsx** — `h-9 py-1` → `h-8 py-1`.
- **accordion.tsx** — trigger `py-4` → `py-2.5`; content padding trimmed one step.
- **dialog.tsx / sheet.tsx** — content `p-6` → `p-4`, internal `gap-4` → `gap-3`.
- **badge.tsx** — `py-0.5` stays (already tight); leave.
- **separator** — no change.

## 2. Plan detail screen (`parent.plans.$planId.tsx`)

Match the chosen mockup precisely on this representative page so we can eyeball the result:

- Header meta `text-sm mb-1` → `text-[12px] mb-0.5`.
- H1: `leading-[1.05] mb-8` → `leading-[0.95] mb-3`.
- Start session slider: container `h-14 p-1 mb-8` → `h-10 p-1 mb-4`; inner pill `py-2.5` → `py-1.5`.
- "From the coach" label `mb-3` → `mb-2`.
- Exercise list: `space-y-2.5` → `gap-1`; each row `py-4 px-5 rounded-3xl` → `py-2 px-3.5 rounded-2xl`; rep number `text-xl` → `text-[18px]`; name `text-lg` → `text-[15px]`.
- "Message Tami" CTA: `py-3.5 mt-7 mb-24` → `py-2.5 mt-4 mb-6`.
- Bottom tab bar: `py-3` → `py-2.5 pb-4`, label gap `gap-1` → `gap-0.5`.

## 3. Other authenticated routes (sweep)

Apply the same density rules consistently — one Tailwind step tighter — across:

- `parent.index.tsx`, `parent.plans.index.tsx`
- `coach.index.tsx`, `coach.plans.tsx`, `coach.plans.$planId.tsx`, `coach.settings.tsx`, `coach.onboarding.tsx`
- `athlete.tsx`
- `components/coach/move-sheet.tsx`, `components/coach/voice-fab.tsx`

Pattern rewrites: `space-y-6` → `space-y-3`; `space-y-4` → `space-y-2`; `gap-6` → `gap-3`; `gap-4` → `gap-2`; `py-8` → `py-5`; `py-6` → `py-4`; `mb-8` → `mb-4`; `mt-10` → `mt-6`. Skip cases where reducing breaks legibility (heading line-height, focus targets <32px).

## 4. Reversibility

All edits are local Tailwind class swaps in known files — no token migration, no behavior change. Easy to revert by undoing the commit if the density doesn't feel right in practice.

## Out of scope

- Onboarding flows / login / public marketing pages (different density needs — keep generous).
- Sidebar/drawer chrome geometry beyond padding.
- Typography scale changes.