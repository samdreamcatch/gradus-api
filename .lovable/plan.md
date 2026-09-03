# Group the two "Edit" actions in the expanded lesson card

## Problem

In the expanded lesson card on the coach schedule, three pill buttons sit in one wrapping row: **View athlete**, **Edit recurring**, **Just this date**. At mobile width the row wraps so that "Edit recurring" and "Just this date" end up diagonal from each other, hiding the fact that they are two variants of the same "edit" action.

## Change

Split the action area into two clearly separated groups inside the expanded card:

```text
[ View athlete ]                     <- primary navigation action

EDIT LESSON                          <- small uppercase label (Eyebrow style)
[ Edit recurring ] [ Just this date ]  <- the two edit modifiers, side by side
```

- Row 1: "View athlete" alone.
- Row 2: a small uppercase label reading "Edit lesson", then the two edit buttons in a single grid of two equal columns (`grid-cols-2`) so they always sit side by side at any width and never wrap diagonally.
- Both edit buttons keep their current ghost/pill styling and existing handlers; the pencil icon stays on "Edit recurring". Labels shorten to "Recurring" and "This date" so both fit on one line on narrow screens under the shared "Edit lesson" label.
- A thin divider separates the two groups.

No behavior, data, or handler changes — presentation only.

## Technical detail

Single file: `src/components/coach/week-schedule-view.tsx`, the expanded block around lines 458-499. Uses existing `Button`, `Eyebrow`, and design-system tokens; no new components.
