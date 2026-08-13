# Simplify the parent → coach invite flow

Right now the Coaches section in parent settings stacks three separate blocks on top of each other: the connected-coach list, an "Add a coach" inline form that expands in place, and a large always-open "Invite your coach" card with share button and code. It reads as three competing things.

This applies the same hub pattern the coach roster now uses: one button, a bottom sheet, a short menu of the ways to connect, and one focused step at a time.

## What changes

**Coaches section (parent settings)**

```text
Coaches
┌───────────────────────────────┐
│ Alex Brinkley                 │
│   Jamie Gilmore — Figure Sk.  │
│ Sophia Brenner                │
│   Jamie Gilmore — Golf        │
└───────────────────────────────┘
  [ + Add a coach ]
```

That single button opens a bottom sheet:

```text
Add a coach
Two ways to connect.
┌──────────────────────────────────────┐
│ ↗  Invite your coach            >    │
│    Share a link or code              │
│──────────────────────────────────────│
│ #  Enter their code             >    │
│    They're already on Gradus         │
└──────────────────────────────────────┘
```

Tapping either row swaps the sheet to that step with a back arrow in the header — same motion and layout as the coach "Add athlete" drawer. "Invite your coach" shows the share button and code; "Enter their code" shows the code field, then the coach preview with athlete/sport pickers. Both close the sheet on success.

**Copy trims**
- Sheet intro for sharing shortens to one line ("When your coach signs up they'll be linked to your athletes, sports, goals, and lesson times automatically.") — the long paragraph doesn't fit a focused step.
- Empty state becomes "No coaches connected yet." with the same Add a coach button, instead of pointing at a card below.

**Left alone**
- The parent home page keeps the full expanded invite card — it's an onboarding surface, not a settings row.
- Adult-athlete settings gets the same hub treatment, with its own two-way copy, since it renders the same card.
- No changes to the linking logic, invite codes, or server functions.

## Technical notes

- `parent.settings.tsx`: replace the `AddCoachByCodeCard` + `InviteCoachCard` pair inside `SettingsGroup label="Coaches"` with a new `ConnectCoachSheet` component holding the trigger button, sheet, and `hub | share | code` step state.
- New `src/components/parent/connect-coach-sheet.tsx`, modeled on the `INVITE_STEPS` hub in `coach.roster.tsx`: `Sheet side="bottom"`, `paper-surface`, `useVisualViewport` for keyboard-aware `bottom` / `maxHeight`, `press` rows with `ChevronRight`, back arrow via `ChevronLeft`.
- `AddCoachByCodeCard` gains `hideChrome` / `onSuccess` props so it renders bare inside the sheet (no self-managed open state, no duplicate heading) while keeping its current lookup → preview → link flow intact.
- `InviteCoachCard` gains a `compact` prop that drops the outer card padding/shadow and heading, mirroring `InviteCard compact` on the coach side.
- `athlete.settings.tsx` uses the same sheet with `audience="adult-athlete"`; `parent.index.tsx` keeps calling `InviteCoachCard` unchanged.
