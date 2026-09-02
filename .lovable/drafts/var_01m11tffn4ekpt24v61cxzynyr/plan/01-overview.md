# Competition recap prompt

When a parent or athlete scans the QR code at a competition and opens the live board, Gradus should ask them afterward how it went — and keep that reflection on the athlete's record where their coach can read it.

## What the person sees

1. **At the competition** — nothing new. Opening the board while signed in quietly records "this account was at this competition." Following a skater is not required; simply viewing the board counts.
2. **After the competition finishes** — the next time they open Gradus, a card appears at the top of their home screen: *"How did Fall Classic go?"* with **Write recap** and **Not now**. It reappears for up to 7 days, then stops asking.
3. **The recap sheet** — a bottom sheet in the app's paper style with one question, *"How did the competition go?"*, a single text box, and the helper text *"What went well? What didn't go well? Any feedback?"* No rating scale. Submitting saves it and thanks them.
4. **Who it's about** — we assume it's their athlete in the sport the competition belongs to. The sheet only asks "Who is this about?" when the parent has more than one athlete in that sport; a name match against a followed skater still wins when we have one.

Parent and athlete each get their own prompt and their own recap, attributed by name — one does not close the other's.

## Where it lands

The recap is saved to the athlete's record **and** sent to the coach as a message, so it can't be missed:

- On the coach's athlete detail sheet, in the competition section next to results, labeled with who wrote it and when.
- As a message in the existing coach conversation for that athlete, from the parent or athlete who wrote it, carrying the recap text.
- To the parent/athlete themselves and any co-guardian on a Team Plan.

Nothing appears on the public board, and nobody outside the athlete's existing circle can see it.
