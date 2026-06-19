## Problem

On iPhone Safari, the screen dims and sleeps during voice recording. The browser keeps the mic active, but a sleeping screen makes it impossible to see the timer, level meter, or stop button.

## Fix

Use the Screen Wake Lock API (`navigator.wakeLock.request('screen')`) inside `src/hooks/use-voice-capture.ts`:

1. **Acquire** a wake lock right after `recorder.start()` succeeds in `start()`.
2. **Release** it in `stop()`, `cancel()`, the auto-stop timer, the `recorder.onstop` handler, and on hook unmount — every path that ends recording.
3. **Re-acquire** on `visibilitychange` when the document becomes visible again (iOS auto-releases the lock when the tab is backgrounded, and won't restore it on return).
4. Wrap in feature detection (`'wakeLock' in navigator`) and a try/catch so unsupported browsers (older iOS) silently no-op without breaking recording.

No UI changes. No new dependencies. Change is isolated to `use-voice-capture.ts`.

## Notes

- Wake Lock is supported on iOS Safari 16.4+. Older iOS versions will fall back to current behavior — there is no reliable JS workaround for those.
- The user should still keep their phone unlocked; Wake Lock only prevents idle dimming inside an active tab, not a manual lock.
