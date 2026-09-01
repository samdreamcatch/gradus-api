# Sign in from the board, and a live "your skaters" banner

Two changes, both built from components already in the app.

## 1. An obvious way in, from the board

Today the only sign-in prompt on a board is one line of small text at the bottom of the
Following tab. Instead:

- **Board header:** next to the LIVE / FINISHED tag, show a small account affordance.
  Signed out it reads **Sign in**; signed in it shows a link into the app (Home).
  Same treatment on the boards index page.
- **Tapping "Sign in"** opens a bottom sheet (the app's standard overlay) with two paths:
  - **Sign in** — goes to the login screen and returns to the exact board afterwards.
  - **New to Gradus?** — three choices, parent / coach / athlete, each going to that
    role's existing signup flow.
- **Following tab:** when nobody is signed in, replace the small text link with a proper
  card: "Sign in and your athletes show up here automatically." Manual follow still works
  without an account, so nothing is taken away from anonymous viewers.

## 2. A live banner while they use the app

Once signed in, a slim sticky bar appears at the top of any page in the app while a
competition they are following is live — the same pattern as the existing running-session
pill, so it never fights with the rest of the UI.

- It reports the most urgent thing happening: "Addie is ON THE ICE at A Rink",
  "Nora is up next", "Josephine scored 41.28 — 2nd".
- It refreshes every 30 seconds while the tab is open and disappears when the
  competition is over or nothing is happening.
- Tapping it opens that board's Following tab.
- Followed skaters stay on the device (as today), combined with the athletes their
  account is already connected to.
- Dismissible: an x hides it for that competition until the next visit.
