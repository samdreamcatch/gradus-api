# Fix React #418 (hydration mismatch) — and stop it recurring

## What the error actually is

React #418 = "the server-rendered HTML didn't match the client." It is a **recoverable** error: React throws away the mismatched server HTML for that subtree and re-renders it in the browser. Nothing breaks for the user — that's why it has been quietly accumulating (16 anonymous hits between early July and mid-August) instead of showing up as broken pages.

It reaches our admin error list because React 19 reports recoverable errors through the global `reportError`, which fires a `window.error` event — and `src/lib/client-error-reporter.ts` reports every one of those as a normal client error. So today it looks like a crash in the dashboard but behaves like a warning in the app.

## Where it's happening and why we can't yet name the line

Both affected routes (`/login`, `/p/<share-token>`) are **public, server-rendered, anonymous-visitor** pages — the only pages where server HTML is delivered to people who are not signed in. Reading through them and everything the root renders (theme provider, install banner, dev-tools mount, Turnstile widget, logo, share-plan page), all the browser-only work is already correctly deferred to effects or `useSyncExternalStore` server snapshots. Nothing in the source is an obvious mismatch, and the production message is minified, so it carries no component name or diff.

The two realistic causes, which the work below distinguishes rather than assumes:

1. **Third-party DOM mutation before hydration** — mobile browser auto-translate, in-app browsers (Instagram/Facebook/Line), and extensions rewrite text nodes on public pages. This is the classic profile: anonymous only, public pages only, low and steady rate, never on authenticated routes.
2. **A genuine server/client divergence** somewhere in the shared shell that only triggers under certain conditions (locale, cookie/session state, preview vs production host).

## Plan

### 1. Make the error self-diagnosing (do this first)

Right now the report tells us nothing. Enrich hydration reports at the reporter level:

- Detect React errors #418 / #423 / #425 by message and tag them `type: "hydration"`.
- Attach diagnostic context: route, `document.documentElement.lang` and `class`, whether the page shows translation markers (`<html translate>`, `.translated-ltr/rtl`, `font[_msttexthash]`, Google Translate nodes), and a short user-agent classification (in-app browser / iOS Safari / etc.).
- Record them at reduced severity so they stop reading as crashes.

After a few days of production data this tells us definitively which of the two causes it is — translated/in-app sessions clustering means cause 1, clean modern-browser sessions means cause 2 and we chase the specific subtree.

### 2. Stop the noise, keep the signal

- Exclude recoverable hydration reports from the hourly error digest email and from the "errors" headline count; surface them in `/admin/errors` under their own filter so they stay visible without paging anyone.
- Keep a rate cap so a single translated session can't emit dozens of rows.

### 3. Harden the public shell against real mismatches

Preventive, low-risk, applies whichever cause wins:

- Add `translate="no"` to the small set of dynamic, non-prose nodes on public pages where translation rewriting is both likely and harmless to suppress (logo wordmark, share-plan move counts/units), and `suppressHydrationWarning` on the text nodes that render loader-provided user content.
- Add a shared `useHydrated()` / `<ClientOnly>` helper and use it for anything whose *rendered output* depends on the browser, so future code has an obvious safe path instead of inventing one.

### 4. Guard it in CI so a real regression can't ride in unnoticed

Add a production-build hydration smoke check over the public routes (`/`, `/login`, `/p/:token`, `/i/:code`, `/g/:token`, the signup steps): load each with a clean headless browser and fail the run if any recoverable hydration error fires. A clean browser has no translation or extensions, so anything it catches is a genuine code-level mismatch — which is exactly the separation we currently lack.

## Technical notes

- Files touched: `src/lib/client-error-reporter.ts` (classification + context), `src/lib/error-tracking.functions.ts` / `src/routes/api/public/hooks/error-digest.ts` (digest filtering), `src/routes/_authenticated/admin.errors.tsx` (hydration filter), `src/components/logo.tsx` and `src/routes/p.$token.tsx` (translate attributes), a new `src/hooks/use-hydrated.ts`, and a CI script under the existing GitHub Actions workflow.
- No schema change: `client_errors.metadata` already carries arbitrary JSON, and `source` stays `client`.
- No change to `src/routes/__root.tsx` hydration behavior — the `<html suppressHydrationWarning>` + theme init script pattern there is already correct.

## Sequencing

Step 1 and 2 ship together (one deploy, immediate noise reduction plus data collection). Step 3 and 4 ship next. If step 1's data points at a real code mismatch, that fix is added on top with the exact subtree named — no guessing beforehand.
