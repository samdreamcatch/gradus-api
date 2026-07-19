## Goal

In the admin panel, replace Stripe environment labels ("test", "sandbox", "live") with **"development env"** and **"production env"** wherever we're showing the user which Stripe environment they're in. Leave unrelated uses of the words alone (test-user flag, "live" meaning "applied to active subscription", route search params).

## Scope of change (labels only, no logic)

All edits are copy-only in `src/routes/_authenticated/admin.promo-codes.tsx`. Internal identifiers (`"sandbox"`, `"live"`, column names `stripe_promo_id_sandbox` / `_live`) stay as-is — only visible strings change.

### admin.promo-codes.tsx

- Header banner (line ~244): "…created in Stripe once for **development env** (preview) and once for **production env** (published site)…"
- Environment badge / `envLabel` (line ~185): show "Development env" / "Production env" / "Not configured".
- Sync status pills (lines ~597–605):
  - "Ready in development & production env"
  - "Ready in development env only"
  - "Ready in production env only"
- `otherEnvLabel` and button copy (lines ~590, ~610–618): "Re-sync in development env" / "Create in production env", plus the "Still needs …: open this page on the … site" hint.
- Detail sheet field labels (lines ~773, ~781): "Development env Stripe" / "Production env Stripe".
- User-list source tag (line ~841): when `source === "admin_active"`, show `active · development env` / `active · production env` instead of `live · sandbox`.

## Deliberately NOT changed

- **Test-user flag** (`isTest`, "Only test users", "Mark as test user", `admin.list.$kind`, `admin.index`, `admin.map`, `admin.reporting`, `admin.errors`, `admin.feedback`, `admin.activity`, `admin.users.$userId`) — different concept (QA accounts), not a Stripe env.
- **`c.scope === "active_now" ? "live" : "next"`** in `admin.index.tsx` line 404 — "live" here means "applied to the active subscription", not a Stripe env. Unrelated to this rename.
- Route `search={{ test: false }}` params and Zod schema keys — URL contract, not display copy.
- Server code, DB column names, and Stripe API values — unaffected.

## Verification

Typecheck after the edits and eyeball the promo-codes page (banner, env pill, table Stripe column, detail sheet).
