## Plan

1. Open a secure secret prompt for `VITE_TURNSTILE_SITE_KEY` (Cloudflare Turnstile public site key, starts with `0x...`).
2. Once you submit it, write the value into `.env` as `VITE_TURNSTILE_SITE_KEY="..."` so Vite exposes it to the client bundle.
3. Restart the dev server so the new env var is picked up.
4. Verify on `/signup/parent` that the Turnstile widget renders, produces a token, and the **Continue** button becomes enabled once the checkbox is ticked.

Note: the site key is public by design (safe in the client bundle). The matching `TURNSTILE_SECRET_KEY` (server-side) is a separate step — tell me if it's not already saved and I'll prompt for it too.