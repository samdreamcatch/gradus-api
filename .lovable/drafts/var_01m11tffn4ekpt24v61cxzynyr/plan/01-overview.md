# Rotary start order on the Live tab

Keep the Live card exactly as it is — same three lanes, same type, same tokens. Change how you move through it.

Today the card shows a fixed window: just scored, on the ice, up next. That window is the only thing you can ever see. The idea here is to make that window a wheel: the whole start order of the current event, one skater per card, gently curved, that you can spin backwards to earlier scores or forwards to later skaters — and that always springs back to the skater on the ice when you let go.

The full start order for the live event is already in the board data, so nothing about scraping, refreshing, or statuses changes. This is presentation and gesture only.

## How it behaves

- The card in the center is the current moment. It carries the same weight and the same role label it has today — ON THE ICE, or JUST SCORED when nobody is on yet.
- Drag up or down and the stack rotates. Neighbors fan on a subtle arc: a couple of degrees of tilt, a small vertical offset, slightly reduced and softened as they move away from center. Text stays flat enough to read in a cold rink.
- Cards behind the current moment show their posted score. Cards ahead show name, club, and start number with no score yet.
- Let go and it springs back to the live skater. There is no "stuck browsing" state — the board is always about now.
- A new score arriving while you are spinning does not yank the wheel. It settles when you release.
- Tapping the centered card still opens the full protocol sheet, exactly as it does now.

## What does not change

Header, tab bar, rink chips, the Schedule and Following tabs, the NEXT footer row, colors, statuses (SCHEDULED / LIVE / FINAL), and every piece of data on screen.
