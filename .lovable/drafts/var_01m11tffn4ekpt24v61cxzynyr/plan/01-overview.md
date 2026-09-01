# Following cards: quiet the follow chip, accent what's next, order by what's next

Two things on the Following tab. The accent-filled "Following" chip is the loudest element on every card while saying the one thing the tab already implies. And skater order is only incidentally chronological — it falls out of how rows happen to sort, not a stated rule.

## Changes

1. **Follow control becomes a quiet unfollow.** The accent chip becomes a small muted chip labelled "Unfollow" — same tap target, same action, neutral ink.
2. **Accent moves to the next event.** For each skater, the soonest upcoming event row gets an accent-tinted background, an accent left edge, and an accent time tag. Later rows and already-scored rows stay quiet. A skater currently on the ice takes the accent instead.
3. **Skaters reorder by who is up next.** Each skater is ranked by their own next moment on the ice: on the ice now first, then by the start time of their soonest upcoming event, then skaters whose day is done (most recent result first). Order refreshes with each board poll, so the card at the top is always the one to watch.
4. **Skater name stays as is** — small, bold, unchanged.

Existing components and tokens only (`Card`, `Chip`, `Tag`). No new components.
