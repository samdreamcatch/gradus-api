# Family plan: add a second parent or guardian

Let a parent invite additional guardians to their athlete, with full parity access, behind the first paid parent feature.

## What the parent sees

- In `/parent/settings`, each athlete gains a **Guardians** group listing everyone with access (the primary parent first, then co-guardians, with pending invites marked "Invited").
- **Add a guardian** opens the same hub sheet pattern used for Add a coach: two options — **Send an email invite** (claim link) and **Share a code** (8-character code, native share sheet).
- If the household isn't on the Family plan, tapping Add a guardian opens a compact upgrade sheet: what it unlocks, price, and a Continue button into checkout. Nothing else in the parent app changes for free households.
- The primary parent can remove a co-guardian or revoke a pending invite at any time.
- Manage/cancel goes through the hosted billing portal, same as the coach settings plan row.

## What the co-guardian gets

Full parity with the primary parent once they join: the same athlete list, plans, practice log (their logs are attributed to them by name, using the attribution already built into the shared practice log), messages with coaches, resources, schedule, and goals. The one asymmetry: only the primary parent holds the subscription and can add or remove guardians.

## When payment lapses

Co-guardians go read-only — they can still see everything, but logging, messaging, and edits are blocked, with a banner on the parent home explaining that the family plan lapsed and naming the primary parent to nudge. The primary parent sees a banner prompting them to fix payment. Nothing is deleted; restoring payment restores write access immediately. The primary parent is never downgraded.

## Pricing

Flat Family plan, one subscription per household covering **up to 3 additional guardians**: **$15/month**, or **$162/year** (10% off). Both prices are created in Stripe during implementation with a digital tax code.

## Messaging

Yes — added guardians join the existing coach conversation for that athlete rather than getting a separate thread. Today a room's participant list is built from `athletes.parent_id`, so exactly one parent appears; the same widening that grants access replaces that single lookup with the full guardian list. Practically: one shared room per coach/athlete pair, every guardian sees the full history including messages sent before they joined, each message is labeled with the sender's name so the coach can tell the two parents apart, and unread badges are tracked per person. While a subscription is lapsed, a co-guardian can read the room but can't send.


## Technical notes

**Data model.** New table `public.athlete_guardians (id, athlete_id, parent_id, role 'primary'|'co', created_at)` plus `public.guardian_invites (id, athlete_id, invited_by_parent_id, email nullable, code, status, expires_at, claimed_by, claimed_at)`. `athletes.parent_id` stays as-is and continues to mean the primary/billing parent — no destructive migration. A backfill inserts one `role='primary'` row per existing athlete with a parent.

**Access.** Today parent access is decided in ~146 places by `athletes.parent_id = <my parent profile>` and by the SECURITY DEFINER helper `is_parent_of_athlete()`. Rather than rewrite each call site, widen the helper to also match `athlete_guardians`, and add a companion helper `public.parent_athlete_ids()` returning the caller's accessible athlete ids. Server functions that filter by `parent_id` switch to that id set; `assertOwnsAthlete` in `parent-settings.functions.ts` becomes an `assertCanAccessAthlete` that consults the same table. Existing RLS policies keep working unchanged because they route through the widened helper.

**Write gating.** A helper `public.parent_can_write(_athlete_id)` returns true for the primary parent always, and for a co-guardian only while the household subscription is active. It backs both the RLS `WITH CHECK` on parent-writable tables (`plan_sessions`, `messages`, goals, schedule) and the UI's read-only state, so the gate can't be bypassed client-side.

**Billing.** `parent_profiles` gains `stripe_customer_id`, `stripe_subscription_id`, `subscription_status`, `current_period_end`, `subscription_environment`, `family_plan_seats`, all writable only by service role (the same `protect_parent_profile_columns` trigger already in place is extended to cover them). New `src/lib/parent-checkout.functions.ts` mirrors `coach-checkout.functions.ts`: `startFamilyCheckout`, `createParentBillingPortalSession`, `verifyCheckoutSession`. The existing Stripe webhook route is extended to resolve parent subscriptions alongside coach ones and write `billing_events` the same way. New Stripe product with a digital tax code, checkout created with compliance handling enabled like the coach flow.

**Invites.** Reuses the guardian pattern already in the codebase: a `guardian-coinvite` branded email template registered in the admin copy schema, a claim route `/gp/$token` modeled on `/g/$token`, and code redemption through the existing `invite-resolve.functions.ts` resolver so an invited guardian who signs up fresh lands in the right place. Seat count is enforced server-side at invite creation and again at claim time.

**Messaging.** `listMyRoomIds` and `loadParticipants` in `src/lib/messages.server.ts` currently resolve the parent side of a room via `athletes.parent_id`; both switch to the guardian id set so co-guardians list the room and appear as participants. `is_room_participant()` is widened the same way so RLS on `messages` and `message_reads` follows. Send is gated by `parent_can_write`.

## Build order

1. Migration: tables, backfill, widened helpers, write-gate helper, RLS, grants.
2. Server-side access refactor (`parent_athlete_ids`, `assertCanAccessAthlete`) with no user-visible change.
3. Billing: parent Stripe fields, checkout/portal functions, webhook handling.
4. Parent settings UI: Guardians group, add-guardian hub sheet, upgrade sheet.
5. Invite email + claim route + code redemption.
6. Read-only lapse state, banners, admin surfacing.
