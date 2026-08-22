# Merge Team, coaches, and coach visibility into one section

In `/parent/settings`, the Coaches / Team / Coach visibility groups collapse into a single group. Its header reads **Team** for parents on an active Team plan, and stays **Coaches** for everyone else.

## Team plan active

One header: **Team**. One card per athlete containing everything about that athlete's people:

```text
TEAM
┌───────────────────────────────────────────┐
│ Ava Gillespie                             │
│                                           │
│ Guardians                                 │
│  Mariah G.  · Primary · You               │
│  Ben G.     · Guardian            [trash] │
│  ben@x.com  · Pending · ABC123    [trash] │
│                                           │
│ Coaches                                   │
│  Tami Taylor — Figure skating             │
│    Connected              [switch] Unlink │
│  David Wallace — Tennis                   │
│    Off                    [switch] Unlink │
└───────────────────────────────────────────┘
        [ Add a coach ]  [ Add a guardian ]
```

- Guardian rows keep today's behavior: remove co-guardian / revoke pending invite, visible only to the primary parent.
- Each coach row gets the visibility switch plus its status text ("Connected", "Waiting on coaches to accept", "Off", etc.) and the existing Unlink confirm.
- The switch is hidden when that athlete has fewer than two connected coaches — there is nothing to share with yet.
- Both action buttons sit side by side under the cards. "Add a guardian" only appears for the paying primary parent, as today.
- The standalone **Team** and **Coach visibility** groups are removed.

## No Team plan

- Header stays **Coaches**, with today's coach list and "Add a coach" button.
- One upsell row underneath links to `/parent/team`, covering both perks: add parents/guardians and let coaches see each other's plans.
- No guardian rows, no visibility switches.

## Technical notes

- `src/routes/_authenticated/parent.settings.tsx`: replace the three `SettingsGroup`s (`Coaches`, `Team`, `Coach visibility`) with one group whose label depends on `listTeamGuardians().planActive`. Rewrite `ConnectedCoachesList` into an athlete-keyed renderer that merges three sources by athlete id: `parent-settings` (coaches + sports + unlink), `team-guardians` (guardians + invites), `coach-visibility` (switch state + status).
- `TeamSection` and `CoachVisibilitySectionForSettings` are deleted; `CoachVisibilitySettings` in `src/components/parent/coach-visibility-toggles.tsx` is removed once nothing imports it. `CoachVisibilitySection` (the `/parent/team` page variant) stays untouched.
- Toggle logic reuses the existing `useCoachVisibility` hook with its optimistic update, so switches stay instant. Export the hook and `statusLabel` from the component file.
- No server function, schema, or RLS changes — presentation only.
