# Shared practice log: parent + athlete, with clear attribution

## Where things stand today (verified)

- **Both can already log.** A parent logs a session from the parent plan page and an athlete logs from their own plan page; both write to the same `plan_sessions` rows. Parent-logged rows carry a parent id, athlete-logged rows do not.
- **Both can already see each other's logs at the data level.** Access rules let a parent read every session for their athlete (including athlete-logged ones), an athlete read every session on their own plans (including parent-logged ones), and the coach read everything on their plans.
- **What's missing is the experience.** Nothing in the app lists individual sessions. All three roles only see an aggregate mood bar ("Logged instances") plus, for the coach, an AI summary. There is no date, no duration, no note, and no indication of *who* logged a given practice. The athlete's plan page shows nothing at all about logged sessions.

So: A is already true in the database; B does not exist yet.

## What to build — using only existing components

No new components. Everything below is assembled from pieces already in the project.

### 1. A practice log list on the plan detail pages

Rendered with the existing settings primitives `SettingsGroup` + `SettingsList` + `SettingsRow` (`src/components/settings/primitives.tsx`) — the same list pattern already used across parent, athlete, and coach settings.

One `SettingsRow` per logged session:

```text
Tami logged for Addie                      Aug 18 · 32 min
Steady · "Better edges today, still rushing the entry."
```

- `label` = who logged it ("Tami logged for Addie" / "Addie logged this").
- `description` = mood label (from the existing `STATE_LABELS`) plus the note.
- `value` = date and duration.
- Section heading via the existing `Eyebrow` (`src/components/ui/eyebrow.tsx`), matching the "Logged instances" heading already on the coach plan page.
- Long lists collapse using the existing expandable row behavior in the same primitives file; no new expander.

### 2. Attribution alongside the existing mood bars

Directly under the existing `FlowStateBars` on the coach plan page, add one line of text (no new component): "12 sessions · 8 logged by Addie, 4 by Tami."

### 3. Same block on all three plan pages

- **Coach plan detail** — practice log added inside the existing "Logged instances" card.
- **Parent plan detail** — gains the existing `FlowStateBars` card plus the practice log.
- **Athlete plan detail** — gains the same card, so the athlete sees what a parent logged for them.

Identical markup in all three, so coach, parent, and athlete read the same thing.

### 4. Double-logging guard

When someone opens the log flow and the other party already logged on this plan within the past 2 hours, show a `toast` (existing sonner setup, already used by the session timer): "Tami already logged 32 min on this plan an hour ago." Informational only — it does not block.

## Technical notes

- New server function `listPlanSessions({ planId })` added to the existing `src/lib/plan-sessions.functions.ts`, auth-scoped exactly like the neighboring `getPlanSessions`, returning `{ id, loggedAt, durationSeconds, stateIndex, note, loggedByKind, loggedByFirstName }` per session. Parent name resolved from the row's parent profile; athlete name from the plan's athlete.
- Logger counts added to the existing `getPlanSessions` return value, so the attribution line needs no extra request.
- Rendering is done inline in the three existing route files using `SettingsGroup`/`SettingsList`/`SettingsRow`, `Eyebrow`, `FlowStateBars`, `STATE_LABELS`, and `toast`. No new files under `src/components`, no new design tokens.
- No schema change and no access-policy change: `plan_sessions` already records logger identity and already permits cross-visibility.
