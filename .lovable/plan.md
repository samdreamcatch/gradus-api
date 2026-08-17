# Find the real cause of the React #418 hydration error

## What we know so far (verified, not assumed)

Pulled the actual records from the error log:

- 19 occurrences total, across four page loads: `/login` (6, most recent Aug 17) and three shared-plan links `/p/<token>` (13, early July).
- Every single one is an **iPhone** — Mobile Safari 26.x and Chrome-on-iOS. No desktop, no Android.
- Every one is an **anonymous visitor** (not signed in).
- They arrive as a browser-level `window.error`, which for React 19 means the *recoverable* path: React noticed the server HTML didn't match, threw the page's server markup away, and re-rendered it in the browser. That usually looks like a flicker rather than a crash, which fits "no user reports."

The explanation attached to the error in the screenshot ("a component is returning raw HTML") is wrong. #418 means "the HTML the server sent didn't match what the browser built." I read the login page, the app shell, the theme provider, the install-banner store, and the dev-tools mount — none of them render anything that could differ between server and browser (no clock reads, no random values, no reading the browser's storage during render). So the mismatch is very likely **not our render code**.

## The leading theory

The two affected pages are exactly the two links people open from their phone: a login link and a shared workout link. On iOS, something commonly rewrites the page *before* React gets to it:

- Safari's data detectors auto-linking dates, times, phone numbers and addresses inside text.
- Safari or Google translating the page on the fly.
- In-app browsers (Instagram, Gmail, Messages) injecting their own elements.

Any of these edits the page, so React's check fails. This is a real theory, not a confirmed cause — which is why we measure before we change anything.

## Step 1 — Diagnose (one publish, no behavior change)

Add a narrow diagnostic that runs only when a hydration mismatch actually happens, and record with the error:

- Which element and which text mismatched (React hands us this on the recoverable-error hook).
- Whether the page was translated at the moment of the error (translation tools leave a detectable mark on the page).
- Whether Safari's data detectors rewrote any text into links.
- Whether the visitor is in an in-app browser, and which one.
- Whether any unexpected elements were added to the page before React started.

Nothing user-visible changes. Publish, then wait for the next few iPhone visits to `/login` or a shared plan link to come in — going by history that's days, not weeks. If you want it faster, opening `/login` and a shared plan link on an iPhone from inside Instagram/Gmail and with Safari translate on will usually reproduce it immediately.

## Step 2 — Fix the confirmed cause

Once the diagnostic names the cause, apply the matching fix and nothing else:

- Data detectors: tell iOS not to auto-detect dates/phones/addresses on these pages.
- Translation: mark the parts that must not be rewritten.
- In-app browser injection: nothing to fix in our markup; instead make the affected page render on the client for that case so there's nothing to mismatch.
- If it turns out to be our own code after all: fix that component directly.

I'll confirm the fix by watching the same error log go quiet on iOS.

## About the "CI smoke test" you asked about

It's an automated check that runs on every code change: a headless browser loads the key public pages and fails the build if the browser reports a hydration mismatch. The point is that this class of bug is invisible in normal use — it only shows up in the error log days later. The check would catch it at the moment someone introduces it.

It is not part of this plan. I'll mention it again once we've confirmed the cause, and only if the cause turns out to be our own code (if it's iOS rewriting the page, the check wouldn't have caught it anyway).

## Technical notes

- Register `onRecoverableError` on the router in `src/router.tsx` so hydration errors carry their diff/component info instead of arriving as a bare minified `window.error`.
- Extend `reportError` metadata in `src/lib/client-error-reporter.ts` with the environment signals above; keep the existing 50-report session cap and production-host gate.
- Tag these reports as `type: "react.hydration"` so they group separately from genuine crashes in `client_errors`.
- No changes to `__root.tsx` render output, the login form, or the shared-plan page in this step.
