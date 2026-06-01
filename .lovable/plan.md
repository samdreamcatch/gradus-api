## Remove the "Your athletes" subtitle on /coach/messages

The selected `<p>` is the subtitle rendered by `MessagesHeader` when a `subtitle` prop is passed. It's not its own component — it's an optional `<p>` inside `MessagesHeader` controlled by the `subtitle` prop.

### Change

In `src/routes/_authenticated/coach.messages.index.tsx` (line 26), drop the `subtitle` prop:

```tsx
<MessagesHeader />
```

That removes the "Your athletes" line while keeping the "Messages" title and the rest of the page (New button, room list, bottom nav) unchanged. `MessagesHeader` already handles `subtitle` being absent, so no other edits are needed.

If you instead meant "remove the whole header (Messages title + subtitle)", let me know and I'll remove the `<MessagesHeader …/>` line and its wrapper `<div>` instead.