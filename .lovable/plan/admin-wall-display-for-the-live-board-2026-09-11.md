# Admin wall display for the live board

A second, admin-only version of the live board built for a monitor turned sideways (portrait). Instead of switching between rinks with tabs, every rink is shown one under the other, top to bottom, so the whole competition is readable from across the room.

## What you get

- A new page reachable only when signed in as an admin: `/admin/board/<event>`.
- Header: competition name, dates/location, a LIVE or FINISHED marker, and the time of the last update.
- Every rink stacked vertically, in the order they appear on the public board. Idle rinks stay visible with their IDLE marker so the layout does not jump around during the day.
- A "next up" strip at the bottom: the upcoming events across all rinks with their start times.
- Auto-refreshes on the same 30-second cycle as the public board while the event is live.
- Larger type and spacing than the phone board, sized for reading at a distance, and a max width tuned for a portrait screen.
- No following, no search, no score sheets, no bottom nav — this screen is display-only.
- A "Wall display" link next to each competition on the admin competitions page.

## Technical notes

- New route file `src/routes/_authenticated/admin.board.$slug.tsx` with `createFileRoute("/_authenticated/admin/board/$slug")`, so it inherits the existing admin gate used by the other `admin.*` routes.
- Data comes from the existing `getBoard` server function via `useQuery` with the same `refetchInterval` behaviour as `src/routes/board.$slug.tsx`. No new server functions, no schema changes.
- Rinks render with the existing `RinkPanel` component, mapped over `payload.rinks`, with `onOpenScore` omitted so cards are not tappable. Wrapped in a container that bumps base font size for the display.
- Next-up strip derives from `payload.schedule` (upcoming entries only), rendered with existing `Card`, `Eyebrow`, and `Tag` primitives — no new components.
- Loading and empty states reuse `Skeleton` and the same "no board here" copy.
- Route `head()` gets its own title/description and `robots: noindex`.
- Link added in `src/routes/_authenticated/admin.competitions.tsx` alongside the existing QR/copy-link actions.
