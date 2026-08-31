# Report a resource as inappropriate (parent & athlete)

Parents and athletes can flag any resource in their library as inappropriate, using the same report sheet and admin queue already built for messages and people.

## What the user sees

- In the resource detail sheet (opened from the parent or athlete resource library), a low-key "Report this resource" text action at the bottom, next to the existing controls.
- Tapping it opens the existing Report sheet with the same reason list (harassment, inappropriate/sexual content, spam/scam, minor safety, something else) and optional note.
- Because a resource is not a person, the "Also block this person" checkbox is hidden in this mode. If the resource has an identifiable coach owner, the sheet says who shared it; for Gradus/organization resources it simply says the resource is being reported.
- Same confirmation toast and 24-hour review language. Reporter stays anonymous to the coach.
- Admin: reports land in the existing Trust & safety → Reports queue at `/admin/reports`, showing the resource title/kind and a link/label instead of a message body. Minor-safety reports keep their urgent sorting. Same alert email.

## Technical notes

1. **Migration** on `public.user_reports`:
   - add `resource_id uuid null references public.resources(id) on delete set null`
   - make `reported_user_id` nullable (org/Gradus resources have no owning coach)
   - add a check that at least one of `reported_user_id` or `resource_id` is present
   - no new table, so grants/RLS stay as-is; existing insert policy already scopes to `reporter_user_id = auth.uid()`.
2. **`src/lib/safety.functions.ts`** — `submitReport` accepts an optional `resourceId`, allows a null `targetUserId` when a `resourceId` is given, verifies the reporter can actually see that resource (reuse the existing parent/athlete resource visibility check), and forces `alsoBlock` off for resource reports. Admin list query selects `resource_id` and joins resource title/kind for display.
3. **`src/lib/safety.server.ts`** — admin alert email body gains a resource line when `resource_id` is set.
4. **`src/components/safety/report-sheet.tsx`** — optional `resourceId` / `resourceTitle` props; when present, hide the block checkbox and swap the description copy. No new component.
5. **`src/components/resources/shared.tsx`** — add the report action inside `ResourceSheet`, gated by an optional `canReport` prop so the coach-side and org-admin views are unaffected; parent and athlete resource routes pass it.
6. **`/admin/reports`** — render the resource context column alongside the existing message context.

Constraints kept: no resource rows are deleted or hidden by a report, no changes to resource RLS, no new UI primitives. Verify with Prettier, `bunx tsgo --noEmit`, `bun run lint`, and a preview pass through parent and athlete resource libraries plus the admin queue.
