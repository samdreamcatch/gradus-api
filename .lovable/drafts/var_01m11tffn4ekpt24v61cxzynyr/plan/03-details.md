## Technical notes

- `src/components/board/my-skaters.tsx`: delete the "Go to {rink}" `Chip` and drop the `onSelectRink` prop from the component's props type.
- `src/routes/board.$slug.tsx`: remove the `onSelectRink={goToRink}` prop and the now-unused `goToRink` callback. The `rinkName` state stays — the Live tab's own rink chips still set it.
- No data, server function, or schema changes.

If you'd rather keep a way to jump, the alternative is to keep the chip but make the rink line itself the target instead of a third button. Say the word and I'll plan that instead.
