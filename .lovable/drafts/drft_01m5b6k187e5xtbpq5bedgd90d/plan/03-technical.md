## Technical details

- New admin-only server function `adminImproveSocialPlanMoves` in `src/lib/social-plans.functions.ts`: input `{ sport, title, notes, prompt (max 1000), moves[] }`, same `assertAdmin` guard, gateway provider and `generateObject` pattern and lenient move schema as the result-drafting function. Output: `{ moves }`.
- UI in `src/routes/_authenticated/admin.social-plans.tsx`: button with existing `Button` + `Sparkles`; bottom `Sheet` (paper-surface) with `Textarea` and an Improve button using `press`; keep previous moves in state for Undo; toast for errors via sonner.
- No database changes; works in the draft preview right away.
