## Goal

1. Add the Share to Socials button on athlete and parent plan detail pages. The link resolves to the same public `/p/{token}` view coaches produce — identical title, notes, moves, coach name.
2. Change the share caption from `"{title} — a workout I put together on Gradus."` to `"{title} — My workout on Gradus"`.

## Server

Relax `getOrCreateShareToken` in `src/lib/plan-share.functions.ts` to authorize any of:
- the plan's owning coach (current), OR
- the assigned athlete (`athletes.user_id = auth.uid()`), OR
- that athlete's parent (`parent_profiles.user_id = auth.uid()` via `athletes.parent_id`).

Behavior unchanged: returns existing `share_token` if set, else generates one and stamps `shared_at`. The token write uses `supabaseAdmin` (loaded inside the handler) after the in-handler authorization check passes, so we don't have to widen RLS on `plans` for non-coaches.

No SQL migration. `get_shared_plan` and `plans.share_token` already exist and are anon-readable by token.

## Client

- `src/components/plans/share-to-socials-button.tsx` — change caption to `` `${planTitle} — My workout on Gradus` ``. Component otherwise unchanged.
- `src/routes/_authenticated/athlete.plans.$planId.tsx` — render `<ShareToSocialsButton planId={plan.id} planTitle={plan.title} />` in the top header row (right side of the Back row).
- `src/routes/_authenticated/parent.plans.$planId.tsx` — same placement and props.

Coach page is already wired and unchanged. The public `/p/{token}` view is unchanged — shared payload is byte-for-byte identical regardless of who shares.

## Files touched

- `src/lib/plan-share.functions.ts`
- `src/components/plans/share-to-socials-button.tsx`
- `src/routes/_authenticated/athlete.plans.$planId.tsx`
- `src/routes/_authenticated/parent.plans.$planId.tsx`
