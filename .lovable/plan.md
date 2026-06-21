# Persistent Plan Session Timer

Currently `SessionTimer` lives inside the plan detail page. When the user navigates away (e.g. opens "Message Coach about this plan", or taps the bottom nav), the component unmounts and the timer state is lost. There's also nothing to keep the screen alive on mobile.

This plan makes a started session a global, persistent thing for both parent and athlete roles.

## What changes for the user

1. **Screen sleep doesn't stop the timer.** Elapsed time is wall-clock based against a stored start timestamp, so even if the OS suspends JS, on wake the timer shows the correct elapsed time. We additionally request a Screen Wake Lock while a session is running so the screen stays on while the plan page is foregrounded.
2. **Timer survives navigation.** Starting a session writes the active session to a global store (in memory + `localStorage`). Navigating to messages, settings, or any other page keeps it running.
3. **Always-visible "session in progress" bar.** While a session is active, a slim pill appears pinned near the top of every parent/athlete page (above bottom nav, below header) showing `● 12:34 · <Plan title>` and a "Return" affordance. Tapping it routes back to that plan's page where the existing `RunningPill` controls take over (pause/discard/end). The bar uses the existing `attention` design tokens — same look as `RunningPill` — so it stays inside the design system.
4. **End / discard / submit still happen on the plan page**, exactly like today. The global bar is just a status + jump-back.

Only one active session at a time per user. Starting a new session while one is active is blocked with a toast ("You already have a session running on <plan>. Return to it first.").

## Technical sketch

New files:

- `src/lib/active-session-store.ts` — small React context + provider with state `{ planId, role: "parent"|"athlete", planTitle, coachFirstName, athleteFirstName, startedAt: number, accumulatedMs: number, paused: boolean } | null`, plus `start / pause / resume / clear / getElapsedMs()`. Hydrates from `localStorage` on mount and writes through on every change. Single source of truth — no per-page `useState` for elapsed/running anymore.
- `src/hooks/use-wake-lock.ts` — wraps `navigator.wakeLock.request('screen')`, re-requests on `visibilitychange`, releases on unmount or when called with `false`. No-ops where the API is unsupported.
- `src/components/plans/active-session-bar.tsx` — reads the store; renders nothing when null. When set, renders a sticky pill (uses `bg-attention/15`, `text-attention-ink`, pulsing dot — matches `RunningPill`) with the plan title and current elapsed (re-ticks every 1s via `requestAnimationFrame`/`setInterval`). Clicking navigates to `/parent/plans/{id}` or `/athlete/plans/{id}` based on stored role.

Edits:

- `src/routes/_authenticated.tsx` — wrap `<Outlet />` in `<ActiveSessionProvider>` and render `<ActiveSessionBar />` above the outlet so it shows on every authenticated page (parent and athlete shells inherit it; coach pages won't have an active session so the bar self-hides).
- `src/routes/_authenticated/parent.plans.$planId.tsx` — replace local `running`/`elapsed`/`baseRef` state in `SessionTimer` with the store. `handleStart` calls `store.start({...})`. `handleTogglePause` toggles `paused`. `handleEnd` opens the feedback modal but keeps the store entry until the modal is submitted or discarded (so navigating away mid-feedback still preserves elapsed). On successful submit or discard, call `store.clear()`. Call `useWakeLock(running)` while running.
- `src/routes/_authenticated/athlete.plans.$planId.tsx` — same refactor, role `"athlete"`, using `submitAthletePlanSession`.
- `src/components/plans/session-timer-controls.tsx` — unchanged API; still receives `mm`, `ss`, `running` as props from the new store-driven parent.

Behavior detail: if the active session in the store doesn't match the current plan's `planId`, the plan page renders `IdleSlide` disabled with a small "Session active on another plan — return to it" inline note and a link, instead of letting the user start a second timer.

No backend, schema, or server-function changes. No design-token additions — bar reuses `attention` tokens already used by `RunningPill`.
