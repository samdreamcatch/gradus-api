## Option A — drop tables from Realtime, remove unused read-receipt wiring

### 1. Migration: remove tables from the Realtime publication
```sql
ALTER PUBLICATION supabase_realtime DROP TABLE public.message_rooms;
ALTER PUBLICATION supabase_realtime DROP TABLE public.message_reads;
```
Closes both error-level findings. The `messages` table stays in the publication (room-scoped channel still works).

### 2. Remove the now-dead `message_reads` Realtime subscriptions
You don't want read receipts at all, so the listeners are wasted websocket traffic. Strip them out:

- `src/hooks/use-messages-unread.ts` — drop the second `.on("postgres_changes", { ... table: "message_reads" }, ...)` handler.
- `src/components/messages/room-view.tsx` — drop the second `.on("postgres_changes", { ... table: "message_reads" }, ...)` handler.

The `messages` listener stays in both files (that's how the inbox badge and the open conversation refresh in real time).

### 3. Leave `markRead` / `message_reads` table alone
The table is still useful for the unread-count query itself (server-side counts of "messages I haven't read yet"). Only the Realtime broadcast goes away. Nothing about how reads are written or counted changes.

### Files changed
- new migration
- `src/hooks/use-messages-unread.ts`
- `src/components/messages/room-view.tsx`
