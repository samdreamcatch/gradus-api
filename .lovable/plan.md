# Restore app email delivery

The email setup itself is active: the sender domain is verified, the live queue processor is scheduled, the backend is healthy, and the queue is running. The email triggered at 1:19 UTC did register as `pending`, but it moved through five failed attempts within about two minutes, so the dashboard’s active **Pending** filter no longer showed it.

The confirmed failure is `run_not_found`. The central queue processor still includes an auth-only run identifier in every send request, even when an app email has no such identifier. That affects manual sends, welcome/activation emails, guardian emails, error alerts, and CC/BCC copies. Auth emails legitimately have this identifier and must retain it.

## Implementation

1. Update the shared queue processor to include the run identifier only when a real, non-empty value exists.
   - Preserve it for authentication emails.
   - Omit the field entirely for app emails.
   - Keep the existing retry, suppression, deduplication, and logging behavior unchanged.
2. Verify all enqueue paths produce the right payload shape:
   - authentication emails include the identifier;
   - manual, lifecycle, guardian, error, standard app, and CC/BCC emails do not.
3. Exercise a new manual test email through the live queue and confirm its deduplicated log progresses from `pending` to `sent`, with no new `run_not_found` failure.
4. Confirm the queue drains and the Email Deliverability dashboard shows the final status. Previously dead-lettered emails will remain historical and will not be retried automatically.

## Deployment note

The defect is in the published queue-processing route, so the corrected app must be published before the live email test can succeed. No DNS, sender-domain, database, or cron changes are currently indicated.
