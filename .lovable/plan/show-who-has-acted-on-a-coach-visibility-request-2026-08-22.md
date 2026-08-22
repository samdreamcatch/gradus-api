# Show who has acted on a coach-visibility request

Today each coach row under an athlete collapses everything into one generic line:
"Waiting on coaches to accept". That stays the same whether nobody has responded,
this coach already accepted, or another coach declined. The plan is to surface the
actual state of each coach pairing.

## What the parent will see

For a coach that is toggled on, the line under their name reflects real responses:

| Situation | Line |
| --- | --- |
| No other coach on yet | On — add another coach to connect |
| Neither side responded | Waiting on Tami and Dana to accept |
| This coach accepted, other hasn't | Tami accepted — waiting on Dana |
| Other accepted, this coach hasn't | Waiting on Tami to accept |
| Both accepted | Connected with Dana |
| Either side declined | Tami declined · Connected with Dana |

When a coach is paired with more than one other coach, the line summarizes the
mix (for example "Connected with Dana · Waiting on Chris"), and each pairing is
listed on its own small row underneath so a parent can see exactly which
connection is stuck and who it is stuck on.

Toggled-off coaches keep the plain "Off" line.

## Where it shows up

Both places these rows already appear:
- Parent settings, the coaches list inside each athlete card (the row selected).
- The Team plan page's Coach visibility section.

No new components — same list markup, same text styles, just richer content.

## Technical notes

- `listCoachVisibility` in `src/lib/coach-visibility.functions.ts` currently maps
  every related row through `pairState()` and collapses to one string. It will
  additionally return, per coach, a `pairs` array: the other coach's id and name,
  this coach's own side status, and the other side's status (resolved from
  `coach_a_id`/`coach_b_id` against `a_status`/`b_status` on
  `coach_visibility_links`). The existing `status` field stays for compatibility.
- `statusLabel()` in `src/components/parent/coach-visibility-toggles.tsx` becomes
  a function that takes the coach row (name + pairs + enabled) and returns the
  summary line, plus a small helper that returns the per-pair detail lines.
  Both consumers already import from this module, so the copy stays in one place.
- The optimistic toggle in `useCoachVisibility` will clear/rebuild `pairs`
  alongside `status` so the row doesn't flash a stale label mid-update.
- No schema change, no migration — all data needed is already on
  `coach_visibility_links`.
