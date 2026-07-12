# Emails: poster watermark + admin audit/edit tool

Two pieces of work, shipped together.

---

## Part 1 — Sports poster as a paper watermark

The uploaded multi-sport line-art poster becomes a very subtle "paper" watermark behind the email card. It reinforces the notebook/paper feel of the design system without competing with the copy.

### How it will look

- The poster is uploaded to Lovable Assets (CDN), lightened, and used as a `background-image` on the email `<Container>` (the paper card, not `<Body>` — some clients still strip body backgrounds).
- Opacity target: **~7% in light mode**. The icons should read as ghosted paper texture, not as illustrations.
- Position: `background-repeat: no-repeat; background-position: right -40px top -30px; background-size: 420px auto;` — bleeds off the top-right corner so the icons feel like they wander onto the page, leaving the left column clean for reading.
- The `--pen-tennis` jelly-pen accent (green) stays as the only saturated color; the watermark is monochrome ink.
- The lightened PNG is baked in — no CSS filters (Gmail/Outlook strip `filter:`). Uploaded once, referenced by URL from the shared `_styles.ts`.

### Graceful degradation

- Every major client that ships email in 2026 renders `background-image` on a table/div (Gmail web/iOS/Android, Apple Mail, Outlook 365, Yahoo). Outlook 2016/2019 desktop is the one holdout — those recipients see the plain paper card, which is fine.
- No VML fallback needed; the watermark is decoration, not content.
- Dark mode: Gmail and Apple Mail auto-invert light backgrounds. Because we lock the container to `#F8F9FC` and the watermark is monochrome ink, it stays readable in both.

### Files touched

- New: `src/assets/email-poster-watermark.png.asset.json` (CDN pointer).
- `src/lib/email-templates/_styles.ts` — add `watermarkUrl` const and extend `container` with background-image properties.
- No changes to individual template files.

---

## Part 2 — Admin tool to audit & edit all email copy

An admin-only page where you can see every email the system sends, preview each one live, and edit the copy (subject, preview text, headings, body paragraphs, CTA labels) without a code change. Edits are stored in the database and applied at send time.

### What "editable" means, exactly

Templates keep their layout, styling, and dynamic variables (`{siteName}`, `{recipient}`, `{confirmationUrl}`, etc.) in code. **Only the text strings** are overridable — so a non-technical editor can't accidentally break the HTML.

Each template exposes a fixed set of copy slots. Example for the signup email:
- `preview` — inbox preview line
- `subject` — subject line
- `eyebrow` — the small caps line above the heading
- `heading` — the big serif line
- `body` — main paragraph (supports `{variables}` and `<strong>`)
- `ctaLabel` — button text
- `secondaryHelp` — the "button not working?" line
- `signOff` — the handwritten sign-off
- `footer` — the disclaimer at the bottom

Every template's slots are declared in one file (`src/lib/email-templates/copy-schema.ts`); the admin UI reads that schema and renders the right fields per template automatically.

### The admin page: `/admin/emails`

Sits next to the existing admin routes (`/admin/users`, `/admin/feedback`, etc.). Admin-only via existing `has_role` gate.

Layout, top-to-bottom:

1. **Template list** (left column, ~1/3 width): every email in the system grouped by category — "Auth emails" (6), "Internal alerts" (1: error-alert), and later "App emails" as they're added. Each row shows the display name, the last-edited-by/at, and a small dot indicator if it has overrides vs. defaults.
2. **Editor** (right column, ~2/3 width):
    - **Live preview** at the top — an iframe that re-renders the email HTML as you type (uses the existing `/lovable/email/auth/preview` route, extended to accept override copy).
    - **Copy fields** below, one input per slot with help text explaining what variables are available (e.g. "`{siteName}` — always resolves to Gradus"). Long fields use a textarea.
    - **Save**, **Revert to default**, and **Send test to me** buttons.
    - **History**: last 10 versions with who/when, one-click restore.

### How overrides get applied

- New DB table `email_template_overrides` stores one row per (template_name, slot_key) with the current custom string, plus a `email_template_override_history` audit table.
- When an email is queued for sending, the auth webhook / transactional send route fetches all overrides for that template, merges them over the code defaults, then renders. Missing overrides fall back to whatever's in the `.tsx` file — nothing breaks if the DB is empty.
- Variables like `{recipient}` are always resolved from real send data, never editable.

### Coverage — including future app emails

Right now the system only sends the 6 auth emails and internal error alerts. To make future app/transactional emails (celebration notifications, coach messages, digests, etc.) show up in the same admin tool automatically:

- Run the app-email infrastructure setup (pgmq queues for transactional emails, send log, suppression, unsubscribe tokens).
- Scaffold the transactional email pipeline (registry, send route, preview route, unsubscribe page).
- Every new template added to the registry auto-appears in `/admin/emails` because the admin page reads the registry, not a hard-coded list.

You'll get one placeholder app-email template as part of the scaffold ("Sample notification") to prove the pipeline works end-to-end. Real app emails (celebration digest, invite reminders, etc.) can be added later as separate work.

---

## Testing checklist (dev)

1. **Watermark rendering**: open `/lovable/email/auth/preview` for each of the 6 auth emails, confirm the poster shows subtle in the top-right corner of the card. Send a real test email to a Gmail address and to an Apple Mail address; confirm both render the watermark and neither has color casts.
2. **Copy editor round-trip**: as an admin, edit the signup email's heading + CTA label, save, then trigger a real signup — verify the sent email uses the new copy. Revert to default, trigger again — verify the code default returns.
3. **History**: make three edits, restore the second one from the history list, confirm the current copy matches.
4. **Fallback safety**: manually delete a row from `email_template_overrides` mid-flight; the next send should still work using the code default.
5. **Variables safe**: try entering a broken variable like `{doesNotExist}` in a copy field — the template should render it as literal text, not crash the send.

---

## Technical notes (skip if non-technical)

- Poster upload: `lovable-assets create --file /mnt/user-uploads/Multi-Sport_Line_Art_Icons_Poster-2.png --filename email-poster-watermark.png`. The lightening step (~7% opacity baked in) is done in Python with PIL before upload so no CSS filter is required.
- New tables: `email_template_overrides (template_name text, slot_key text, value text, updated_by uuid, updated_at timestamptz, PRIMARY KEY (template_name, slot_key))` and `email_template_override_history (id uuid, template_name text, slot_key text, value text, changed_by uuid, changed_at timestamptz)`. RLS: `admin` role read/write on both; no `authenticated` or `anon` grants. Loaded at send time via a `requireSupabaseAuth`-free server helper using the publishable client + a narrow admin-only policy (or the admin client inside the webhook handler, which is already server-only).
- Copy schema (`copy-schema.ts`) exports `{ [templateName]: { slots: [{ key, label, kind: 'text'|'textarea', help, allowsHtml?: boolean }], defaults: {...} } }`. Templates import defaults from here (single source of truth) instead of hardcoding strings, so audit view and rendering agree.
- Preview route (`/lovable/email/auth/preview`) extended to accept an optional `overrides` payload so the admin editor shows edits live without saving.
- App-email infra: `email_domain--setup_email_infra` + `email_domain--scaffold_transactional_email`. Adds `/lovable/email/transactional/{send,preview}`, `/email/unsubscribe` API + branded page, registry file, sample template.
- Admin route file: `src/routes/_authenticated/admin.emails.tsx` (list + editor in one page, template selection via search param `?t=signup`).
