# Gradus data retention policy

**Status:** draft for publication, written 2026-10-03 from decisions #41–#43 (Mariah, 2026-10-03). Section A is the public text, to be published inside the privacy policy's "Data Retention" section (the amended COPPA Rule, 16 CFR 312.10, requires the written children's data retention policy to appear in the online notice). Section B records what the code enforces and what is still owed, and is not for publication. Counsel may edit the words; the windows are the product's.

**Owner:** Mariah Gillespie. **Review:** every November 1, with the information security program.

---

## A. Public text (for the privacy policy, "Data Retention")

We keep personal information only as long as it is needed for the purpose it was collected for, and never indefinitely. The table says how long, and why, for each kind of information. "Life of the account" means until the account is deleted by its owner, by a parent, or under the inactivity rule below.

| What we keep | Why we keep it | How long |
|---|---|---|
| Account identifiers: name, email address, date of birth, username, role | To run the account and tell its owner apart from everyone else | Life of the account |
| Athlete accounts under 18 with no activity | None once nobody uses the account | Deleted after **3 years** in which nobody signed in, logged practice, exchanged a message, or coached the athlete in Gradus, **30 days after we email every parent or guardian on file**. Any activity cancels the deletion. Accounts with no birthdate on file are not covered by this rule |
| Provisional athlete accounts (ages 13–17 who signed up themselves) that no parent or guardian has confirmed, and the parent or guardian contact details they entered | To let the parent confirm the account | Deleted **3 months** after the account was created |
| Messages between athletes, parents and coaches, including coaches' voice notes and their transcripts | They are the coaching conversation the account exists for | Life of the athlete account; voice recordings are removed from storage when the account is deleted. Athletes under 18 cannot send voice recordings |
| Practice logs, goals, assigned plans and session feedback | They are the training record the service provides | Life of the athlete account |
| A parent's adult-verification result: when it happened, which provider confirmed it, and the provider's transaction reference. Never card or Social Security details, which Kids Web Services handles on its own pages | To show that the adult behind a minor's account was verified, as the law requires | Life of the parent account |
| The consent record for each athlete under 18: which parent consented, to what, when, and when consent was withdrawn | To show that consent was obtained | Life of the athlete account |
| Receipts of verification and App Store notifications (transaction identifiers and status only, no names or emails) | To process each notification once and to audit that it arrived | **5 years** |
| A record that an account was deleted (an internal identifier, the role, a one-way hash of the email, the date) | To show that a deletion request was honored | **5 years** |
| In-app usage events (which screens are used and for how long). For athletes under 18 these carry no identifier and are reported only in groups of ten or more | To understand which parts of Gradus are used | Raw events **13 months**; afterwards only weekly totals, which identify no one |
| Coaches' own practice plans and custom moves after a coach deletes their account | Athletes who were assigned them can still see their own training history | Kept with the coach's name and email removed |
| Email delivery records (recipient address, template, delivery status) | To diagnose delivery problems and prove what was sent | **13 months** |
| Safety reports sent to Gradus about a conversation or a user | To act on them and to cooperate with investigations | **7 years** from the report |
| Other support correspondence | To resolve the question and look back if it recurs | **3 years** |
| Billing records for coaches' subscriptions | Tax and accounting law | **7 years**, held by our payment processor and in our accounts |

Anyone can delete their account in Settings → Account & security, in the app or at gradus.training; a parent can delete an athlete's account from Settings → My athletes. Deletion removes personal information promptly, keeping only the entries this table says survive it.

---

## B. Enforcement map (internal)

What the code does today, and what each row of Section A relies on.

| Row | Enforced by | Status |
|---|---|---|
| Dormant under-18 accounts, 3 years + 30-day notice | `sweepDormantMinorAthletes` in `src/lib/retention.server.ts`, daily from `/api/public/hooks/consent-retention`; the `retention-notice` email | **Built 2026-10-03, reworked after review 2026-10-04** (web PR #179). Activity = creation; practice sessions; messages in the athlete's rooms; goal edits; competition attendance and results; the coach's wrap-ups, briefings, invoices and skill events; app-transaction and device check-ins; any guardian's `last_seen_at`; any guardian's or the athlete's auth sign-in. Deletion runs 31 days after the notice (one day of grace so the emailed UTC date holds in US time zones). A failed lookup or send fails the row for retry; nobody-to-notify leaves the account alone and is counted (`unnotifiable`) for an admin. Only accounts whose birthdate makes them under 18 are in scope; no-birthdate accounts and adults are not (§12 #34). Candidates rotate least-recently-checked first (`retention_checked_at`) under a 20 s budget; both stamps are server-only (trigger). Every deletion leaves a `deleted_accounts` row, login or not |
| Provisional accounts, 3 months | `sweepProvisionalAthletes` (S1) | Live since 2026-09-25 |
| Messages, logs, goals, plans: life of the account | `purgeAthlete` / `deleteAccountForUser` cascade; voice files removed from the `voice-notes` bucket | Live |
| Parent verification result: life of the parent account | Columns on `parent_profiles`; deleted with the row | Live |
| Consent ledger: life of the athlete account | `guardian_consents.athlete_id ON DELETE CASCADE`; parent deletion revokes and keeps the row | Live |
| Receipts and tombstones, 5 years | `purgeExpiredRecords` in `retention.server.ts` | **Built 2026-10-03** |
| Usage events, 13 months | A2's pg_cron job on `analytics_events`; on account deletion the row's `user_id` is cleared (FK `ON DELETE SET NULL`, migration `20261004120000`), so a deleted adult's events survive only as de-identified counts | Live (A2); FK **built 2026-10-04** |
| Usage events of an account that withdrew consent: deleted at once | `setAnalyticsOptOut` in `src/lib/analytics.server.ts` → `analytics_withdraw_consent` (one transaction: request row, then the delete; returns the count), from the admin user page's Usage data card; `analytics_opt_outs` makes the events endpoint discard the account's later batches | **Built 2026-10-04** (decision #46). Minor athletes' events carry no user id, so for them it stops future collection only |
| Coach content de-identified after coach deletion | `deleteAccountForUser` | Live |
| Email delivery records, 13 months | `purgeEmailSendLog` in `src/lib/retention.server.ts`, daily from `/api/public/hooks/consent-retention` (oldest first, in batches, stops at a time budget and resumes the next day) | **Built 2026-10-05.** Live once published; the first run may take several days on a large backlog |
| Safety reports 7 years, support mail 3 years | Google Workspace mailbox retention for support@gradussports.com; reports also exist as admin emails | **Mailbox setting, not code.** Set a Vault/retention rule or an annual manual review; nothing in the database stores a report |
| Billing records, 7 years | Stripe's own retention plus accounting records | Provider-side |

Windows are constants: `DORMANT_MONTHS`, `DORMANT_NOTICE_DAYS`, `RECORD_RETENTION_YEARS`, `EMAIL_LOG_RETENTION_MONTHS` in `retention.server.ts`; `provisionalCutoff` in `guardian-verification.server.ts`. Change the constant and this document together.

### Handling a usage-data withdrawal request (by hand)

The privacy policy (§2.4, §8) tells people to email support@gradussports.com to withdraw consent to usage-data collection; there is no in-app switch (decision #46).

1. Confirm the request comes from the email address on the account (reply from the same thread is enough; for an athlete under 18, a verified guardian on the account may ask on their behalf).
2. Admin → Users → open the account → **Usage data** → enter where the request came from (for example `email 2026-10-04`, never the message text) → **Stop collecting**. This records the withdrawal and deletes the account's stored usage events; the app's later batches are discarded on arrival.
3. Reply that collection has stopped and the stored usage records were deleted. Keep the thread under the support-mail retention row above.
4. If the person later asks to resume, **Resume collecting** on the same card.

### Why these numbers

- **3 years dormant.** The rule says "not indefinitely" and "only as long as reasonably necessary." One to two years is the common inactive-account window for children's services; three covers a season off, an injury, or a sport switch and still ends. Ten years was considered and declined on 2026-10-03: an account untouched for a decade has no live purpose, and its owner is an adult by then.
- **30-day notice.** Long enough for a family to see the email and act; short enough that the decision is not forgotten.
- **5 years for receipts and tombstones.** Matches the federal limitations period for civil penalties (28 U.S.C. § 2462), the window in which Gradus might need to show that a consent was obtained or a deletion honored.
- **7 years for safety reports.** Youth-sport organizations and SafeSport-aligned bodies keep misconduct reports for extended periods because child-abuse limitation periods are long or open-ended in many states. Seven years is the common floor; a report under investigation is kept until the matter closes.
- **3 years for support mail, 13 months for delivery records.** Enough to see a repeat problem across a full season cycle, then gone.
