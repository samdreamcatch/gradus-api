## Technical details

**Board entry points**
- `src/routes/board.$slug.tsx` and `src/routes/board.index.tsx`: header gets an auth
  affordance driven by the existing `useAuthReady` hook. Signed out → `Chip`/`Button`
  opening a `Sheet` with a sign-in link (`/login` with `redirect` set to the current
  board path) and three signup links reusing the role targets from `src/routes/index.tsx`
  (`/signup/parent`, `/signup/coach`, `/signup/athlete`).
- Following tab: swap the text link for a `Card` CTA; anonymous manual follow untouched.
- No new components: `Card`, `Chip`, `Button`, `Sheet`, `Eyebrow`, `Tag` only.

**Follow registry (device)**
- New tiny store `src/lib/board-follow-store.ts` that reads the existing keys
  (`gradus.boardHistory`, `gradus.boardFollow.<slug>`, `gradus.boardFollowExtra.<slug>`)
  and exposes the followed names per slug plus a dismiss flag
  (`gradus.boardBannerDismissed.<slug>`). `board.$slug.tsx` keeps writing the same keys,
  so no storage migration.

**Banner**
- New `src/components/board/following-banner.tsx`, rendered in
  `src/routes/_authenticated.tsx` next to `<ActiveSessionBar />`, hidden on
  `/board/*` routes and when there is no live match.
- Data: `useQuery` on the most recent followed slug calling the existing `getBoard`
  server fn with `refetchInterval: 30_000` and `refetchIntervalInBackground: false`;
  matches computed with the existing `findMySkaters` from
  `src/components/board/my-skaters.tsx`, combined with `getMySkaterNames` (connected
  athletes) as the board page already does.
- Priority for the single displayed line: on-ice → up-next → just scored → nothing
  (banner hides). `aria-live="polite"` so screen readers hear changes.
- Styling mirrors `ActiveSessionBar`: sticky pill, semantic tokens, `press` utility.

No database or server changes; `getBoard` is already public and cached.
