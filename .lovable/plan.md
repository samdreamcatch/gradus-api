## /coach/roster — Athlete list

A new page where the coach sees every athlete on their roster as a card. Each card shows everything important at a glance — no clicking required. Tapping the card is wired up but the detail view comes later.

### Card contents (per athlete)

- **Name** — first + last, display serif (matches the editorial type used elsewhere)
- **Sport** — uppercase tracking-widest caption in accent ink (e.g. "GYMNASTICS")
- **Parent** — small muted line: "with Sarah Peterson"
- **Schedule** — compact day/time chips in a horizontal row, e.g. `Mon 4:00` `Wed 4:00` `Fri 5:30`, wrapping to a second line on small screens
  - Pulled from `athlete_lesson_slots` filtered to this coach + athlete
  - Sorted Mon → Sun
  - Times formatted from `start_minute` (e.g. 16:00 → "4:00 PM" trimmed to "4:00p" to keep chips small — final format TBD during build)
  - If an athlete has no scheduled slots, show a quiet "No schedule set" line instead of empty chips

### Page behavior

- **Order:** alphabetical by athlete first name, then last name
- **Empty state:** when the coach has zero rostered athletes, show an invite CTA pointing them to their Settings invite code (reuses existing `InviteCard` styling)
- **Tap target:** the whole card is a button. For now it shows a "Coming soon" toast (next iteration wires it to a detail screen)
- **Layout:** mobile-first, `max-w-3xl`, single column of cards with vertical spacing
- **Nav:** reuses `CoachBottomNav` — the existing "Roster" tab currently toasts "coming soon"; we'll wire it to `/coach/roster`

### Reuses

- `bg-card`, `rounded-2xl`, the shadow recipe already used on coach home
- `PageTitle` for the header ("Roster" with a hand-font subtitle)
- `pen-highlight` accent on the title word
- Tailwind tokens only — no new colors

### Technical section

**New files**
- `src/routes/_authenticated/coach.roster.tsx` — route component, query + render
- `src/lib/coach-roster.functions.ts` — `getCoachRoster` server function (uses `requireSupabaseAuth`)
- `src/components/coach/roster-card.tsx` — presentational card

**Server function `getCoachRoster`**
Returns an array of `{ athleteId, firstName, lastName, sport, parentFirstName, parentLastName, slots: [{ dayOfWeek, startMinute }] }`, sorted A–Z by athlete name. One round trip with joins:
1. From `coach_profiles` resolve current coach id via `userId`
2. Join `coach_athletes` → `athletes` → `parent_profiles` for name + parent
3. Join `coach_athlete_sports` for the sport label
4. Join `athlete_lesson_slots` (filtered by this coach) for the schedule rows

Because "athletes only ever have one sport per coach in this app" (your earlier answer), we render one sport per card. If the join returns multiple sport rows for safety, we'll pick the first deterministically.

**Routing/nav wiring**
- Add `to: "/coach/roster"` and `matchPrefix: "/coach/roster"` to the Roster item in `src/components/coach/bottom-nav.tsx` (replaces its toast).

**Query**
- TanStack Query with `queryOptions({ queryKey: ["coach", "roster"], queryFn: () => getCoachRoster() })`
- `loader: ({ context }) => context.queryClient.ensureQueryData(rosterQueryOptions)` and `useSuspenseQuery` in the component
- `errorComponent` + `notFoundComponent` per project conventions

**Out of scope (next iteration)**
- The card detail view when tapped
- Any inline actions on the card (Message / New plan)
- Multi-sport handling per athlete
