## Changes

All in `src/components/board/rink-panel.tsx` — the only file on the board that
uses the attention token.

1. `LANE_STYLE.next` becomes:
   - border: `border-l-accent/40`
   - background: `bg-accent/5`
   - label: `text-text-secondary`
   - score: `text-text-tertiary` (unchanged)
2. The "nothing on the ice" countdown (`text-attention-ink`) becomes
   `text-text-secondary`, so the big number reads as information, not alarm.
3. The `NEXT` footer time stamp (`text-attention-ink`) becomes
   `text-text-secondary`.

## Not changing

- Just scored (pool) and On the ice (accent) lanes.
- Any LIVE tag, status text, badge, or the schedule board — those already use
  `accent` / `default` tones.
- No new tokens or CSS; only existing semantic classes.

## Verification

Prettier + typecheck + lint, then Playwright on `/board/demo` at 390x844 and
1280x1800 to confirm the three lanes and the empty-rink state render with no
orange left and no console errors.
