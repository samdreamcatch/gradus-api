## Why the native share sheet stopped appearing

`ShareToSocialsButton` currently does:

```
click → await getOrCreateShareToken() → navigator.share(...)
```

Browsers gate `navigator.share()` behind **transient user activation** — it must be called synchronously in the same tick as the click. `await`ing a server function first (network round-trip) consumes the activation, so:

- iOS Safari and Safari macOS reject the call with `NotAllowedError` → we swallow it and fall through to `navigator.clipboard.writeText`, so the user sees a "Link copied" toast instead of the share sheet.
- Chrome Android is more lenient but has been tightening this in recent versions.

The code path itself is intact — this is a user-activation regression, not a missing feature.

## Fix

Rework `src/components/plans/share-to-socials-button.tsx` so the share sheet opens within the click gesture:

1. **Prefetch the share token** so the click has a URL ready synchronously:
   - On mount (and after successful mutation) call `getOrCreateShareToken` once via `useQuery` / `useEffect`, cache the returned `token` in state.
   - When the token is already known, the click handler runs `navigator.share({...})` immediately — no `await` before it — preserving user activation.
2. **Cold-path fallback** (token not yet loaded when user clicks):
   - Keep the current `await` + share flow, but recognize the share sheet won't open on Safari. In that case, skip straight to clipboard copy with the existing toast so behaviour is predictable.
3. Keep the existing clipboard fallback for browsers without `navigator.share` (desktop Firefox, older Chrome) and for the AbortError branch.
4. No changes to `getOrCreateShareToken` or the server side.

### Technical notes

- Prefetch key: `["plan-share-token", planId]`; run only when the button mounts on an authenticated route (both athlete and parent plan detail pages already gate this).
- Guard the prefetch behind `enabled: !!planId` and don't retry aggressively (tokens rarely fail; we still have the on-click fallback).
- No UI changes; button label, spinner, and toast copy stay the same.
- No new dependencies.

## Files touched

- `src/components/plans/share-to-socials-button.tsx` — prefetch token, call `navigator.share` synchronously in click handler.

## Verification

- On iOS Safari (published site), tapping "Share to socials" opens the native share sheet on the second render (token cached). First-ever click may still fall back to copy — acceptable and matches prior behaviour.
- On desktop Chrome/Edge with Web Share, the OS share dialog opens.
- On desktop Firefox (no Web Share), link is copied to clipboard with toast — unchanged.
