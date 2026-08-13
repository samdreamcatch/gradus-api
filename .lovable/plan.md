# Make guardian emails editable in the admin panel

## What's happening

The Email copy admin page lists exactly what's in the copy schema, and today that schema only contains the six auth emails (signup, invite, magic link, recovery, email change, reauthentication). The two parent/guardian emails — the guardian invite and the guardian message copy — exist as templates with their wording hardcoded in the component, so they never show up in the list and can't be edited.

## What to build

Bring the guardian emails into the same editable system as the auth emails.

1. Add two entries to the copy schema under a new "App" grouping:
   - **Guardian invite** — "You've been listed as [athlete]'s parent" email with the claim link.
   - **Guardian message copy** — the mirrored message sent to a guardian who hasn't made an account yet.
   Each gets the same slot set the auth emails use where it applies: inbox preview, subject, eyebrow, headline, intro paragraph, secondary paragraph, button label, fallback-link help, sign-off, footer. The guardian invite's intro has two variants (coach added them vs. athlete joined on their own), so both are separate editable slots.
2. Rewrite the two template components to read their wording from the schema (defaults + saved overrides) instead of inline strings, using the same helpers the auth templates use — no visual change to the emails.
3. Wire overrides into the actual send path so edits made in admin show up in real sends, not just the preview.
4. Add sample data for both templates so the live preview in the editor renders.

## Variables available to editors

- Guardian invite: athlete name, coach name, claim URL, site URL.
- Guardian message copy: athlete name, sender name, sender role, message body, claim URL, site URL.
These render as chips in the editor, same as the auth emails.

## Not in scope

The internal error-digest / error-alert emails stay hardcoded — they're operational, not customer copy. Say the word if you want those editable too.

## Technical notes

- `src/lib/email-templates/copy-schema.ts`: add `guardian-invite` and `guardian-activity` entries with `category: "App"`.
- `guardian-invite.tsx` / `guardian-activity.tsx`: accept `copyOverrides`, use `resolveCopy` + `renderTemplateString`.
- `src/routes/lovable/email/transactional/send.ts`: call `fetchOverridesFor(templateName)` and pass `copyOverrides` into the rendered component, plus `resolveSubject` for the subject line.
- `src/lib/email-templates/render.server.ts`: register both templates and their sample props so `/admin/emails/:name` preview works.
- No database or migration changes — `email_template_overrides` is keyed by template name and already accepts these.
