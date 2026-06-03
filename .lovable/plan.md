## Global design-system pass

Three coordinated edits. All visual — no business logic touched.

### 1. Tighter editorial padding (level 3 / 5, truly global)

Goal: noticeably denser, but not so flush it breaks tap targets on mobile.

**Page shells** (every route file with `px-4 pt-10 pb-24` etc.):
- Horizontal page padding: `px-4` → `px-3`
- Top page padding: `pt-10` → `pt-6`
- Bottom safe-area padding (above bottom nav): keep `pb-24` unchanged — required clearance for the fixed bottom nav.
- Section gaps: `mt-5` → `mt-4`, `mt-6` → `mt-5`. Leave `space-y-*` between list items as-is to preserve scannability.

**shadcn primitives** (the "truly global" part):
- `Card` `CardHeader` / `CardContent` / `CardFooter`: `p-4` → `p-3`
- `Dialog` / `Sheet` / `Popover` content padding: trim one step (e.g. `p-6` → `p-4`).
- `Input` / `Textarea` / `Button`: leave alone — these set tap-target height; tightening here regresses mobile usability.
- `Alert`, `Tabs` triggers: trim where padding > `p-3`.

**Out of scope (intentionally left):** auth screens (login/signup) keep current breathing room; bottom-nav internal padding stays; form inputs stay. I'll flag any specific component where the tighter spacing looks broken during implementation rather than force it.

### 2. Page title weight: black → medium

`MessagesHeader` and the matching Plans-page titles use `font-display ... font-black`. Drop to `font-medium` (500) globally on these big editorial titles.

Logo (`src/components/logo.tsx`) is explicitly untouched — it stays at its current 600 / wonk-axis settings.

Smaller `font-display` headings already in use (`text-2xl`, `text-3xl`, `text-4xl` without `font-black`) are not changed — they already inherit the base h1-h5 weight of 600 from `styles.css`. The fix is targeted to the oversized display titles only.

### 3. Unified highlighter — restyle titles to match the Logo

Today the Logo uses an absolutely-positioned rotated gradient stripe (`-2.5deg`, fades out to the right, extends past the glyphs). `MessagesHeader` and the Plans headers use a flat `background-image` band with no rotation and no fade.

Update `MessagesHeader` and the two Plans titles to use the **same stripe treatment as the Logo**:
- absolute-positioned `<span aria-hidden>` behind the text
- same `linear-gradient(to right, …pen-tennis 90% → 60% → 25% → transparent)` fade
- same `rotate(-2.5deg)` and `top: 44%; height: 42%`
- stripe extends slightly past the right edge of the word, like the Logo

The Logo file itself is not modified — we're copying its stripe pattern into the title components. Two title components get the new treatment: `src/components/messages/messages-header.tsx` and the inline title blocks in `athlete.plans.index.tsx` / `parent.plans.index.tsx` / `coach.plans.tsx` (the existing `pen-highlight` utility in `styles.css` stays as-is for other uses).

### Files touched

- `src/styles.css` — no token changes; possibly add a `.pen-stripe` helper class mirroring the Logo's stripe so titles stay DRY.
- `src/components/messages/messages-header.tsx` — weight + stripe.
- `src/routes/_authenticated/athlete.plans.index.tsx`, `parent.plans.index.tsx`, `coach.plans.tsx` — weight + stripe on inline page titles.
- `src/components/ui/card.tsx`, `dialog.tsx`, `sheet.tsx`, `popover.tsx`, `alert.tsx`, `tabs.tsx` — padding trims.
- All route files under `src/routes/_authenticated/*` and `src/routes/signup.*` — `px-4 pt-10` → `px-3 pt-6` on the page shell wrappers. (Auth screens reviewed individually.)

### Risks / things to flag, not break

- **Tap targets**: I'm explicitly leaving `Button`, `Input`, `Textarea`, and bottom-nav padding alone. Tightening those would regress mobile usability.
- **Dialog/Sheet density**: dropping content padding from `p-6` to `p-4` can make form dialogs feel cramped. If one looks bad, I'll restore on that specific surface rather than fight the global rule.
- **Plans titles**: these are inline (not using `MessagesHeader`). I'll convert the three Plans pages to use a shared title component or copy the stripe-pattern inline — either way the visual is identical to MessagesHeader.

Nothing here is a breaking change in the API or routing sense — it's all styling and one shared visual primitive. Ready to implement on approval.