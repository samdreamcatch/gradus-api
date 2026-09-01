# Calm the wheel: keep the spin, drop the tilt

My recommendation: get rid of the curve, not add more.

The tilt is what makes it look chaotic. Right now every card rotates 2° per step, scales down, and fades out at the same time, while the whole stack slides continuously and never lands anywhere. Three effects moving at once on dense, text-heavy cards reads as debris, not as a dial. Adding more curve makes text harder to read in a rink and makes the cards fight the rest of the page, which is strictly flat editorial cards.

What actually makes something feel like a rotary is not the tilt — it's the resistance and the snap. So keep the gesture, remove the wobble.

## What changes

- No rotation. Cards stay flat and square to the page, exactly like every other card in the app.
- Depth comes from one axis only: neighbours sit slightly smaller and softer, with tighter falloff so the ±1 card is clearly a card and the ±2 card is a quiet edge, not a ghost.
- The stack snaps to a card instead of floating between two. While you drag it follows your thumb; on release it settles onto the nearest card, then returns to the live skater.
- The top and bottom edges of the window fade out (a soft mask), so cards enter and leave instead of being abruptly clipped.
- The centre card keeps its full weight, role label, and tap-for-protocol behaviour. Everything else stays as it is.

## What stays

Card design, tokens, lane colors, role labels, the earlier/later buttons, keyboard access, spring-back to the skater on the ice, and all board data.
