## What's actually happening

The `/p/$token` route works — I confirmed the token `5g3h321n3725652i222c6d40` exists in the database and `get_shared_plan` is set up for anon access. The 404 you're seeing is because **gradus.training is still serving a build from before this feature shipped**. The live site literally has no `/p/$token` route yet. Confirmed by fetching the URL — it returns the site's generic 404, not our custom "Plan not found" page.

The fix is a **Publish**. After that, the same link will open the public plan view on gradus.training, signed in or not.

## Second ask: viewable to anyone, with a clear sign-in / sign-up CTA

The public route already renders the plan for signed-out visitors — no auth wall. The only gap is the CTA. Today it shows a single button: "Sign in to save" for anon, "Coaches only" (disabled) for signed-in non-coaches, "Save to my library" for coaches.

I'll adjust the anon state so visitors see both options clearly:

- **Anon viewers**: two buttons in the bottom bar — **Sign up** (primary, routes to `/signup.coach` since only coaches can save, with the token preserved as a `redirect` param) and **Sign in** (secondary, routes to `/login?redirect=/p/{token}`). Copy above them: "Coaches can save this to their library."
- **Signed in, not a coach**: keep the disabled "Coaches only" state, unchanged.
- **Signed-in coach**: unchanged — "Save to my library".

Also, `/p/$token` already renders the plan itself for everyone — no changes to the plan view, just the bottom CTA bar.

## Files touched

- `src/routes/p.$token.tsx` — replace single-button CTA with two-button anon state; keep the coach and non-coach states as-is.

Nothing else changes. No schema changes, no server-fn changes.

## After merge

Hit **Publish** so gradus.training picks up the new route. The shared link will then open the plan for anyone.
