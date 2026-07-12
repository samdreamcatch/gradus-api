## Restore original watermark, swap in the new PNG

1. Bake a new watermark JPG from the uploaded `Multi-Sport_Line_Art_Icons_Poster-4.png`:
   - Composite the athlete artwork at ~20% opacity onto a solid `#F8F9FC` (paper) background so it's visible in every email client but stays a whisper behind text.
   - Save as a JPG (email backgrounds must be opaque — Gmail/Outlook ignore CSS opacity on `background-image`).
   - Upload via `lovable-assets` and overwrite `src/assets/email-poster-watermark.jpg.asset.json` with the new pointer.

2. Revert `src/lib/email-templates/_styles.ts` container styles to the original corner-tucked treatment:
   - `backgroundPosition: 'right -40px top -30px'`
   - `backgroundSize: '420px auto'`
   - (keep `backgroundRepeat: 'no-repeat'`)

No other files change. Athletes will be clearly visible in the top-right corner with breathing room around the text again.