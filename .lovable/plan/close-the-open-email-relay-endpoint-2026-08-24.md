# Close the open email relay endpoint

## What's actually exposed

The finding is **not** about the admin panel. Two separate things send email:

- **Admin panel ("send a test", manual sends)** — goes through `sendEmailManually`, which requires a signed-in user **and** verifies the admin role before sending. This path is fine.
- **`/lovable/email/transactional/send`** — a scaffolded HTTP endpoint that ships with the app. It checks only that the request carries *any* valid signed-in user's token. No app screen calls it; nothing in the codebase references it. But it is live on the public site, so any signed-in parent, athlete, or coach could POST to it directly with a recipient address, a template name, and their own names/links, and the app would send that email from the verified Gradus sending domain.

So: the abusable surface is the raw endpoint, not any UI. Every real in-app email (guardian invites, team invites, club invites, welcome/activation, coach visibility, billing notices) is enqueued by server-side code that already knows who the sender is — none of them go through this route.

## Fix

Since no app code uses the endpoint, the safest and simplest fix is to remove it rather than try to add per-template ownership checks to a generic relay.

1. Delete `src/routes/lovable/email/transactional/send.ts`.
2. Confirm nothing references it (searched: only its own file declares the route) and that the transactional **preview** route, the auth email webhook, the queue processor, and the suppression route are untouched — those are separate and still needed.
3. Keep every existing send path as-is: they run server-side with `supabaseAdmin` after the caller's identity and permissions are established.
4. Mark the finding fixed and record in security memory that generic "send any template to any address" relays are not to be reintroduced; new email types get a purpose-built server function that authorizes the caller against the referenced athlete/org/team.

If you would rather keep the endpoint for future tooling, the alternative is to gate it behind the same admin-role check the admin panel uses, plus an allowlist on any URL fields. Removal is cleaner because nothing depends on it today.

## Technical notes

- The admin manual-send path (`src/lib/email-manual-send.functions.ts`) calls `assertAdmin` via the `has_role` RPC before enqueueing — unaffected.
- Queue processing (`/lovable/email/queue/process`) is gated by a server-only secret and stays as-is.
- No database, DNS, or sender-domain changes involved.
