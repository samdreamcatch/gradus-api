# Publish the updated privacy policy

Nothing blocks this publish. Details below, then the one action.

## What I checked

- Latest build: OK (no build errors).
- Security scan: no critical findings. One pre-existing warning (internal cron webhooks are gated by the public key rather than a secret) — unrelated to the privacy policy and not a publish blocker.
- The "Missing SUPABASE_SERVICE_ROLE_KEY" error you saw on the Tami Taylor account was a preview-sandbox environment problem, already re-bound and fixed. The published site has its own backend environment and was never affected by it.

## The one thing to know

Publishing ships the whole current app, not just the privacy policy page. Everything currently in preview goes live with it — the settings reorder, Account & security sub-pages, guardian mirroring, and the account-deletion/tombstone work.

If you only want the privacy policy live right now, the rest of that work would need to be held back, which is not how publish works here — so the decision is whether all current preview work is ready to be public.

## Action

Publish the project to the Lovable URL and the connected custom domain (gradus.training). Then spot-check /privacy on the live site.

## Recommended follow-up (separate, not blocking)

Replace the publishable-key check on the three cron hook routes with a dedicated cron secret or the service role key.
