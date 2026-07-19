Rewrite the confusing header copy on `/admin/promo-codes` and reduce the friction of getting a code "ready" in Stripe, so an admin doesn't have to know what "minted per env" means.

### 1. Rewrite the header copy (plain English)

Replace the current one-liner with two short lines and a tiny legend, still in `src/routes/_authenticated/admin.promo-codes.tsx`:

- Line 1: "Promo codes do two things: track who signed up with them, and (optionally) discount checkout by a set %."
- Line 2: "Any code with a discount has to be created in Stripe once for **test** (preview) and once for **live** (published site) before checkout can apply it. The Stripe column shows where each code is ready."

Legend chips right under it:
- green dot = ready in this environment
- gray dash = not created yet — click **Sync** on that row

Show the current environment ("You're viewing: **Test**" / "**Live**") as a small pill so it's obvious which environment a Sync click will affect.

### 2. Replace the raw `sandbox: — / live: —` cell with a status pill

In the "Stripe" column of each row (`admin.promo-codes.tsx`, ~line 475), show one of three states with the same words used in the header:

- **Ready in test & live** (green) — both minted
- **Ready in test only** / **Ready in live only** (amber) — one env done
- **Not created yet** (gray) — neither env done, or percent_off is 0 so no minting needed → show "Attribution only"

Keep the row's **Sync (current env)** button, but relabel it based on state:
- Not synced in this env → "Create in test" / "Create in live"
- Already synced in this env → "Re-sync in test" (secondary, less prominent)

### 3. Add a top-of-table "Sync all unminted in test/live" button

Above the table, add one button: **"Create X unsynced codes in test"** (label swaps to "in live" when viewing the live admin). It iterates through rows where the current env is missing a Stripe ID and syncs them one after another, showing progress in a toast. This turns the two-trip workflow into two single clicks (one in preview, one in live) instead of one click per row per env.

No new server functions needed — it just calls the existing `syncPromoCodeToStripe` server function in a loop.

### Scope

- Frontend-only changes in `src/routes/_authenticated/admin.promo-codes.tsx`.
- No database, no Stripe/webhook, no server-function changes.
- No changes to the "New code" form or the table's other columns.

### Out of scope (call out explicitly)

- Auto-syncing on create. Tempting, but silently creating things in Stripe from a preview environment can produce surprises (e.g. a typo'd code minted in live). Keeping Sync explicit, just making the intent obvious, is safer.