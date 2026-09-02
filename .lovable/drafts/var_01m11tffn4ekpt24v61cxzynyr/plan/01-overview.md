# A way back to the Live Board

Today, someone who taps the greyed-out bottom nav on a board, opens the sign-in
sheet, and lands on Sign in or one of the sign-up screens has no way back: the
sign-up screens have no board link, and browser back is unreliable after a
Google round trip.

The fix is a small, consistent escape hatch. When a visitor leaves the board for
an account screen, we remember which board they came from for that browser
session. Every auth screen they can reach — Sign in, and each of the three
sign-up entry screens — shows a quiet "Back to the Live Board" link at the top.
Tapping it returns them to exactly the board they were watching, with their
followed skaters intact.

The memory clears once they finish signing in or signing up (they then get the
board banner in the signed-in app instead), and it never appears for someone who
arrived at Sign in from anywhere else.
