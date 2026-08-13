# Email copy in the admin sidebar

## What I verified

The feature is already in the code, confirmed by reading the files:

- `src/components/admin/admin-sidebar.tsx` has a **Support** group containing `Email copy` → `/admin/emails`.
- `src/routes/_authenticated/admin.emails.index.tsx` renders the template list (Auth / App / Internal groups).
- `src/routes/_authenticated/admin.emails.$name.tsx` renders the per-template editor.
- Both routes are registered in the generated route tree.

So nothing is missing from the build. The two realistic reasons you don't see it:

1. You're on the **published site** — these changes only exist in preview until you publish.
2. You're on a **narrow/mobile viewport** (your current preview is 393px wide), where the admin sidebar is collapsed off-canvas behind the menu trigger in the admin header.

## Proposed change

Make the entry reachable without hunting for it:

- Add an **Email copy** card/link to the admin overview page (`/admin/reporting` or the admin index), alongside the other Support destinations, so it's visible even when the sidebar is collapsed.
- Keep the sidebar entry unchanged.

If instead the sidebar is expanded on desktop preview and Support still shows no Email copy row, that's a real render bug and the first step becomes inspecting the live sidebar DOM before changing anything.

## Quickest check on your side

Open `/admin/emails` directly. If the template list loads, the route is fine and only discoverability needs fixing.
