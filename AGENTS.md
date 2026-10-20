
- Club Trust Center readiness rules live in pure `src/lib/trust-center.ts` (unit-tested); `trust-center.server.ts` only gathers inputs, so the scoring stays testable and consistent.
- DEV tools use the shared, tested preview-host predicate for main and numbered draft previews; published domains stay excluded to avoid exposing the account switcher there.
