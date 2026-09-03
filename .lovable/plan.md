# Competition results: stacked folders instead of stacked cards

Today every linked competition renders a full card with its header, every event row, and a full-width "Generate draft plan" button. With four or five competitions a season that block dominates the athlete card.

## The idea

Turn each competition into a **closed folder tab** — one compact row — and let the coach open one at a time. Closed rows still carry the season-at-a-glance information (event count, best placement), so nothing is lost by keeping them shut.

```text
Competition results                              [ Link results ]

Fall Classic · Oct 12                2 events · best 2nd     v
Gradus Demo Invitational · Aug 31    2 events · best 2nd     ^
   Jamie Gilmore · Detroit SC                        Unlink
   Intermediate Ladies                              54.18
   Short Program · A Rink                          place 4
   Intermediate Ladies                             136.58
   Free Skate · A Rink                             place 2
   [ Generate draft plan ]
Spring Open · May 3                  1 event · best 1st      v
```

## Behavior

- Most recent competition opens by default; the rest stay closed. Opening one closes the others, so the section never grows past a single expanded folder.
- Closed row shows: competition name, dates, and a summary of event count plus best placement.
- Open row shows what the card shows today: skater name/club, Unlink, the tappable event rows (which still open the score sheet), and Generate draft plan.
- After five competitions the list shows the five most recent with a "Show all" text button, so a multi-season athlete never renders an unbounded stack.
- Empty and loading states are unchanged.

## Components used

No new components and no hand-rolled controls:

- `Accordion` / `AccordionItem` / `AccordionTrigger` / `AccordionContent` (`src/components/ui/accordion.tsx`, `type="single" collapsible`) for the folder stack
- `Tag` for the closed-row summary chip
- `Button` for Link results, Unlink, Generate draft plan, and Show all
- `Eyebrow` for the section heading, `ScoreSheet` for protocol detail — both unchanged

## Technical notes

- Change is confined to `src/components/coach/competition-results-section.tsx`. Queries, mutations, navigation to the drafted plan, and the linking sheet are untouched.
- The trigger's default `hover:underline` is overridden with the design system's `press-soft`, matching the no-hover interaction doctrine; item borders use `border-divider` and the stack sits on `bg-card` with `divide-y` so the rows read as layered folder tabs rather than separate cards.
- `Unlink` becomes a small `Button variant="ghost" size="sm"` inside the open panel instead of a bare styled `button`.
- Sorting uses the order already returned by `getAthleteCompetitionResults`; if that is not newest-first, the component sorts by the link's date field before rendering.
