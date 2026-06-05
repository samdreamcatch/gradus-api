## Goal

Replace the placeholder `SafeSportPanel` in `src/routes/_authenticated/athlete.resources.index.tsx` with real Safe Sport content, ported from Gradus V.3's `athlete.safety.tsx`, restyled to this project's design tokens.

## Sections (all from V.3, plus one addition)

1. **Eyebrow + title** — keep current `Safe Sport` accent eyebrow and `font-display` title; intro line uses `pen-highlight` on the active sport so the panel stays sport-aware.
2. **Reassurance card** — heart icon in `bg-accent/10` circle, `rounded-2xl border border-divider bg-card`: "You don't have to be sure. You don't have to have proof. You don't have to name anyone."
3. **Talk to someone now** — 4 hotline cards (kept verbatim from V.3):
   - U.S. Center for SafeSport — 866-367-6272
   - Childhelp National Hotline — 1-800-422-4453
   - Crisis Text Line — text HOME to 741741
   - 988 Suicide & Crisis Lifeline
   Each card: name, hours, blurb, then Call (primary `Button` rounded-full) / Text + Website (`variant="outline"` rounded-full) pills.
4. **"Not sure if it counts?"** — `Collapsible` from `@/components/ui/collapsible` (same primitive as the Saved tab), chevron rotates on `data-[state=open]`. 7 warning-sign bullets from V.3.
5. **"Want to tell an adult you trust?"** — `Collapsible` with guidance + the ready-to-use script card.
6. **More from SafeSport** (new) — small outbound link card to `uscenterforsafesport.org` for training videos and the parent/athlete toolkit, styled like the hotline cards with a `Globe` icon.
7. **911 footer** — small muted line: "If you or someone else is in immediate danger, call 911."

## Files to change

- `src/routes/_authenticated/athlete.resources.index.tsx` — rewrite `SafeSportPanel`; add local `HotlineCard` and two `Disclosure` sub-components in the same file. Extend the existing `lucide-react` import with `Phone`, `MessageSquare`, `Globe`, `Heart`.

No new files, no backend changes, no routing changes. Scope is the Safe Sport tab only.
