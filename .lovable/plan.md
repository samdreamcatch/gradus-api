
# Adult-athlete → coach invites + suppress redundant celebration

Two changes, both scoped to closing gaps in the connection experience audit.

## 1. Adult athlete can invite a coach

Today an adult athlete can only hand out their own code and wait. This adds
the mirror direction: the athlete sends a link that either (a) links an
existing coach account by code, or (b) walks a brand-new coach through
signup and links them at the end.

### What the athlete sees

- **Athlete Settings → "Invite a coach"** card (mirrors the parent's existing
  "Invite coach" card). Shows a shareable link and copy button.
- The link is `/i/<8-char-code>` — the same universal entry we already have.
- Below it, a small "How this works" note: "Send this to your coach. They'll
  either sign in, or create a Gradus coach account. Either way, you'll be
  connected as soon as they finish."

### What the recipient sees

- Universal `/i/<code>` already resolves to an invite kind. Today it resolves
  `adult-athlete` codes and, if the visitor is signed out, routes them to
  `/signup/coach?invite=<code>`. We keep that.
- If the visitor is already signed in as a coach: route to a lightweight
  confirm page ("Link with Dani California?") that calls the existing
  `claimAdultAthleteInvite`.
- If signed in as anything other than a coach: friendly "This invite is for a
  coach account" screen with a sign-out option.

### What's already done vs. new

- **Already built:** `adult_athlete_invite_codes` table, code generation,
  `getAdultAthleteByInviteCode`, `claimAdultAthleteInvite`, `/signup/coach`
  handling `?invite=` for adult-athlete codes, `/i/$code` resolving to it.
- **New:** the athlete-facing invite card + settings entry point, and the
  signed-in-coach confirm screen at `/i/$code` (short-circuit instead of
  bouncing to `/signup/coach`).

## 2. Suppress the celebration modal for the just-signed-up user

The celebration modal is meant to be a moment of delight when a new
connection appears. Right after a signup wizard whose final screen already
says "you're connected", it reads as a duplicate. We auto-ack the new
user's side at the moment the link is created inside the wizard.

### Where to auto-ack

Two places create a link during a signup wizard:

1. **Parent signup with `?invite=<coach-code>`** — parent claims a coach
   during `/signup/parent`. Set `other_ack_at = now()` on the new
   `coach_athletes` rows in the same insert.
2. **Coach signup with `?invite=<adult-athlete-code>`** — coach claims an
   adult athlete during `/signup/coach`. Set `coach_ack_at = now()` on the
   new `coach_athletes` row.

The **other side** (the existing coach in case 1, the existing adult athlete
in case 2) still has their `*_ack_at` NULL, so they see the celebration
normally on their next visit. Nothing changes for existing users.

### What stays the same

- Parent adding a coach from Settings (post-signup) → **both** sides see the
  celebration. Unchanged.
- Coach claiming a code from Settings → **both** sides see the celebration.
  Unchanged.
- Every non-wizard path unchanged.

### Trade-off the user should know

The new user never sees the celebration animation for their first
connection. The wizard's own confirmation is the moment. If we later want a
"welcome to Gradus, here's who you're linked with" screen, that's a
different surface — this change just prevents the duplicate modal.

## Test plan updates

Existing test paths B (parent signup with invite) and E (coach signup with
adult-athlete invite) should now assert **no modal** on the new user's first
page load, and modal-as-usual on the other side. Add a new **Path I: Adult
athlete invites a coach** covering both branches (existing coach account,
brand-new coach signup).

## Technical notes

- Auto-ack lives in `src/lib/parent-signup.functions.ts` and
  `src/lib/adult-athlete-invite.functions.ts` (or wherever the coach-signup
  claim happens — verify during implementation). The change is a single
  extra field on the existing `coach_athletes` insert; no schema change.
- New athlete-facing invite card: reuse `src/components/parent/invite-coach-card.tsx`
  as the template, swap the copy and the `getOrCreateAdultAthleteInviteCode`
  → coach-invite-code hook pattern (there's already an equivalent hook for
  the parent invite card).
- Signed-in-coach short-circuit at `/i/$code`: extend
  `src/routes/i.$code.tsx` to check auth + role before redirecting to
  `/signup/coach`, and render a confirm screen that calls
  `claimAdultAthleteInvite` on click.
- No DB migration needed — every table and RPC already exists.
