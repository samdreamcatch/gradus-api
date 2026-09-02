# A banner that's actually there when you land

## What happened

You signed in from the Live Board and landed in your account with no way back.
That is the current design, not a glitch. The banner at the top of the signed-in
app only appears when **all three** of these are true at that moment:

1. A board was visited on this device (stored locally).
2. That competition is inside its live window.
3. One of the skaters you follow is *right now* on the ice, up next, or has just
   been scored.

Miss any one of those — a gap between events, no followed skater yet, a
competition between days — and the banner renders nothing. Coming straight from
the board is exactly the moment you most expect a way back, and it's the moment
least likely to satisfy condition 3.

On top of that, the moment you reach the signed-in app the stored "came from the
board" path is deleted, so nothing else can offer the return either.

## What to change

Make the banner a **return path first, a status ticker second**.

- If you arrived from a board in this session, the banner is always there, no
  matter what is happening on the ice.
- When there *is* something to say about a skater you follow, it says that —
  same wording as today.
- When there isn't, it falls back to the competition name, or simply "Back to
  the Live Board".
- Dismiss still works, and still only hides that competition.
