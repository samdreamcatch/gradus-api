# Rink tabs: clearer status dots + clearer front tab

Two changes to the manila tab strip on the Live board.

**1. Status dots (approved earlier, still to build)**
Every rink tab gets a dot in the same slot. Live rinks get an accent dot with a soft pulsing halo (~2s loop); idle rinks get a flat grey dot. Nothing is missing on an idle tab — the difference reads as a state, not a bug. The pulse is dropped under reduced-motion, and each tab keeps a screen-reader-only "live" / "idle" label.

**2. Front tab vs. back tabs**
Right now the unselected tabs are `bg-elevated`, which is nearly identical to the card, so all three read as one continuous shape. Fix:

- Back tabs sit on a visibly darker/greyer paper tone than the card, with a slightly stronger top border and no shadow.
- Back tab labels use secondary ink; the front tab uses primary ink at the same weight as today.
- Back tabs stay a few pixels shorter than the front tab, and the front tab keeps its shadow and flush-into-card bottom edge, so it clearly sits on top of the stack.

While in there: the tab labels are currently clipping ("A RINK" wrapping and cut off in the screenshots). Tabs will be set to not wrap so each label stays on one line.
