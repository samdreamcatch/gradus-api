# Athlete detail page — design system audit

The screen is assembled from four files that were each built at a different time:
`athlete-detail-sheet.tsx`, `competition-results-section.tsx`,
`athlete-billing-section.tsx`, `also-coached-by-list.tsx`. Only the newest one
(competition results) uses the shared primitives. The rest hand-roll the same
things, which is why it reads as hodgepodge.

## What's inconsistent

**1. Section headings — three implementations**
- A local `SectionHeading` helper (raw `h3`, 10px) in the detail sheet
- A copy-pasted raw `h3` in billing and in "Also coached by"
- The shared `Eyebrow` component in competition results

Casing is also mixed: `GOALS FROM PARENT & ATHLETE` (hard-coded caps) next to
`Plans`, `Billing`, `Session feedback`.

**2. Header actions — four different button treatments in one scroll**
- "Link results" and "Generate invoice": `Button variant="outline"`
- "Refresh" (Last 30 days): a raw `<button>` with a `hover:text-text-primary`
  class — a direct violation of the no-hover / `press` rule
- "Show all", "Unlink", "Share", "Reset to default": `Button variant="ghost"`
- "Generate draft plan": full-width filled primary

**3. Cards — the shared `Card` component is never used here**
Every block is a hand-written `rounded-xl border border-divider bg-card p-3`.
That's `rounded-xl`/`p-3` against the design system's row card
(`rounded-2xl`/`p-4`), so this page's cards are visibly tighter and sharper than
roster cards, plan cards, and everything else in the app. Nested rows drift
further (`rounded-lg`, `bg-elevated`, `px-3 py-2`).

**4. Type registers — same information, three fonts**
Meta lines are `font-hand` (Also coached by), `font-mono` (competition results),
and plain sans (billing, goals). Sizes are ad-hoc literals — `text-[10px]`,
`text-[11px]`, `text-[15px]`, `text-xs` — instead of the Eyebrow/type scale
tokens.

**5. Chips and stamps — mixed**
`Tag` is used for invoice status and event counts, but sport labels in
"Also coached by" are a hand-rolled pill span, and the locked-state label is a
third hand-rolled `rounded-full` span.

**6. `VerdictPill` uses raw color variables**
`bg-[var(--pen-tennis)]/10`, `text-[var(--pen-pool)]` — the only place on the
page reaching past semantic tokens into raw pen values.

**7. Empty states — three shapes**
Dashed `EmptyLine` card (goals, plans), a bare `<p>` (no invoices), and a bare
sentence inside a card (no published scores).

**8. Interactive rows**
Invoice rows nest three separate buttons inside a non-interactive `li`, and the
paid/unpaid `Tag` is wrapped in a bare `<button>` with no press feedback or
visible affordance. Competition result rows use `press-soft`; the coach rows use
`press`; the invoice row body uses neither.

**9. Duplicated markup**
`SampleAthleteBody` re-implements goals, activity, and plans markup by hand, so
any fix must be made twice or the sample athlete drifts.

## The fix

Presentation-only. No behavior, data, or server changes.

**Pass 1 — one vocabulary**
- Delete the local `SectionHeading`, the raw `h3`s, and the hand-rolled pills.
  Use `Eyebrow size="caption"` for every section heading and sentence-case the
  labels (Goals, Practice expectations, Last 30 days, Plans, Competition
  results, Billing, Also coached by).
- Every section gets the same header shape: eyebrow left, one optional
  `Button size="sm" variant="outline"` right. "Refresh" becomes that button
  (icon + label) instead of a raw hover link.
- Demote in-row actions to `Button size="sm" variant="ghost"` consistently
  (Unlink, Share, Reset, Show all, delete icon).
- Reserve the filled primary for the single real CTA in a section (Generate
  draft plan) and nothing else.

**Pass 2 — one surface**
- Replace every hand-rolled block with `Card variant="row"`, and nested rows
  with the existing elevated-row treatment already used in competition results,
  so radii and padding match the rest of the app.
- Replace hand-rolled sport pills and the locked label with `Tag`.
- Rewrite `VerdictPill` on semantic tokens (`accent` / `divider` / `elevated`)
  via `Tag` + card, dropping the raw `--pen-*` references.

**Pass 3 — one type scale and one empty state**
- Meta text: sans `text-sm text-text-secondary` for prose, `Eyebrow`/`Tag` for
  labels, `font-mono` only for scores and dates inside competition results
  (its intentional scoreboard register). Drop `font-hand` from this screen.
- Replace ad-hoc pixel literals with the Eyebrow sizes and standard `text-sm` /
  `text-xs`.
- One `EmptyLine` used for all four empty states.

**Pass 4 — de-duplicate**
- Extract the goals block, activity counts, and plans list so
  `SampleAthleteBody` renders the same components as the live body instead of
  its own copy.

## Technical notes

Files touched: `src/components/coach/athlete-detail-sheet.tsx`,
`athlete-billing-section.tsx`, `also-coached-by-list.tsx`,
`competition-results-section.tsx`. Primitives reused: `Eyebrow`, `Tag`, `Card`,
`Button`, `Accordion`, `Collapsible` — no new UI components. Query keys,
mutations, and server functions unchanged.
