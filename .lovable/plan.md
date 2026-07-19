# Use the real Gradus logo in email headers (transparent PNGs)

## Assets provided
- `user-uploads://gradus-logo-light_2.png` — dark navy wordmark + lime stripe on a light-slate background.
- `user-uploads://gradus-logo-dark_2.png` — cream wordmark + teal stripe on a near-black background.

Both will be background-removed so the paper card shows through behind the wordmark.

## Current state (verified)
`src/lib/email-templates/_layout.tsx` renders the wordmark as a `<Text>` with a CSS `linear-gradient` highlighter stripe (`wordmark` / `wordmarkHighlight` in `src/lib/email-templates/_styles.ts`). No logo image file exists in the repo. Email `Body` background is always `#ffffff`; the inner paper card is `#F1F3F7` (cream-grey) — the light (dark-ink) wordmark is the correct default there.

## Plan

1. **Background-remove both variants** with `imagegen--edit_image` (`transparent_background: true`), writing intermediates to `/tmp/`:
   - light → `/tmp/email-wordmark-light.png`
   - dark → `/tmp/email-wordmark-dark.png`
   The prompt preserves the wordmark and lime/teal highlighter stripe exactly — only the outer rectangle background is removed.
2. **Upload both as CDN assets** via `lovable-assets create --file /tmp/... --filename ...`, writing pointers to:
   - `src/assets/email-wordmark-light.png.asset.json`
   - `src/assets/email-wordmark-dark.png.asset.json`
3. **Update `src/lib/email-templates/_layout.tsx`**:
   - Replace the text wordmark `<Text>` with a React Email `<Img>` sourcing the **light** (dark-ink) CDN URL — it reads correctly on the light-slate paper card in every inbox.
   - Display ~200px wide (source is 1200px — retina-safe), auto height, `display: block; margin: 0 auto`, `alt="Gradus"`.
   - Keep the existing `topRule` hairline and `pageInner` padding wrapper untouched.
4. **Retire dead styles** in `src/lib/email-templates/_styles.ts`: remove `wordmark` and `wordmarkHighlight` (only referenced by the old header). Leave everything else alone.
5. **Register the dark variant but do not wire a dark-mode swap now**. Email client `prefers-color-scheme` support is inconsistent (Outlook web/desktop ignore it; Gmail is partial), and the paper card stays light in every client, so the light wordmark is correct by default. Keep the dark asset available for a future full dark-mode email theme.
6. **Verify** by rendering an existing template through the transactional preview route (`/lovable/email/transactional/preview`) or the admin email tools and confirming the transparent wordmark sits cleanly on the paper card with the stripe intact and no white halo.

## Notes
- Background removal can sometimes clip anti-aliased edges of a serif letter or leave a faint fringe on a saturated stripe. If either PNG looks off in the preview, I'll rerun the edit with a tightened prompt or fall back to the solid-background versions.
