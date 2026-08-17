# Automatic welcome + activation emails

Two new emails, both sent automatically and exactly once per person, both editable later in Admin → Support → Email copy, both using the existing Gradus letterhead (wordmark, brand colors, handwritten sign-off).

## Email 1 — Welcome (on signup, every role)

Short. Welcome to Gradus, your next step is getting connected — with a coach, a parent, or an athlete depending on who you are — head to Settings to start. Button to Settings. Signed "— Alyson & Mariah, Gradus co-founders."

Fires for every new account regardless of how they signed up (coach, parent, athlete, adult athlete, Google).

## Email 2 — Activation (on first connection)

Sent once, the first time a person completes a connection. Three role versions — parent, coach, adult athlete — each a one-line intro followed by a clean bulleted list of the copy you supplied, so it skims well. Same letterhead and sign-off.

- **Parent:** finish connecting in Settings, align on goals, log practice sessions by swiping a plan, swipe to end and log feedback, add lesson times, keep connecting (multi-coach / multi-sport, plus the club-plan visibility note).
- **Coach:** create your first plan (voice or manual search, include your lesson cues), create custom moves via Add Moves → Add New, watch practice summaries roll in, check parent goals, invoice from lesson times.
- **Adult athlete:** the parent list rewritten in first person, as you wrote it.

## How the triggers work (so nothing is missed and nothing double-sends)

Signups and connections happen through many different code paths today (coach roster, invite codes, athlete signup, adult athlete invite, parent signup, Google OAuth). Wiring a send call into each one would guarantee gaps as new paths get added, so the triggers live in the database instead:

- A small `lifecycle_email_jobs` table with a unique constraint on (user, email kind). "Send once, ever" is enforced by the database, not by remembering to check.
- Database triggers enqueue a job row: profile creation (coach / parent / athlete-with-login) enqueues a `welcome` job; a new coach–athlete link or a new parent–athlete link enqueues an `activation` job for each real person involved. Duplicates are dropped by the unique constraint, so "first connection" needs no extra bookkeeping.
- A worker endpoint runs on the existing email cron, picks up pending jobs, resolves each person's role, name, and email, renders the right template, and hands it to the existing email queue (same retries, suppression, logging, and unsubscribe handling as guardian emails).

Test/dev accounts (`is_test`) and athletes with no login of their own are skipped.

## Technical notes

- New templates in `src/lib/email-templates/`: `welcome.tsx` and `activation.tsx` (role-variant), built on `_layout.tsx` / `_styles.ts`, registered in `registry.ts`.
- Copy for both added to `copy-schema.ts`, so every line — subject, heading, each bullet, sign-off — is editable in `/admin/emails` with live preview, per-field revert, and history, and previews wired into `render.server.ts`.
- New migration: `lifecycle_email_jobs` (with GRANTs + RLS, service-role write, admin read), trigger functions on `coach_profiles`, `parent_profiles`, `athletes`, and `coach_athletes`, and a pg_cron entry pointing at the worker route.
- New route `src/routes/api/public/hooks/lifecycle-emails.ts`, verifying the caller key exactly like the existing error-digest hook, and enqueuing through `enqueue_email` + `email_send_log` exactly like `guardian.server.ts`.
- Backfill: existing users are not emailed. Jobs only exist for events after this ships.

## Open choice

Welcome and activation can land within a minute of each other for someone who signs up via an invite link and connects immediately. Default behavior in this plan: both still send, welcome first. Say the word if you'd rather suppress the welcome when a connection happens in the same session.
