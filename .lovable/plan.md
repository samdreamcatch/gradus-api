# Fix admin panel on mobile

Two issues, both confirmed in the code.

## 1. The mobile admin menu is see-through

On mobile the admin navigation opens as a slide-over panel. That panel is styled with a set of "sidebar" color tokens (background, text, borders, hover/active states) that were never defined in the app's design tokens. Because they don't exist, the panel gets no background at all — so the page content shows straight through it and the menu is barely readable.

Fix: define the missing sidebar tokens in `src/styles.css` (light and dark), mapped onto existing semantic colors so the menu matches the rest of the app:

- panel surface -> opaque popover surface (per the overlay rule: floating panels that cover page content must be fully opaque)
- text -> primary/secondary ink
- borders -> divider
- active/hover item -> elevated surface with accent ink
- focus ring -> accent

This also fixes the desktop sidebar, which is currently relying on the same missing tokens.

## 2. Competitions tab is cramped on mobile

The Competitions page renders with no page padding, while other admin pages (Organizations, Reports, Promo codes, Reporting) all use the same container: centered, max width, horizontal padding, vertical padding.

Fix: wrap the Competitions page content in that same standard container so it lines up with every other admin tab.

## Technical notes

- `src/styles.css`: add `--sidebar*` variables in `:root` and `.dark`, plus the `--color-sidebar*` entries in the `@theme inline` block so Tailwind emits the utilities.
- `src/routes/_authenticated/admin.competitions.tsx`: change the root wrapper to `mx-auto max-w-5xl space-y-6 px-4 py-10`.
- No changes to `src/components/ui/sidebar.tsx`, navigation structure, or any data/server logic.
