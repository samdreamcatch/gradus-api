# Family plan page — match the paywall's visual identity

Restyle `/parent/family` so it reads as the parent-side sibling of `/coach/paywall`: same centered hero, same plan-card language, same accent-pill treatment — no new components or tokens.

## What changes visually

Today the page is a settings-style stack (`SettingsGroup` / `SettingsRow` lists). It becomes a paywall-shaped page:

1. **Hero** — centered accent circle icon (`Users`), `font-display text-h2` headline ("Add a parent or guardian"), one-line subhead. Same spacing as the paywall hero.
2. **Current-plan banner** — when the Family plan is active, the accent-tinted rounded pill the paywall uses ("Current plan: Family — monthly").
3. **Billing interval toggle** — the same segmented Monthly / Yearly control the paywall uses for tier pricing, instead of two separate buttons.
4. **Plan cards** — two bordered `rounded-2xl … shadow-card` cards:
   - **Single parent** (free / current when not subscribed) — what you get today, "Current plan" state.
   - **Family** — RECOMMENDED pill, big `$15` / `$162` price with the "billed monthly" / "save 10%" caption driven by the toggle, a `Check`-bulleted feature grid (full access for co-guardians, shared plans and goals, shared coach messaging, unlimited guardians per athlete), and a full-width CTA.
5. **"Or" divider** — the paywall's hairline + uppercase label, above the invite-code section.
6. **Invite-code section** — the paywall's bordered `bg-elevated` block with a leading icon, label, description, code input, and Join button (mirrors the club-code block).
7. **Guardians section** — kept, but restyled as bordered cards per athlete rather than settings disclosures: athlete name header, guardian rows with role pill, pending-invite rows with mono code, and the invite input row. Locked state shows the same accent-tinted "part of the Family plan" note with an upgrade CTA.
8. **Checkout / return states** — already match the paywall; keep as-is, plus add the paywall's spinner "Loading your plan…" pending state and a "Finishing up…" state on checkout return.

Behavior, server functions, and Stripe flow stay exactly as they are. Bottom nav and page container stay so navigation is unaffected.

## Technical notes

- Single file edited: `src/routes/_authenticated/parent.family.tsx`.
- Reuse `Button`, `Input`, `cn`, `PaymentTestModeBanner`, and existing tokens (`bg-accent/15`, `text-accent-ink`, `border-divider`, `bg-card`, `bg-elevated`, `shadow-card`, `font-display`). No new files, no new CSS, no new dependencies.
- Drop the `SettingsGroup` / `SettingsList` / `SettingsRow` / `SettingsButtonRow` / `SettingsDisclosure` imports from this route only; other settings pages are untouched.
- Interval state is local (`useState<"month" | "year">`), mapping to the existing `family_monthly` / `family_yearly` price IDs.
- Keep `press` / `press-soft` interaction utilities per the project's no-hover rule.
