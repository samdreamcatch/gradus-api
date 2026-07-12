## Goal

Keep the current OG image's Gradus logo, tagline, and copy exactly as-is — but swap the blank paper background for the multi-sport line-art poster so shared links look like the business cards.

## Approach

Use `imagegen--edit_image` to composite the two existing images: the current OG card (foreground: logo, wordmark treatment, "welcome to", tagline) placed over a softened wash of the multi-sport poster (background). One static 1200×630 JPG, wired in as the sitewide default so every shared link picks it up.

## Steps

1. **Build the composited image.**
   - Inputs: the current OG (`https://storage.googleapis.com/gpt-engineer-file-uploads/attachments/og-images/0c5d60d3-0d52-46c2-8477-879f52760408`) + the uploaded `Multi-Sport_Line_Art_Icons_Poster-7.png`.
   - Prompt `imagegen--edit_image` to place the multi-sport poster as a soft, low-contrast watermark background (bleeding to the edges, same navy line-art washed to ~15–20% presence like the business card) and keep the existing Gradus wordmark, tennis-green highlight stripe, "WELCOME TO" eyebrow, "The operating system for athletic mastery." headline, and "Unlock your full potential" tagline **untouched** in the center.
   - Output at 1200×630, saved to `src/assets/og-share-card.jpg`.
   - Upload via `lovable-assets` to get a stable CDN URL; keep the pointer at `src/assets/og-share-card.jpg.asset.json`.

2. **Wire it in as the sitewide default (`src/routes/__root.tsx`).**
   - Replace the current `og:image` and `twitter:image` URLs (currently the GCS upload) with the new CDN URL from the asset pointer.
   - Leave every other head tag alone. Leaf routes (`/p/$token`, home, signup) inherit automatically.

3. **QA the image before finishing.**
   - View the generated JPG to confirm: logo/wordmark/copy match the current OG exactly, poster reads as a subtle background not a competing foreground, nothing is clipped at 1200×630.
   - If the first pass alters the foreground text or wordmark, re-run with a tighter prompt or fall back to only editing the background region.

## Notes

- Crawlers cache the previously-scraped preview. Existing shared links (iMessage, Slack, X, Facebook) may still show the old image until their cache expires — the user can force a refresh in each platform's link-preview debugger.
- Sitewide default is the right primitive: root `og:image` propagates to every route that doesn't override, so one image change covers home, signup, and every `/p/$token` share.

## Files touched

- `src/assets/og-share-card.jpg.asset.json` (new — CDN pointer)
- `src/routes/__root.tsx` (swap `og:image` + `twitter:image` URLs only)
