# Bottom nav on the Live Board

Short answer on lift: small — roughly one new hook, one new wrapper component,
and a few lines in the board page. No database, no routing, no new nav designs.
Everything reuses the three bottom navs that already exist (coach, parent,
athlete) and the sign-in sheet already on the board.

What changes:

- **Signed out:** the bottom nav appears in a greyed, non-navigating state so
  the shape of the app is visible. Tapping any item opens the existing
  "Sign in or sign up" sheet instead of navigating.
- **Signed in:** the real bottom nav for that person's type renders (coach /
  parent / athlete), fully live. They get back to the board through the
  following banner that already sits at the top of the signed-in experience.
- The board page gets bottom padding so the last row isn't hidden under the bar.

One decision baked in: the greyed-out signed-out nav uses the parent/athlete
shape (Plans, Resources, Messages, Settings) since a spectator scanning a QR
code is far more likely to be a parent or athlete than a coach.
