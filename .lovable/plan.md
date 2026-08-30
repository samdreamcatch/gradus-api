# Expand guardian mirroring

Today a guardian-on-file (minor athlete, no parent account yet) only receives an email copy when **a coach sends a text message**. Three gaps close here:

1. The athlete's own messages are never mirrored, so a guardian relying on email sees only one side of the conversation.
2. Voice messages are never mirrored.
3. Plan assignment is never emailed at all — there is no guardian email when a coach activates a plan for the athlete.

## What changes

**Athlete messages are mirrored too.** When the athlete sends a message in their room, the guardian on file gets the same email copy they already get for coach messages — same template, same subject shape, sender shown as the athlete's name (the template already supports a `senderRole` of `athlete`).

**Voice messages are mirrored with a transcript.** When a voice message is sent, the audio is transcribed and the transcript is placed in the email body, prefixed so the guardian knows it was spoken rather than typed (e.g. "Voice note (0:42) — transcript:"). No audio link is included; the audio itself stays behind an account. If transcription fails, the guardian still gets the email, worded as a voice note with no transcript available, so a failure never silently drops the notification.

**Plan assignment sends a guardian email.** When a coach activates a plan for the athlete, the guardian on file gets a short email: the coach's name, the plan title, and the same claim button. It reuses the existing guardian activity email rather than adding a new template, with the body describing the assignment instead of quoting a message.

The existing eligibility rules are unchanged and apply to all three: only athlete-scoped activity where the athlete has a guardian email and claim token on file, no linked parent account, and an unclaimed guardian invite. Nothing is sent once the guardian has an account. Parent-sent messages are not affected (a room with a parent participant is by definition already claimed).


## Technical notes

- `src/lib/messages.functions.ts` (`sendMessage`): lift the guardian-mirror block out of the `role === "coach" && data.kind === "text"` condition into a helper that runs for `role === "coach" || role === "athlete"`, for both `text` and `voice` kinds. The eligibility query on `athletes` stays as-is.
- Sender name resolution branches on role: coach → `coach_profiles` lookup, prefixed "Coach"; athlete → the athlete's own first/last name already fetched by the eligibility query. `senderRole` is passed through to `sendGuardianMessageCopy`, which already accepts `"coach" | "athlete"`.
- Voice body: transcribe the just-uploaded bytes with the existing `transcribeWithElevenLabs` helper in `src/lib/voice.server.ts` (dynamic import, server-only) before the mirror email is composed. Reuse the in-memory `bytes` from the upload step rather than re-downloading from storage. Wrap in try/catch; on failure send the email with a "transcript unavailable" body.
- The whole mirror block stays inside its existing try/catch and continues to run after the message row is inserted, so a mail or transcription failure can never fail the send.
- No schema change, no RLS change, no change to `src/lib/email-templates/guardian-activity.tsx` markup — only the `body`/`senderName` values passed into it. Copy overrides in the email-copy admin continue to apply.
- Note: no client currently sends `kind: "voice"` (the composer dictates to text before sending), so the voice path covers the server API and any future/native voice sending.
- Verify with `bunx tsgo --noEmit`, `bun run lint`, and prettier.
