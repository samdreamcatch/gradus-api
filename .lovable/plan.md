## Goal

Every "Invite your …" surface in the app should offer a one-tap native share (iOS/Android share sheet, desktop clipboard fallback) with the invite code already embedded in the URL, so whoever taps the link lands in signup pre-linked. No more "copy link + copy code" two-button dance.

## New shared component

**`src/components/share/share-invite-button.tsx`** — one primitive used everywhere.

Props: `url`, `title`, `text`, `label?` (default "Share invite"), `variant?`, `size?`, `className?`, `onShared?`.

Behavior (mirrors the pattern already in `signup.athlete.tsx` and `plans/share-to-socials-button.tsx`):
1. Call `navigator.share({ title, text, url })` synchronously in the click handler (preserves iOS user-activation).
2. On `AbortError` → do nothing.
3. If Web Share unsupported or throws → `navigator.clipboard.writeText(\`${text} ${url}\`)` and toast "Invite copied".
4. Final fallback: toast "Share this link" with the URL as description.

Icon: `Share2` from lucide.

## Wire it into every invite CTA

For each surface below, the existing shareable URL already embeds the code that auto-links on signup — no backend or route changes needed.

| Surface | File | URL to share |
|---|---|---|
| Parent → Coach card (settings, parent home) | `src/components/parent/invite-coach-card.tsx` | `${origin}/signup/coach?invite=${code}` |
| Parent → Coach banner (app-wide until first coach) | `src/components/parent/invite-coach-banner.tsx` | same |
| Parent → Athlete card (per-athlete QR card in settings) | `src/components/parent/athlete-invite-card.tsx` | `url` prop (already `/signup/athlete?code=…`) |
| Coach → Parent invite (onboarding, roster, settings) | `src/components/onboarding/invite-card.tsx` | `${origin}/signup/parent?invite=${code}` |
| Under-18 athlete → Parent invite | `src/routes/signup.athlete.tsx` | already uses this pattern — refactor to use the new component |

In each card the primary CTA becomes **"Share invite"** (the new button). The raw code chip stays visible for read-out / manual entry, and a small secondary "Copy code" icon-button stays for the "coach already on Gradus, paste this code" flow. The standalone "Copy link" button goes away — sharing replaces it.

Copy tweaks per surface (short, in the button/toast only):
- Coach card / banner: title "Invite your coach to Gradus", text "Join me on Gradus so we can share practice plans and messages."
- Athlete card: title "Join me on Gradus", text "Tap the link to set up your athlete account — it'll link straight to me."
- Coach's parent-invite card: title "Join me on Gradus", text "I'm your coach on Gradus — tap to set up your parent account and we'll be connected."
- Under-18 kid: keep existing copy.

## Out of scope

- No DB/schema changes. Codes and auto-link logic already exist end-to-end.
- No changes to `/signup/*` routes — they already accept `?invite=` / `?code=` / `?promo=`.
- No email/SMS sending — sharing stays user-initiated via the native sheet.
- Plan sharing (`share-to-socials-button.tsx`) is a separate feature and stays as-is.

## Technical notes

- `navigator.share` must be called synchronously inside the click handler (not after an `await`) or iOS rejects it — the component's handler is structured accordingly.
- `navigator.clipboard.writeText` is the desktop fallback; wrapped in `try/catch` because it can reject in insecure contexts.
- Component is client-only (uses `navigator`), safe in these client-rendered cards; guarded with `typeof navigator !== "undefined"` for SSR.
