# Make the wheel actually turn — or drop the curve

The rule you set is the right one: a curved stack that can't be spun is just a crooked card. So this plan does two things in order — make the turn real, and if it still doesn't turn under your finger, remove the curvature and go back to the flat three-lane card.

What I can confirm today: with a mouse drag on the demo board the cards do move (I drove a drag and watched the transforms change), and the container is set to hand vertical gestures to the wheel. So the mechanics exist, but that is not proof it works under a real finger on a real phone, and your experience says it doesn't. I'm not going to name a root cause I haven't confirmed on touch — step one is reproducing it on touch.

## What changes

1. **Reproduce on touch.** Drive the board with real touch events at phone width and watch whether the wheel moves or the page scrolls instead.
2. **Make the gesture unmissable.** Whatever the reproduction shows, the wheel gets the standard treatment for a vertical drag surface living inside a scrolling page: the gesture claims vertical movement outright, the drag starts from anywhere on the card (not only the center one), and a short drag moves a full card instead of feeling stuck.
3. **Make it look turnable.** Right now nothing tells you the card is a wheel. The neighbours above and below peek in a little further so there is visibly something to spin toward.
4. **If it still won't turn on your device:** the curvature, the tilt, and the drag come out, and the Live card returns to the plain JUST SCORED / ON THE ICE / UP NEXT stack. No half-curved compromise.

## What does not change

Data, refresh, statuses, the protocol sheet on tap, the Schedule and Following tabs, the NEXT footer, and every token and color on screen.
