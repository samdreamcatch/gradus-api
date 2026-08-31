# See the Live Board before accepting the draft

The board is fully built, but its two tables only exist once the draft is accepted, so
there is nothing for it to read yet. To let you look at the real UI right now, add one
built-in **demo competition** that lives in code instead of the database.

Open `/board/demo` and you get the actual board screen — real components, real layout,
real lane logic — filled with a realistic Skate Detroit day: three rinks, a live event
mid-flight, an idle rink counting down, and a rink that just finished.

Nothing about the production path changes. Any other slug still goes to the database
exactly as it does today.
