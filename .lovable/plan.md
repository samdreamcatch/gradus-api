## Goal

Replace the "Enter club code" inline input on `/coach/paywall` with the same search-first flow we already use in Settings' "Join a club" sheet — so a new coach types their club's name, picks it from search results, then enters the invite code. If the club isn't found, we silently capture what they typed as a bizdev lead.

## Changes

### 1. `src/routes/_authenticated/coach.paywall.tsx` — swap the club section

Keep the outer bordered card (icon + "Joining through a club?" + description) exactly as-is. Replace the collapsed `Enter club code →` button and the inline `Input` + Cancel/Join buttons with the same body used inside `JoinClubSheet`:

- `OrgSearchCombobox` (from `src/components/onboarding/org-search-combobox.tsx`) with `onNotListed` wired to `recordSilentClubLead({ source: "not_listed", typedQuery })` — identical to the sheet's `handleNotListed`. Toast + collapse back on success.
- Once an org is picked: show the accent `Chip` with the org name and a "Change" button, then `OrgCodeField` for the invite code.
- Join button uses `claimOrganizationInviteCode` (the paywall's existing server fn), not `joinOrganization` — the paywall runs pre-entitlement, so there is no active Stripe subscription to cancel and the cancellation-note branch does not apply.
- On success: reuse the paywall's current post-claim flow (invalidate `coachProfileQueryOptions`; the existing entitlement `useEffect` handles the redirect to `/coach/onboarding`).

Because this replaces the collapsed/expanded inline UI, drop the `clubOpen` state and any now-unused imports (`Input`, the inline Cancel button branch). Keep the "individual plans grey out when a club is picked" behavior — trigger it off the org-selected state instead of `clubInput`.

### 2. `src/components/onboarding/org-search-combobox.tsx` — reuse as-is

No changes. It already renders a search input, shows matches from `searchOrganizations`, and exposes `onNotListed(typedQuery)` when the coach clicks the "Not listed? Tell us" affordance — which is exactly the bizdev capture path.

### 3. Bizdev lead capture — already wired

`recordSilentClubLead` in `src/lib/coach-org.functions.ts` writes to `organization_leads` with `source: "not_listed"` and the raw typed query. No new server function or migration needed.

## Out of scope

- No changes to `JoinClubSheet` itself — the Settings path stays exactly as it is.
- No changes to `joinOrganization` / `claimOrganizationInviteCode` semantics.
- No pricing, plan tier, or founding-coach path changes.
- No changes to the "greyed out individual plans when a club is chosen" visual — just wire it to the new org-selected state.

## Testing

1. Sign in as a fresh coach → land on `/coach/paywall`.
2. In the club card, type a partial club name → results appear from `searchOrganizations`.
3. Pick the club → chip appears, code field renders, individual plan cards grey out.
4. Enter a valid invite code → Join succeeds → redirected into onboarding.
5. Type a name that doesn't match → "Not listed" affordance → click it → toast confirms, `organization_leads` row inserted with the typed query, card collapses back.
