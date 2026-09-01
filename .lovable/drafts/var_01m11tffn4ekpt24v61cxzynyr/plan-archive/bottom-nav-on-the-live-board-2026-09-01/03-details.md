## Technical notes

**1. Shared role hook (new, ~40 lines)**
`src/hooks/use-viewer-role.ts` — reads the session and resolves
`"coach" | "parent" | "athlete" | "admin" | null` using the same four lookups
the login route already performs (`user_roles`, `coach_profiles`,
`parent_profiles`, `athletes`), wrapped in a react-query cache keyed by user id.
The login route can adopt it later; not required for this change.

**2. Disabled mode on the existing navs (small edit, 3 files)**
Add an optional `disabled` prop to `CoachBottomNav` / `ParentBottomNav` /
`AthleteBottomNav`. When set, items render as buttons with tertiary tone,
`aria-disabled`, no active state, no unread dot, and an `onSignInRequest`
callback instead of a `Link`. All existing call sites are unaffected.

**3. Board nav wrapper (new, ~30 lines)**
`src/components/board/board-bottom-nav.tsx` — picks the nav by role, or the
parent-shaped nav in disabled mode when signed out, and wires the disabled taps
to the existing `BoardAccountSheet` used on the board today.

**4. Board page (small edit)**
Render the wrapper in `src/routes/board.$slug.tsx` and bump the container's
bottom padding to clear the fixed bar (matching what signed-in pages use).

Admins get no bottom nav today; on the board they'll see the signed-out greyed
bar unless you'd rather they see nothing.

No schema, server function, or routing changes.
