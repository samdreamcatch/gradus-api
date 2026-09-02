## Technical notes

All changes are in existing files; no schema, server function, or route work.

**1. `src/components/board/following-banner.tsx` — widen the render gate**

Today the component returns `null` unless `data.isLiveWindow && top` (a matched
skater with a status line). Replace that with a three-tier message:

- `line(top)` when a followed skater is on-ice / up-next / scored (unchanged).
- otherwise `"<competition name> · live"` when `data.isLiveWindow`.
- otherwise `"Back to the Live Board"`.

Render whenever the banner has a slug, is not dismissed, is not already on
`/board/*`, and either a board visit is remembered for this session or the
competition is in its live window. The accent treatment (pulsing dot, accent
border/tint) stays for tier 1; tiers 2 and 3 use the quiet `bg-card` /
`border-divider` variant so the banner never shouts when there is no news.

The competition name comes from `readBoardHistory()[0].name`, already stored.

**2. `src/lib/board-follow-store.ts` — session flag for "came from a board"**

`readBoardReturn()` already holds the board path in `sessionStorage`. Keep that
value alive after sign-in instead of deleting it, and use its presence as the
"this session started at a board" signal the banner reads.

**3. `src/routes/_authenticated.tsx` — stop clearing on arrival**

Remove the `clearBoardReturn()` effect. The value is session-scoped, so it
disappears when the tab closes; clearing it on arrival is what removes the
return path at the exact moment it's wanted. Dismissing the banner still writes
the per-competition dismiss flag, which suppresses it for that competition.

**4. `src/components/board/board-return-link.tsx` — unchanged**

The auth-screen link keeps working off the same stored path.
