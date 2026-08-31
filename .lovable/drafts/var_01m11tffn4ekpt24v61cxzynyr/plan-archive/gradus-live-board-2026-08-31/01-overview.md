# Gradus Live Board

A public, live-updating competition scoreboard. You add a competition in the admin
panel, Gradus prints a QR code for the rink sign, and anyone who scans it lands on
`/board/<slug>` — no account needed. Signed-in parents and athletes get their own
skater pinned to the top.

## What the prototype got right, and what changes

Kept:

- **Server-side fetching.** The USFS leaderboard sends no CORS headers, so the app
  can never read it from a phone. Gradus fetches and parses it on the server.
- **Three lanes.** "Just scored / on the ice / up next", because who is on the ice is
  an inference, never published. The caveat stays visible on screen.
- **30s cadence.** The source pages refresh at 30s; polling faster gains nothing.

Changed:

- **No Supabase Edge Function.** This codebase uses TanStack server functions and API
  routes. The scraper lives in `*.server.ts`, exposed through a server function.
- **One shared cache, not one fetch per viewer.** A hundred people at a rink must not
  become a hundred requests to USFS. Every board read is served from a
  `competition_snapshots` row that a single background refresh writes.
- **No custom CSS or new fonts.** The prototype ships its own palette and a
  `--ui-scale` variable. Gradus already has all of it: `bg-card`, `text-accent`,
  `pen-pool` / `pen-orange`, Fraunces, JetBrains Mono. Built from `Card`, `Tabs`,
  `Badge`/`Tag`, `Chip`, `Separator`, `Eyebrow`, `Sheet`.
- **Mobile first.** The prototype is a 4K TV board. This is a phone in a cold rink:
  one rink at a time, chosen with the existing segmented toggle, big type, thumb-sized
  targets.
