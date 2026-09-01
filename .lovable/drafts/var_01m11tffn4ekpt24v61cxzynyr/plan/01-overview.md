# Following cards: quiet the follow control, move accent to what's next

On the Following tab, every card currently wears a filled accent "Following" chip. It's the loudest thing on the card and says the one thing the tab already implies. The accent should mark the event that's actually coming up next.

## Changes

1. **Follow control becomes a quiet unfollow.** The accent-filled "Following" chip is replaced by a small muted chip labelled "Unfollow" — same tap target, same action, neutral ink. It no longer competes with the skater name.
2. **Accent moves to the next event.** For each skater, the soonest upcoming (not yet skated, not yet scored) event row gets the accent treatment: a subtle accent-tinted row with the time tag in accent tone. Rows already scored, and rows further out in the day, stay neutral.
3. **ON THE ICE keeps its accent** — a skater currently competing outranks "next up," so when a row is live it takes the accent instead.
4. **Skater name stays as is** — small, bold, unchanged.

Everything uses existing components (`Chip`, `Tag`, `Card`) and existing tokens. No new components.
