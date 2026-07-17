# Revoke admin + add David to dev switcher

## Done
Migration ran: removed `admin` role from `coach@test.dev` and `coach2@test.dev`, and removed both from `admin_allowlist` so the auto-grant trigger can't re-add them. Only `mariah@gradussports.com` and `alyson@gradussports.com` remain as admins.

## What went wrong
When you asked me to "elevate David Wallace to the dev panel," I read "dev panel" as `/admin` and granted the `admin` role to both David and Tami. What you actually meant was the DevTools account switcher (the floating panel that lets you sign in as different seeded accounts). Those are two different things and I should have asked.

## Remaining change
Add David Wallace to `src/components/dev/dev-accounts.ts` as a coach entry, right below Tami:

```ts
{
  email: "coach2@test.dev",
  label: "David Wallace",
  role: "coach",
  note: "Coach — shares Jamie & Dani with Tami",
  home: "/coach",
},
```

No DB changes, no role changes — just a one-file edit to the dev switcher list.
