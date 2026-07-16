## Scope back the "Not listed" flow

Right now, if a coach's club isn't listed, we push them into an outreach flow (share sheet / email / SMS / lead capture + admin "Club requests" tab). We'll defer all of that and let coaches fall back to Individual with one tap.

### UX changes

- In `OrgSearchCombobox`, keep the empty-state / footer link, but change the label from "My club isn't listed — message them about Gradus" to something like "My club isn't listed — continue as individual" (final copy TBD).
- Clicking that link no longer opens the outreach card. Instead it directly flips `path = "individual"`, clears any `orgId/orgName/orgCity/orgCode/orgVerified`, and the parent onboarding flow drops into the existing Individual card (with promo code + paywall).
- Same treatment for the "I don't have a code yet — message my club" secondary link on the code step: retitle to "I don't have a code — continue as individual" and route to the same fallback handler.
- Remove the `not_listed` sub-step and the `OrgNotListedCard` render from `CoachPathChoice`. `ClubStep` becomes `"search" | "code"`.

### Code that goes away (for now)

- `src/components/onboarding/org-not-listed-card.tsx` — delete.
- `handleNotListed` in `coach-path-choice.tsx` — replaced by `handleFallbackToIndividual`.
- `createOrganizationLead` server function in `src/lib/coach-org.functions.ts` — remove export + implementation.
- Admin **Club requests** tab in `src/routes/_authenticated/admin.organizations.tsx` — remove tab + its data hooks. The Organizations tab stays.

### Data model

- `organization_leads` table stays in the database (dropping it is destructive and we plan to bring the feature back). We just stop reading and writing to it. No migration.
- All other org-related schema (`organizations` search fields, `organization_id` / `is_org_template` on `moves`/`plans`/`resources`, `last_synced_content_version`) stays untouched — it's needed for the club content roadmap.

### Out of scope

- No changes to the Individual path, promo codes, Stripe wiring, or the Club search + code verification flow itself.
- No new design tokens or components.
- Bringing the outreach flow back later is a separate task; the DB table and design system pieces (`Sheet`, `Textarea`, share primitives) remain reusable when we do.

### Confirm before I build

1. On the club card, is "My club isn't listed — continue as individual" the right copy, or would you rather it read as a plain secondary button underneath the search? (I'll default to the inline link if you don't say otherwise.)
2. OK to fully remove the Admin "Club requests" tab now (vs. hiding it behind a feature flag)?