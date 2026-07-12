## Problem

The Coaching section has three near-identical rows, all using the paper-plane icon and all about invite codes:

1. Invite parents of youth athletes — share your code
2. Invite adult athletes — share your code
3. Enter a parent or athlete's code — redeem someone else's code

They read as repetitive noise and it's hard to tell them apart at a glance.

## Proposal

Replace the three rows with **one** disclosure row in the Coaching section:

- **Label:** Connections
- **Description:** Share your code or enter someone else's
- **Icon:** Link/QR-style icon (swap the plane for something distinct from generic "send")

When expanded, the panel shows two clearly-separated sub-sections stacked vertically — no functionality removed, just grouped:

```text
┌─ Connections ─────────────────────────────┐
│                                           │
│  SHARE YOUR CODE                          │
│  [ Youth athletes' parents | Adult (18+) ]│  ← segmented toggle
│  <InviteCard compact audience={selected}> │
│                                           │
│  ─────────────────────────────────────    │
│                                           │
│  HAVE A CODE?                             │
│  <EnterInviteCodeCard />                  │
│                                           │
└───────────────────────────────────────────┘
```

The segmented toggle at the top swaps `<InviteCard>`'s `audience` prop between `youth-parents` (default) and `adult-athletes`. Same underlying component, same codes, same flows — just no longer duplicated as two separate settings rows.

## Result

Coaching section goes from 5 rows → 3 rows:

- Sports & levels
- Roster & schedule
- Connections

All three original capabilities remain reachable in one predictable place.

## Technical notes

- File: `src/routes/_authenticated/coach.settings.tsx`
- Delete `InviteDisclosure`, `InviteAdultAthletesDisclosure`, `EnterCodeDisclosure`
- Add a single `ConnectionsDisclosure` component with local `useState` for the audience toggle (segmented control styled like the existing Appearance Light/Dark/Auto trio for visual consistency)
- Update the Coaching section's render list to reference the new component
- No changes to `InviteCard` or `EnterInviteCodeCard` internals
