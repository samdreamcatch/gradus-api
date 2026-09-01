## Technical notes

All changes are confined to `src/components/board/my-skaters.tsx`.

- **Chip:** swap `selected={isFollowed}` for `tone="muted"`, label `"Unfollow"` when followed and `"Follow"` when not, keeping `aria-pressed` and the existing `aria-label`.
- **Next-up computation:** within each skater group, pick the first row that is `on-ice`, else the first row whose state is not `scored` (rows are already sorted by `sortAt`). Store its `key`.
- **Row styling:** that row renders with an accent-tinted background plus a 3px accent left edge; its `Tag` uses `tone="accent"`. All other rows keep `bg-elevated` and the default tag tone. The existing `changed.has(m.key)` flash still applies on top.
- No changes to `findMySkaters`, `stateTag`, or `metaParts` beyond wiring the accent decision.
