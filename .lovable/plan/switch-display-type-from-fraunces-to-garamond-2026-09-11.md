# Switch display type from Fraunces to Garamond

All serif display type in the app (page titles, headings, big numbers, email headings) moves to Garamond. The "Gradus" wordmark keeps Fraunces so the brand mark is unchanged.

## What changes

- Headings and page titles across the app render in EB Garamond (the web version of Garamond, served from Google Fonts, with Garamond/Georgia as fallbacks).
- The Gradus logo — and only the logo — stays on Fraunces.
- Email templates use Garamond for their headings; the Gradus wordmark in emails is an image, so it is untouched.
- Design-system documentation is updated so Garamond is the named display font.

## Technical details

1. `src/routes/__root.tsx` — font stylesheet link: add `EB+Garamond` (400/500/600/700 + italic). Keep Fraunces loaded but trim it to the single weight the wordmark uses (600) to limit payload.
2. `src/styles.css` — `--font-display: "EB Garamond", Garamond, Georgia, serif;` and add a new `--font-wordmark: "Fraunces", Georgia, serif;` token (exposed as `--font-wordmark` in `@theme inline`).
3. `src/components/logo.tsx` — switch `fontFamily` to `var(--font-wordmark)`. Its `fontVariationSettings` (SOFT/WONK/opsz) stay, since they are Fraunces axes.
4. `src/components/page-title.tsx` and any other `font-display` consumers need no edits — they inherit the retargeted token. Garamond runs optically smaller than Fraunces, so page-title and h1/h2 sizes get a small upward nudge (roughly +2px on the 28px page title, plus slightly tighter leading) after a visual check.
5. `src/lib/email-templates/_styles.ts` — `fonts.display` becomes `'"EB Garamond", Garamond, Georgia, "Times New Roman", serif'`.
6. `scripts/lib/design-tokens.test.ts` — expectation updated to `"EB Garamond"`; `docs/api/design-tokens.json` regenerates via the export script.
7. Docs mentioning Fraunces as the display font (`CLAUDE.md`, `docs/ios/PRD.md`, `docs/ios/handoff-I1.md`) updated to Garamond, noting Fraunces remains bundled for the wordmark only.

## Verification

Lint, typecheck, build, and a preview screenshot of a heading-heavy screen to confirm the new type sizes read correctly in both light and dark mode.
