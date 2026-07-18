## Goal

The `/admin` chip strip doesn't scale as we add sections (Feedback, Errors, Promo codes, Organizations, Emails, and more coming). Replace it with a proper **admin toolbar** modeled on the Gradus Website `_admin` layout — pill-style nav links with a filled active state, an eyebrow + title on the left, sign-out on the right — and promote it to a shared layout so every `/admin/*` page gets the same chrome.

## Reference (Gradus Website `_admin.tsx`)

```text
┌───────────────────────────────────────────────────────────────────┐
│ GRADUS ADMIN                                    [nav pills]  ⏻   │
│ Content management                                                │
├───────────────────────────────────────────────────────────────────┤
│  <Outlet />                                                       │
└───────────────────────────────────────────────────────────────────┘
```

- Eyebrow (`text-[11px] uppercase tracking-[0.2em] text-accent-ink`) + display title on the left.
- Nav pills on the right — `rounded-pill border border-divider`; active = `border-text-primary bg-text-primary text-background`.
- Sign-out lives inside the nav.

## Changes

### 1. New shared layout: `src/routes/_authenticated/admin.tsx`

There is already an `admin.tsx` layout file — extend it (or replace its body) to render the toolbar + `<Outlet />` instead of the chip strip living on `admin.index.tsx`. Structure:

- Sticky header (`sticky top-0 z-30 bg-background/85 backdrop-blur border-b border-divider`) so the toolbar stays available on long admin pages.
- Left: `Eyebrow` "Internal" + `h1` "Admin".
- Right: horizontal, wrap-on-desktop / horizontally-scrollable-on-mobile `<nav>` of `AdminNavLink` pills:
  - Overview (`/admin`, exact match)
  - Feedback (`/admin/feedback`)
  - Errors (`/admin/errors`)
  - Promo codes (`/admin/promo-codes`)
  - Organizations (`/admin/organizations`)
  - Emails (`/admin/emails`)
  - Map (`/admin/map`)
- Trailing utility group (visually separated by a thin divider): the `Test users: on/off` toggle (currently a chip) and Sign out.
- Preserve the `?test=` search param on nav so toggling test-users stays sticky across sections.

`AdminNavLink` — small local component using TanStack `Link` with `activeOptions={{ exact }}` and `activeProps` to swap classes, matching the Gradus Website pattern but using our tokens (`border-divider`, `text-text-primary`, active → `border-accent bg-accent text-accent-foreground`, since our admin sits inside the app design system, not the marketing site).

Mobile: wrap nav in an `overflow-x-auto` container with `-mx-4 px-4 flex-nowrap` so pills scroll horizontally without breaking the header.

### 2. `src/routes/_authenticated/admin.index.tsx`

- Remove the whole `<header>` block (Eyebrow, h1, and the chip row of Links).
- Remove the bottom Sign-out `SettingsGroup` (moved to toolbar).
- Keep: User lookup, ReportingPanel, DauChart. Page just becomes the content, since the layout owns the chrome.
- Continue reading `test` from `Route.useSearch()` for the reporting/DAU/search queries.

### 3. No visual changes to other admin routes

They already render inside the `admin.tsx` layout via `<Outlet />`, so they inherit the toolbar for free.

## Design system notes

- Pills use existing tokens: `border border-divider`, `text-text-primary`, hover via `press` utility (per interaction-feedback memory — no `hover:*` on buttons/chips). Active state uses `border-accent bg-accent text-accent-foreground` so the current pen color reads as the "you are here" mark, consistent with the notebook/pen doctrine.
- Sticky bar uses `bg-card/85 backdrop-blur` rather than `bg-background` so the paper wash still shows through (matches surface-token core rule).
- Eyebrow keeps `size="small" tone="accent-ink"`; title stays `font-display text-h1`.

## Out of scope

- No changes to admin page contents beyond removing the duplicated header/sign-out on the index.
- No sidebar variant — a horizontal toolbar scales fine to ~10-12 sections; if we later exceed that we can revisit a shadcn sidebar.
