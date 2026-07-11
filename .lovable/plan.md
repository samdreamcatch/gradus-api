## Swap the SMS link for a native Web Share button

Replace the current text link ("Send them an invite" → `sms:` href) with a proper button that uses the same native share flow as the plan share-to-socials button (`navigator.share`). This opens the OS share sheet, letting the athlete pick Messages, WhatsApp, Mail, AirDrop, etc. — not just SMS — while keeping "text it to my parent" as the natural first choice on mobile.

### Changes to `src/routes/signup.athlete.tsx`

Replace the current invite block at the bottom of the "code" stage with a real button that:

- Is visually a **button**, not a link — using the shadcn `Button` component so it clearly reads as an action.
- Copy: primary label **"Send my parent an invite"**, with a `Send`/`Share2` icon from `lucide-react`, and a small line of secondary text above it: **"Parent not on Gradus yet?"** for context.
- On click, calls `navigator.share({ title, text, url })` with:
  - `title`: `"Join me on Gradus"`
  - `text`: `"Hey — I want to sign up for Gradus. Can you make a parent account so you can add me?"`
  - `url`: `https://gradus.training/signup/parent`
- Falls back to `navigator.clipboard.writeText(url)` + a `toast.success("Link copied")` when the Web Share API isn't available (desktop browsers), matching the fallback pattern in `share-to-socials-button.tsx`.
- Swallows `AbortError` silently (user dismissed the share sheet).

No token/server fetch is needed (unlike the plan share button, this URL is static), so the button can call `navigator.share` synchronously inside the click handler — preserving user activation on iOS/Safari.

### Scope

- Edits only `src/routes/signup.athlete.tsx`.
- Imports `Button` from `@/components/ui/button` (already imported), `toast` from `sonner`, and an icon from `lucide-react`.
- No new component, no backend, no dependencies.
