# Christine / Addie plans-page error — what happened and what to do

## Answer to your question

The fix for Christine was **two separate things**, and only one of them was live before today:

1. **Data cleanup** (removing the duplicate Addie/Addisyn records, relinking Addie to Christine). This is a database change — it took effect immediately, no publish required. Her data looks correct now: one Addie DiMuro (b. 2007-10-08), parented by Christine, linked to one coach, with a working athlete login.
2. **The actual plans-page crash fix** (Addie has a Gradus starter plan with no coach, and the coach filter dropdown choked on the empty coach value). That was a **code** change. It shipped to the repo yesterday evening, *after* Christine's last sign-in (19:13 UTC Aug 20), and it only reached the live site with the publish you did today.

So: she has almost certainly been running the old bundle every time she tried since. The one caveat is that the app installs a service worker on gradus.training, so a phone that has the site pinned/installed can keep serving the old cached bundle until it updates.

## What she should try first (no code needed)

- Fully close the tab / installed app and reopen it, or load `https://gradus.training/?sw=off` once. The service worker is set to auto-update, so a reopen after the publish should pull the new build.
- If it still errors, we need her exact error text/screenshot — that tells us whether it's the fixed dropdown crash or something new.

## Work to do in the app

1. **Confirm the fix against her real data.** Reproduce the parent plans page as Christine (via the admin impersonation layer already built) and load `/parent/plans` and Addie's Gradus plan detail. Verify no crash with the `coach_id = NULL` starter plan.
2. **Close the recurrence gap at the data layer.** Rather than relying on each screen to special-case a missing coach, add a check when creating Gradus starter plans so the "no coach" case is represented consistently, and audit the remaining parent/athlete/coach screens for any other place a coach id is fed into a `Select`, a route param, or a lookup without a fallback.
3. **Make this class of failure visible.** The parent plans crash never appeared in our error log because it fails inside the page render before the client reporter is attached. Add error reporting to the parent plans route boundary so any future crash there lands in the admin error dashboard with the user attached, instead of us hearing about it from a parent.
4. **Tell users when a new build is available.** Since the app is installed on phones as a PWA, add a lightweight "New version available — tap to refresh" prompt when the service worker picks up a new build, so a publish actually reaches people like Christine without them force-closing the app.

## Technical notes

- Offending row: plan `0be04267…` "Juvenile — Free Skate", `coach_id IS NULL`, `source = gradus`, athlete Addie.
- `listParentPlans` in `src/lib/parent-plans.functions.ts` already maps a null coach to `coachId: ""` / `coachName: "Gradus"`, and `parent.plans.index.tsx` already substitutes `__gradus` for the Select value — that pairing is the fix that needed publishing.
- PWA is `registerType: "autoUpdate"` with `injectRegister: null` (`src/pwa/register-sw.ts`); there is currently no user-facing update prompt, which is item 4.
