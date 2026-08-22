# Show "pending" connections in the coach visibility list

Right now the coach sheet only lists two things: requests waiting on *you*
(with Accept / Decline), and fully connected coaches. A link where you already
accepted but the other coach hasn't responded yet disappears entirely — you get
no confirmation that anything is in flight.

## What changes

The "Connected" list becomes a single list of the athlete's coach connections,
each row showing its state:

```text
Tami Taylor
for Jamie Gilmore                       [Turn off]

Dana Wilson                  Pending
for Jamie Gilmore                       [Turn off]
```

- Connected rows look exactly as they do today.
- Pending rows (you accepted, the other coach hasn't yet) show a small
  "Pending" tag next to the coach name and keep the "Turn off" button so you
  can withdraw.
- Requests still waiting on *your* answer stay in the top Accept/Decline block,
  unchanged.
- Declined links stay hidden.

## Where it changes

- `src/lib/coach-visibility.functions.ts` — `listMyCoachVisibility` returns a
  third bucket, `awaiting` (myStatus accepted, theirStatus pending), alongside
  `pending` and `connected`.
- `src/components/coach/coach-visibility-sheet.tsx` — render `connected` and
  `awaiting` in the same list, with a "Pending" tag on the awaiting rows.
- The settings row subtitle counts connected + awaiting so the count matches
  what the sheet shows.

No schema, policy, or toggle behavior changes.
