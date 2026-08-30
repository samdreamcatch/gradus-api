# Settings re-order

A consistent group order across coach, parent, and athlete settings, following the
convention consumer apps use: identity first, role-specific work in the middle,
money, then preferences, then support, then the destructive action alone at the bottom.

No new components, no logic changes — this only moves existing rows and groups and
relabels two group headers.

## The spine

```text
1. My profile        identity: name, email/username, guardian (athlete only)
2. Role-specific     Coaching / My athletes + Team / Coaches
3. Plan              billing only
4. Preferences       appearance
5. Account           Account & security row
6. Support           Install app, native app, Send feedback, Legal
7. (bottom)          Sign out, alone
```

## Per role

**Coach**
1. My profile — Name, Email
2. Coaching — Sports, Roster, Coach visibility, Connect people
3. Plan — PlanSection only
4. Preferences — Appearance
5. Account — Account & security
6. Support — Install app, Native app, Send feedback, then Legal
7. Sign out

**Parent**
1. My profile — Name, Email
2. My athletes, then Team people group
3. Plan — PlanSection only
4. Preferences — Appearance
5. Account — Account & security
6. Support — Install app, Native app, Send feedback, then Legal
7. Sign out

**Athlete**
1. My profile — Profile, Username/Email, Guardian
2. Coaches (when shown)
3. Preferences — Appearance
4. Account — Account & security
5. Support — Install app, Native app, Send feedback, then Legal
6. Sign out

Athlete has no Plan group today, so it stays absent; every other group lands in the
same position as the other two roles.

## What actually changes

- Sign out moves out of "My profile" to the very bottom of the page, on its own,
  below Legal — instead of sitting third from the top.
- Install app, Native app, and Send feedback move out of "My profile" into a new
  "Support" group next to Legal.
- Account & security moves out of the "Plan" group into its own "Account" group for
  coach and parent, matching how athlete already does it. "Plan" then means billing
  only.
- Preferences moves above Account for coach and parent, so all three roles share the
  same tail order.

## Technical notes

Files touched:
- `src/routes/_authenticated/coach.settings.tsx`
- `src/routes/_authenticated/parent.settings.tsx`
- `src/routes/_authenticated/athlete.settings.tsx`

The "Support" group is a plain `SettingsGroup label="Support"` wrapping a
`SettingsList` with the existing `InstallAppRow`, `NativeAppSection`, and
`FeedbackSettingsRow`, followed by the existing `<LegalSection />` unchanged.
Sign out stays the existing local `SignOutRow`, rendered in its own trailing
`SettingsList` after Legal.

No route, data, or server-function changes. Verify with Prettier, `bunx tsgo --noEmit`,
and a preview check of all three settings pages.
