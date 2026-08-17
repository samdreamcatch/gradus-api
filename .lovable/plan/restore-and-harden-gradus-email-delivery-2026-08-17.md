# Restore and harden Gradus email delivery

## Confirmed findings

- The sender domain is verified, the live queue processor is running every few seconds, and the email database infrastructure is present.
- The latest manual welcome email reached the queue and was attempted five times; the provider rejected every attempt with `Missing run_id or idempotency_key`, after which it moved to permanent failure.
- The previous invalid auth identifier problem is fixed in the shared processor. The remaining failure is that manual, lifecycle, guardian, and error-digest producers do not provide the idempotency key required for app emails.
- There are currently 94 permanently failed unique emails and no successful unique sends in the current log history. Most historical failures are internal error alerts/digests; they must not be blindly replayed.
- Automatic lifecycle scheduling is active, but the lifecycle job table currently contains no rows. Existing users are not backfilled by insert-only signup triggers.

## Implementation

1. **Create one canonical app-email payload builder**
   - Require a stable message ID, idempotency key, transactional purpose, sender information, recipient, template label, and queued timestamp.
   - Keep auth emails on their separate, valid auth-run path.
   - Reject malformed app-email payloads before they enter the queue so this class of provider failure cannot recur.

2. **Move every app-email producer to the canonical payload**
   - Manual sends from the email editor.
   - Welcome and activation lifecycle sends.
   - Guardian invite/activity messages.
   - Error digest and alert sends.
   - Normal app-email route and configured CC/BCC copies.
   - Use event-derived keys where an event/job exists and a generated message-derived key for one-off manual sends.

3. **Make logging accurately reflect delivery state**
   - Check and report failures when writing pending/sent/failed log rows instead of silently continuing.
   - Keep template names consistent across pending, retries, sent, and permanent failure rows.
   - Do not mark lifecycle jobs as delivered merely because they were queued; retain enough correlation to verify the final queue result.

4. **Repair lifecycle coverage without duplicate sends**
   - Keep the active five-minute worker and existing one-per-user/per-email uniqueness rule.
   - Add a controlled backfill for eligible existing users who never received welcome/activation emails, excluding test accounts and anyone with a successful or active delivery record.
   - Do not replay the 94 historical dead-letter entries wholesale, especially the internal error-alert loop.

5. **Verify end to end on Live**
   - Publish the corrected worker and producers so the live scheduled processor receives the fix.
   - Trigger one fresh test to `support@gradussports.com`.
   - Confirm: trigger succeeds, pending row appears, queue item contains an idempotency key and no app-email auth identifier, processor accepts it, latest deduplicated status becomes sent, and the message arrives in the recipient inbox.
   - Then trigger one role-specific welcome email and confirm its settings link and status through the same path.

6. **Stabilize the unrelated preview hydration warning observed during investigation**
   - Mount preview developer controls only after client hydration so they cannot differ between server HTML and the initial browser render.

## Technical notes

- App emails use `purpose: transactional` plus `idempotency_key`; only authentication webhook emails use `run_id`.
- Existing permanent failures remain historical audit records. Recovery uses deliberate fresh sends with new traceable message IDs rather than mutating or bulk-replaying old records.
- Verification will use the live send log, live queue state, worker response/logs, and recipient inbox—not only a successful UI toast.