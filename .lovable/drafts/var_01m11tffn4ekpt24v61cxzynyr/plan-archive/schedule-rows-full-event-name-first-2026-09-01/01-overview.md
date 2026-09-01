# Schedule rows: full event name first

On the Schedule tab, the event name is the thing people scan for, but today it
truncates on mobile while the time column and the skater count take up room.

Changes to each schedule row:

- Shrink the time to a smaller mono size and narrow its column, so more width
  goes to the event name.
- Let the event name and segment wrap onto two lines instead of truncating —
  the full name is always readable on a phone.
- Drop the skater count from the meta line; keep only the location (rink).
- Keep the status tag, live dot, accent left edge for your skaters, and tap
  behaviour exactly as they are.
