## Goal

Make it obvious that ending the timer is the moment the parent reports back to the coach (a feedback modal opens), and introduce **Pen Pink** as a reserved "live / action-required" color used on the active timer pill and unread coach messages.

## 1. Timer UX — slide-to-start, big "End session" finish

Today the gesture is symmetric (slide to start / slide to pause / slide to resume) which hides the fact that finishing triggers a feedback step. Redesign the running state so "End session" is the prominent action and clearly implies "wrap up & report back".

**Idle state** (no time logged yet)
- Single full-width pill: `Slide to start session →` — unchanged from today.
- Tennis accent. Hint label "to start".

**Running state** (timer counting)
- Pill turns **Pen Pink** (the new attention color) with a live dot pulsing next to the running clock.
- Two distinct controls inside the pill:
  - Left zone: tappable `MM:SS` with a small pause icon — quick pause/resume, no drag.
  - Right zone: prominent `End session →` slide knob (the only draggable thing). Slide it to the right to end. Label explicitly says **"End → report back to {coach}"** so the modal is signaled before it appears.
- Reset (discard session) demoted to a small `×` icon at the far edge with a confirm step.

**Paused state**
- Same pink pill, dot stops pulsing, label changes to `Paused · MM:SS`. Same "End session" slide on the right. Tapping the clock resumes.

**End → Feedback modal**
- Releasing the End slide past the threshold opens a centered modal.
- **Modal body is intentionally left blank for this iteration** — placeholder content only (eyebrow with `MM:SS` and plan title, plus a "Coming soon" note). The user will share screenshots before we design what goes inside.
- Submitting (whenever it's built) will clear the timer back to idle. For now, closing the modal also resets state so the flow can be tested end-to-end.

Frontend-only this iteration — no DB writes, no server function.

## 2. Pen Pink as the "attention" token

This is a standard UI pattern (notification dots, recording indicators, "you have a live thing" pills). Adding it deliberately and narrowly:

- Add tokens in `src/styles.css` (light + dark):
  - `--pen-pink`, `--pen-pink-wash`, `--pen-pink-ink`
  - Aliases: `--attention`, `--attention-wash`, `--attention-ink`
- Register Tailwind color names: `attention`, `attention-wash`, `attention-ink` (so we get `bg-attention`, `text-attention-ink`, etc.).
- **Usage rules** (documented in a short comment block in styles.css and respected in code):
  - Only for live or action-required affordances.
  - Approved uses today: (a) active/paused session timer pill, (b) unread coach-message indicator (badge dot + row accent in the messages list / bottom-nav).
  - Never used as a general accent, button, or decoration — Tennis/Pool keep that job.

## 3. Unread coach messages

Out of scope for actual messaging logic, but wire the visual token so it's ready:
- Add an `unreadCount` prop path on the parent bottom nav's Messages item. When `> 0`, render a small `bg-attention` dot. Stubbed to `0` until messaging ships.

## Technical notes

- File to change: `src/routes/_authenticated/parent.plans.$planId.tsx` — split `SessionTimer` into clearer sub-pieces (`IdleSlide`, `RunningPill`, `EndSessionSlide`) and add an empty `SessionFeedbackModal` shell using the existing shadcn `Dialog` from `@/components/ui/dialog`.
- Tokens: edit `src/styles.css` (`:root`, `.dark`, and the `@theme inline` block).
- Bottom nav: light touch in `src/components/parent/bottom-nav.tsx` to support an unread dot.
- Keep `framer-motion` for the End slide spring; remove drag from the running-state clock to avoid two competing gestures.
- No DB migration, no server functions, no new packages.

## Out of scope

- Feedback modal contents (deferred — user will provide screenshots).
- Persisting sessions or messages.
- Coach-side inbox / feedback viewer.
- Push or email notifications.