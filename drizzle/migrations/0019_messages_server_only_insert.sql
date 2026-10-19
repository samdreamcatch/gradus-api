-- Only the server writes messages (decision #56, 2026-10-19).
--
-- Every send goes through `sendMessage` (src/lib/messages.server.ts), which
-- applies the room rule (`athleteRoomGate`: a minor's room needs their parent
-- linked, and verified while verification is required), blocks, the text-only
-- rule for minors and a parent's pause, then writes with the service role.
--
-- The client-side policy "Participants insert messages" let any participant
-- post straight to the table with their own session and skip every one of
-- those checks: for example a coach, with a crafted request, in a room with a
-- minor whose parent has not joined, opened before the rule. No app code does
-- that (the web app, iOS and Android all send through the server), so nothing
-- changes for the apps; the row-level door is simply closed. Reading stays as
-- it was ("Participants view messages"), and so does realtime, which uses it.
DROP POLICY IF EXISTS "Participants insert messages" ON public.messages;
REVOKE INSERT ON public.messages FROM authenticated;
