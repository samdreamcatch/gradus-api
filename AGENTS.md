
- Club Trust Center readiness rules live in pure `src/lib/trust-center.ts` (unit-tested); `trust-center.server.ts` only gathers inputs, so the scoring stays testable and consistent.
- DEV tools use the shared, tested preview-host predicate for main and numbered draft previews; published domains stay excluded to avoid exposing the account switcher there.
- Club policies use club-scoped requirement and append-only evidence tables, with local draft schema types instead of editing generated clients; this isolates shared Gradus documents and retains legacy sign-offs.
- Policy deadlines come from one pure helper shared through the matrix and overview, and PDF evidence generation stays server-only; this keeps status calculations consistent and private evidence off the client import chain.
- People reuses the authorized club roster and policy matrix; coach policy attribution is pure and tested, and policy failures never imply a coach is signed off.
- Admin social-plan updates use an admin-authorized transactional RPC and preserve share tokens; attribution uses draft-local schema extensions, never generated-client edits.
- Clipboard operations use a selection fallback and expose a selectable link when copying is denied, never report false success.
- Gradus Club contract reads use draft-local schema types and privileged clients only after caller authorization; database triggers enforce seat capacity across web/native membership writers so entry paths cannot bypass seat limits.
- Club spreadsheet pages compose the existing Table through ClubTable and one semantic StatusDot; this keeps desktop density and themed status semantics isolated from mobile app tables.
