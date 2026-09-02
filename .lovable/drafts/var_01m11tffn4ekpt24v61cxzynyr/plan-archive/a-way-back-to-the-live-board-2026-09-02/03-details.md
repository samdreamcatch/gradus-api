## Technical notes

**1. Remember the origin board (small addition)**
Add `writeBoardReturn(slug)` / `readBoardReturn()` / `clearBoardReturn()` to
`src/lib/board-follow-store.ts`, backed by `sessionStorage`
(`gradus.boardReturn`). Session-scoped so it never lingers into a later visit.
`BoardAccountSheet` writes it on every outbound link (Sign in and the three
role links), derived from the `redirect` prop it already receives.

**2. Shared return link (new, ~25 lines)**
`src/components/board/board-return-link.tsx` — reads the stored path after
hydration and renders nothing when absent. Uses existing components (`Chip` with
a `ChevronLeft`, `press`), so no new design pieces.

**3. Mount it on the auth screens**
Render at the top of `src/routes/login.tsx`, `signup.parent.tsx`,
`signup.coach.tsx`, `signup.athlete.tsx`. Only the entry screens — later steps
in a signup are past the "changed my mind" moment.

**4. Clear on success**
Clear the stored value where the existing pending-signup stashes are already
cleared on a successful sign-in / sign-up, alongside `clearPendingTermsAccept`.

Survives the Google OAuth round trip because it lives in `sessionStorage`, not
in a URL param. No schema, server function, or routing changes.
