# Name who was declined

Today a declined pairing reads just "Tami declined" — it doesn't say which other coach the request was about. With more than one coach on an athlete, that line is ambiguous.

## Change

In the connection-details popover, declined lines name both sides:

- "Tami declined connecting with Dana" (this coach declined)
- "Dana declined connecting with Tami" (the other coach declined)

Accepted and pending lines stay exactly as they are ("Connected with Dana", "Tami accepted — waiting on Dana").

The one-line summary of counts ("1 accepted · 2 pending · 1 declined") is unchanged.

## Technical

Single edit in `src/components/parent/coach-visibility-toggles.tsx`, in `pairLabel`: replace the two declined branches with versions that include the other coach's first name. No data, query, or component-structure changes.
