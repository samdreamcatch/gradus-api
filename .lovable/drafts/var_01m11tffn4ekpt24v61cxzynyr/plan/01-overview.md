# Retire the orange tone on the Live Board

Orange (`attention`) is reserved for live / action-required states. On the board
it is currently used for anticipation, not action: the "Up next" lane and the
countdown-to-next-event numbers. Those move to a dimmed version of the board's
own accent pen, so the three lanes read as one family fading out.

Presentation only — no data, scraping, or status-logic changes. Statuses stay
SCHEDULED / LIVE / FINAL.
