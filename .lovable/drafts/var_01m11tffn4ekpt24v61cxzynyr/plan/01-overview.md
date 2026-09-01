# Clearer rink status dots

Today a live rink tab shows a small accent dot and an idle rink shows nothing, so the dot reads as decoration and the absence of a dot reads as a bug.

The fix: **every** rink tab gets a dot, always in the same spot.

- Live rink — accent dot with a soft pulse (a halo ring that expands and fades, roughly a 2s loop), so "in progress" is legible at a glance.
- Idle rink — a flat grey dot (tertiary ink), no motion: the slot is filled, so the difference between rinks is a state difference, not a missing element.

Accessibility: the pulse is disabled under reduced-motion (dot stays solid accent), and each tab keeps a screen-reader-only "live" / "idle" label so the meaning never rests on color alone.
