## Technical notes

All changes stay in `src/components/board/my-skaters.tsx`.

- **Chip:** replace `selected={isFollowed}` with `tone="muted"`; label `"Unfollow"` when followed, `"Follow"` otherwise. Keep `aria-pressed` and the existing `aria-label`.
- **Group ordering:** after grouping, compute a per-group rank key from its rows — `0` if any row is `on-ice`; otherwise the earliest `startIso` among rows not yet `scored`; otherwise (all scored) a bucket that sorts after every upcoming skater, ordered by most recent start first. Sort `groups` on that key before render. Rows within a group keep the existing `sortAt` order.
- **Next-up row:** the group's `on-ice` row if present, else the first non-`scored` row. That row gets an accent-tinted background, a 3px accent left edge, and `Tag tone="accent"`. Other rows keep `bg-elevated` and the default tag tone; the `changed.has(m.key)` flash still layers on top.
- `findMySkaters`, `stateTag`, and `metaParts` are unchanged.
