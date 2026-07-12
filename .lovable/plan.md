Three complementary ways to confirm Google sign-in is wired correctly. None require you to actually complete a Google sign-in — the parts that can be inspected from outside your Google account are the OAuth broker handshake and the callback landing on our authed flow.

## 1. Verify the OAuth broker returns a real Google authorize URL

Fastest smoke test. From my side I can hit the managed OAuth broker's initiate endpoint the same way the button does and confirm the response is a redirect to `accounts.google.com/o/oauth2/...` with a valid `client_id`, `redirect_uri`, and `state`. If any of those are missing/wrong, that's the whole class of "Unsupported provider" / "redirect_uri mismatch" bugs caught before you ever click anything.

Deliverable: a short report showing the resolved authorize URL and the redirect_uri Google will call back on.

## 2. End-to-end headless run in the sandbox

I drive a headless Chromium against the live preview:
1. Open `/signup/coach`, tick ToS, click **Continue with Google**.
2. Follow the redirect through `oauth.lovable.app` to Google's account chooser.
3. Screenshot the Google page (proves the handshake reached Google with our client) and stop there — I can't complete Google's flow without a real account.
4. Also test the failure path: dismiss/deny and confirm we land back on `/signup/coach` with the stash cleared (no cross-account leak).

This gives you a screenshot of Google's page rendered with "Gradus" (or the OAuth client name) as the requesting app, plus proof the return-on-cancel path works.

## 3. You test the full round-trip on the published site

The only thing that can prove a full successful sign-in is a real Google account. I'll give you a 60-second script:

1. Open the site in a private/incognito window: `https://gradus.training/signup/coach`.
2. Tick ToS, enter a promo code (use a known one, or leave blank).
3. Click **Continue with Google** → pick a Google account you don't already have a Gradus account for.
4. Expect: land on `/coach` (or `/coach/onboarding` for a brand-new coach), see a toast `Promo code applied` if you used one, and see the account in **Admin → Users** with ToS recorded.
5. Sign out, sign back in with the same Google account from `/login`, expect the coach dashboard.
6. Repeat once cancelling at Google's account chooser to confirm you return to `/signup/coach` cleanly and no promo/ToS marker sticks (check `localStorage` in DevTools — `gradus.pendingTermsAccept` and `gradus.pendingPromoCode` should be gone).

## What I need from you

Pick any combination:
- **(a)** Just run #1 (broker probe) — no browser, ~10 seconds.
- **(b)** Run #1 + #2 (broker probe + headless Playwright to Google's page with screenshot).
- **(c)** Skip mine, follow the manual script in #3 yourself.

Recommend **(b)** — it's the most evidence I can gather without a real Google account, and it will catch every configuration bug except "the user's Google account isn't recognized."
