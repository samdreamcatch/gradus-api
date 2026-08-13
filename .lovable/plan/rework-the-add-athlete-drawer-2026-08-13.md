# Rework the "Add athlete" drawer

Today the drawer stacks all three ways to connect with an athlete on top of each other, separated by hairlines: a share-invite block, a code entry form, and a full manual add form. It reads as one long, unstructured page.

## New structure: hub → detail

The drawer opens on a **hub**: three equal-weight rows, each with an icon, a title, and a one-line description. No path is pre-selected or marked recommended.

```text
Add an athlete
Three ways to connect.
┌──────────────────────────────────────────┐
│ [share]  Share my invite              ›  │
│          Send parents or adult athletes  │
│          a link or code                  │
├──────────────────────────────────────────┤
│ [key]    Enter their code             ›  │
│          They already gave you an        │
│          8-character code                │
├──────────────────────────────────────────┤
│ [user+]  Add an athlete myself        ›  │
│          No code needed — we'll email    │
│          their parent a link             │
└──────────────────────────────────────────┘
```

Tapping a row swaps the drawer body to that one step, with the header replaced by a back arrow + the step's title. Only one task is on screen at a time, so the manual-add form no longer forces the other two paths off-screen.

Closing the drawer resets it back to the hub. Completing a step (code accepted, athlete added) closes the drawer as it does today.

## What stays the same

- No new component files. The rows are plain buttons composed from existing primitives inside the roster route; the three step bodies keep using the existing `InviteCard`, `EnterInviteCodeCard`, and `AddYouthAthleteCard`.
- All server calls, validation, roster-limit handling, toasts, and success behavior are untouched.
- Roster-full state still disables the trigger button as it does now.

## Copy cleanups inside the steps

Each step currently repeats its own heading/description, which duplicates the hub row text. Inside detail view:

- Share step: keep the share button + code chip, drop the redundant intro line.
- Enter-code step: drop the "Got a code from a parent…" line (now the hub row description); keep the field and button.
- Add-yourself step: drop the "Add an athlete yourself" heading block; keep the fields, helper text, and submit button.

## Technical notes

- `src/routes/_authenticated/coach.roster.tsx`: add local state `step: "hub" | "share" | "code" | "manual"` next to the existing `inviteOpen` state; reset to `"hub"` on open change. Render hub rows or the selected step inside the existing `SheetContent`; `SheetTitle`/`SheetDescription` become step-aware for accessibility.
- `src/components/coach/enter-invite-code-card.tsx` and `src/components/coach/add-youth-athlete-card.tsx`: add an optional prop to suppress the internal heading/description so the drawer owns the titles; existing call sites elsewhere (settings, onboarding) keep their current appearance.
- Back arrow uses the existing lucide icon set already imported in the route; press feedback uses the project's `press` utility, no hover states.
