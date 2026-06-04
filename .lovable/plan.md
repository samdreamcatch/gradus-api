Replace the bespoke `SettingsHeader` (eyebrow + "Your account/Your coach profile") in all three settings routes with the shared `PageTitle` component used by `/parent/plans` and `/parent/messages`, with the single word "Settings".

## Changes

In each of these three files:
- `src/routes/_authenticated/parent.settings.tsx`
- `src/routes/_authenticated/coach.settings.tsx`
- `src/routes/_authenticated/athlete.settings.tsx`

Do:
1. Remove `SettingsHeader` from the `@/components/settings/primitives` import list.
2. Add `import { PageTitle } from "@/components/page-title";`.
3. Replace `<SettingsHeader title="..." />` with `<PageTitle>Settings</PageTitle>`. No subtitle.
4. Bump the outer container's top padding from `pt-4` to `pt-6` so it matches the plans/messages pages.

## Out of scope

- `SettingsHeader` primitive itself stays defined in `src/components/settings/primitives.tsx` (unused but harmless to leave; can be cleaned up later).
- No styling changes to `PageTitle`.