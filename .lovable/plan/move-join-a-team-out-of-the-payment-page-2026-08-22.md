# Move "join a team" out of the payment page

Today the invite-code box sits at the bottom of `/parent/team` — the page whose job is selling the Team plan. A parent who was invited by another parent has to scroll past pricing to accept. Move that entry point into settings, behind a single choice: do you have a code, or do you need to start a team?

## What changes for the parent

In Parent Settings, the plan area shows one row instead of the current "Upgrade to Team":

- **Join or start a team** — opens a bottom sheet with two options:
  - *I have an invite code* — reveals the code field and a Join button (same behavior as today: on success, toast, refresh, and land back in settings).
  - *Start a team* — routes to `/parent/team` to pick monthly/yearly and check out.

The pricing page keeps its plan cards and coach-visibility copy, but the "Or join a team" divider and code box are removed.

Parents already on a Team plan (payer or covered co-guardian) see no change.

## Technical notes

- New component `src/components/parent/join-team-sheet.tsx`, modeled on `ConnectGuardianSheet`: `Sheet` + `SheetTrigger`/`SheetContent`/`SheetHeader`, `useVisualViewport`, `Input`, `Button`, `toast`. Internal two-step state (`hub` → `code`) matching the hub → detail pattern used in the roster "Add athlete" drawer.
- Moves the existing `claimGuardianInvite` call (currently `JoinByCodeSection` in `src/routes/_authenticated/parent.team.tsx`) into that component unchanged — same `qc.invalidateQueries()` and navigation to `/parent/settings`.
- `src/routes/_authenticated/parent.team.tsx`: delete `JoinByCodeSection`, its divider block, and the now-unused `claimGuardianInvite` / `KeyRound` / `Input` / `useQueryClient` imports as applicable.
- `src/routes/_authenticated/parent.settings.tsx`: in `PlanSection`'s free branch, replace the single "Upgrade to Team" `SettingsButtonRow` with a row that opens the new sheet (`SettingsButtonRow` stays the visual; the sheet is controlled from it). The existing `TeamPeopleGroup` free-state row keeps pointing at `/parent/team`.
- No server-function, schema, or billing changes.
