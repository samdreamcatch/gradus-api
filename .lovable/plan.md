# Restrict the sports-poster watermark to ceremony surfaces

## Doctrine

The `<SportsPoster>` watermark is reserved for **ceremony surfaces** — auth entry/exit points and moments worth marking. It never appears on routine authenticated app pages.

**Ceremony surfaces (10, keep watermark):**
- Auth entry: `login.tsx`, `forgot-password.tsx`, `reset-password.tsx`, `i.$code.tsx`
- Signup roots: `signup.athlete.tsx`, `signup.athlete.adult.tsx`, `signup.coach.tsx`, `signup.parent.tsx`
- Celebration: `components/connection-celebration.tsx`, `components/onboarding/invite-card.tsx`

**Non-ceremony surfaces (4, strip watermark):**
- `routes/_authenticated/coach.roster.tsx`
- `routes/_authenticated/athlete.plans.index.tsx`
- `routes/_authenticated/parent.plans.index.tsx`
- `components/messages/room-list.tsx`

## Changes

### 1. Strip watermark from the 4 non-ceremony surfaces
In each file, remove:
- The `import { SportsPoster } from "@/components/ui/sports-poster"` line.
- The `<SportsPoster fill opacity={0.08} />` JSX.
- If the containing wrapper was only there to host the absolutely-positioned watermark (e.g. a `relative overflow-hidden` div with no other children), collapse it.

Confirm each edit doesn't leave dead `relative` / `overflow-hidden` classes on wrappers that no longer need them.

### 2. Tighten `src/components/ui/sports-poster.tsx` doc block
Replace the current JSDoc with a doctrine block that names the exact allowed surfaces (bullet list above) and states: *"Not for authenticated app pages, lists, dashboards, or forms inside the app shell — the watermark is a ceremony marker, not a page skin."*

No API changes to the component itself. The `corner` / `size` / `inset` / non-`fill` props stay (unused today, but they were designed for future ceremony compositions and cost nothing to keep).

### 3. Lint rule in `eslint.config.js`
Add `@/components/ui/sports-poster` to the existing `no-restricted-imports` block with a message pointing at the doctrine:

```js
{
  name: "@/components/ui/sports-poster",
  message:
    "SportsPoster is reserved for ceremony surfaces (auth entry, signup roots, celebration). Do not import into authenticated app pages, lists, or dashboards. See the doc block in src/components/ui/sports-poster.tsx.",
},
```

Then append a second flat-config block that scopes an override for the 10 ceremony files, redefining `no-restricted-imports` for those files to only ban `server-only` (i.e. dropping the sports-poster entry):

```js
{
  files: [
    "src/routes/login.tsx",
    "src/routes/forgot-password.tsx",
    "src/routes/reset-password.tsx",
    "src/routes/i.$code.tsx",
    "src/routes/signup.athlete.tsx",
    "src/routes/signup.athlete.adult.tsx",
    "src/routes/signup.coach.tsx",
    "src/routes/signup.parent.tsx",
    "src/components/connection-celebration.tsx",
    "src/components/onboarding/invite-card.tsx",
  ],
  rules: {
    "no-restricted-imports": ["error", { paths: [{ name: "server-only", message: "…" /* same server-only message */ }] }],
  },
},
```

New ceremony surfaces added later will require an additive one-line change to this allowlist — that friction is the point.

## Verification

- `rg -n "SportsPoster|sports-poster" src/` returns exactly 11 hits: the component file + 10 ceremony imports/usages (2 per ceremony file, minus any I miscounted; will confirm).
- `bunx eslint src/` passes cleanly.
- Manually try `import { SportsPoster } from "@/components/ui/sports-poster"` in a scratch line in `coach.roster.tsx` → ESLint errors with the doctrine message. Remove the scratch line.
- Preview the 4 stripped pages at 390px: layout still holds, no visual regression beyond the missing watermark.

## Out of scope

- No changes to `<SportsPoster>`'s API or the ceremony pages' composition. This is a scope-tightening pass, not a redesign.
- No `<CeremonyPage>` wrapper. That's a future refactor if/when the ceremony surfaces prove they want shared scaffolding.
