# Semgrep XSS finding: not applicable as written

## What I checked

- The only `dangerouslySetInnerHTML` in the app is in `src/components/ui/chart.tsx`, and it writes a `<style>` block built from chart config values defined in code — no `html` prop, no `<p>` regex replacements, no user input.
- No file in the project contains the flagged transforms (`replace(/<\/p>\s*<p[^>]*>/gi, ...)`) or a component that takes an `html` prop and injects it.

So the specific component Semgrep describes does not exist in this codebase. The finding is not legitimate here — most likely it came from a stale scan, a generated/library file, or another project.

## The one place raw HTML is rendered

The admin email template editor renders a preview:

`src/routes/_authenticated/admin.emails.$name.tsx` — `<iframe srcDoc={personal?.html ?? html} />`

Risk is low: the HTML is produced server-side by `previewEmailTemplate`, which requires an authenticated user with the `admin` role, and the content is React Email output from templates in the repo. The only attacker-controlled slice is the copy overrides an admin types themselves. But the iframe is same-origin and unsandboxed, so a malformed override could run script with access to the admin session.

## Proposed hardening (small, optional)

Add sandboxing to that one iframe so the preview can never touch the app origin:

```tsx
<iframe
  title="Email preview"
  sandbox=""
  srcDoc={personal?.html ?? html}
  className="h-[620px] w-full rounded-md border border-divider bg-white"
/>
```

`sandbox=""` blocks scripts, forms, and same-origin access while still rendering the email's HTML/CSS correctly (email templates carry no scripts by design).

No other code changes, no dependency changes, no database work.

## Security memory

Record that the chart `<style>` injection is code-generated (not user input) and that the admin email preview iframe is admin-gated and sandboxed, so future scans don't re-raise these.
