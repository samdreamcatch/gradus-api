# Account & security as its own settings page

Today every settings page (coach, parent, athlete) shows Reset password, Send magic link, Change email and Delete account as four rows in an "Account & Security" card. These move one level deeper.

## What changes

- The settings page gets a single row — **Account & security** — with a short description ("Password, email, and deleting your account") and a chevron, styled exactly like the existing Manage billing row.
- It sits inside the **Plan** group, directly under the billing rows. For roles or users with no billing row (athletes, parents without a Team plan), the group still renders and the Account & security row appears on its own.
- Tapping it navigates to a real sub-page with back navigation, one per role:
  - `/coach/settings/account`
  - `/parent/settings/account`
  - `/athlete/settings/account`
- The sub-page shows the same four actions, with the same sheets and dialogs as today: Reset password, Send magic link, Change email, Delete account (destructive tone, phrase confirmation, minor choices).
- **Sign out stays at the bottom of the main settings page** — unchanged.

## Technical details

- New shared component `src/components/settings/account-security-row.tsx`: one `SettingsGroup` + `SettingsList` + link row taking a `to` prop, matching the Manage billing row's markup and using existing primitives.
- Refactor `src/components/settings/account-security-section.tsx`: keep the four action rows plus the `ChangeEmailSheet` and `DeleteAccountDialog` exactly as-is, but drop the outer `SettingsGroup` wrapper into a prop or a separate export so the sub-page renders the list without a duplicated heading.
- Three new route files under `src/routes/_authenticated/` (`coach.settings.account.tsx`, `parent.settings.account.tsx`, `athlete.settings.account.tsx`), each `createFileRoute("/_authenticated/<role>/settings/account")`, rendering the app shell/back header the way other settings sub-pages do, plus its own `head()` title/description.
- In each settings route, replace `<AccountSecuritySection />` with the new row placed inside the Plan group; where a role has no Plan group today (athlete), add one with the same label used elsewhere.
- Verify with typecheck, lint, and a preview pass on all three roles.
