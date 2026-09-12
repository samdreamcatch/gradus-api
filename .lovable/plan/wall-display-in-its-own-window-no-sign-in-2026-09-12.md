# Wall display in its own window, no sign-in

Clicking "Wall display" opens a standalone board page in a new window with nothing around it — no admin sidebar, no admin header, no way to click into the rest of the admin panel. It stays up indefinitely and never asks you to sign in again.

## What changes

- The wall display moves to its own unlisted address: `/board/<event>/wall`. It is outside the signed-in area, so the session never expires out from under it.
- The page shows only the two tabs you want: **Live** (every rink stacked vertically, one under the other) and **Schedule**. The Following tab is dropped, since it needs a signed-in account.
- Everything else looks and behaves exactly like the current board: header with competition name, LIVE/FINISHED status, last-updated time, tappable skaters opening score sheets, event results, and the 30-second live refresh.
- The page is marked "do not index" so it will not turn up in search — it is shareable only by link.
- On the admin competitions page, the "Wall display" button points at the new address and opens a clean new window (no toolbar chrome), rather than a tab inside the admin panel.
- The old admin-nested wall page is removed so there is only one wall display.

## Technical notes

- New route file `src/routes/board.$slug.wall.tsx` with `createFileRoute("/board/$slug/wall")`. Contents are lifted from `src/routes/_authenticated/admin.board.$slug.tsx`, minus: the `getMySkaterNames` call, the `supabase.auth` session check, `MySkaters`/`FollowSearch`, the follow/unfollow localStorage state, and the "mine" tab. Tab list becomes Live + Schedule with Live as the default.
- Data comes from the existing public `getBoard` server function via `useQuery` with the same `refetchInterval` on `isLiveWindow`. No new server functions, no schema changes, no auth-touching code — nothing on the page can 401.
- Live tab maps `payload.rinks` to `RinkPanel` in a single vertical column (existing wall layout), with `onOpenScore` wired to `ScoreSheet` as today. Schedule tab reuses `ScheduleBoard` and `EventResults`.
- `head()` keeps a wall-specific title/description plus `robots: noindex`.
- Delete `src/routes/_authenticated/admin.board.$slug.tsx`; update the link in `src/routes/_authenticated/admin.competitions.tsx` to a plain anchor to `/board/<slug>/wall` opened via `window.open(url, "gradus-wall", "noopener,noreferrer,popup=yes,width=1080,height=1920")`, keeping the existing outline Button styling.
