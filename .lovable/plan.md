# Admin sidebar + scaffolded sections

## Sidebar shell

- Rewrite `src/routes/_authenticated/admin.tsx` to render a shadcn `Sidebar` (`collapsible="icon"`) inside a `SidebarProvider`. Main column has a slim top bar with `SidebarTrigger`, "Internal / Admin" eyebrow+title, `test` toggle pill, and Sign out. `<Outlet />` fills the rest.
- New `src/components/admin/admin-sidebar.tsx`: grouped `SidebarMenu` with active-route highlighting via `useRouterState` pathname. Preserve `?test=` on all links via helper.

## Groups & items

```text
Membership
  ├─ Users              → /admin                (existing search + lookup)
  ├─ Connection map     → /admin/map
  ├─ Promo codes        → /admin/promo-codes
  ├─ Waitlist & leads   → /admin/leads          (NEW stub)
  └─ Impersonation      → /admin/impersonation  (NEW stub)

Reporting
  ├─ Overview           → /admin/reporting      (NEW — move DAU + ReportingPanel here)
  └─ Activity log       → /admin/activity       (NEW stub)

Organizations
  └─ Organizations & codes → /admin/organizations

Revenue
  └─ Billing            → /admin/billing        (NEW stub)

Support
  ├─ Feedback           → /admin/feedback
  ├─ Errors             → /admin/errors
  ├─ Email deliverability → /admin/email-health (NEW stub)
  └─ Announcements      → /admin/announcements  (NEW stub)
```

Icons (lucide): Users, Network, Ticket, UserPlus, UserCheck, BarChart3, History, Building2, CreditCard, MessageSquare, AlertTriangle, MailCheck, Megaphone.

## Route changes

- **Split `/admin`**: keep user search/lookup on `/admin` (Membership > Users). Create `src/routes/_authenticated/admin.reporting.tsx` and move `ReportingPanel` + `DauChart` into it. `admin.index.tsx` becomes just the lookup.
- **New stub routes** (each is a placeholder page: sticky heading, `Eyebrow` "Coming soon", short description of what will live there — no server fns, no DB reads yet):
  - `admin.leads.tsx` — combines `parent_profiles.beta` count + `organization_leads` table (read-only list later)
  - `admin.impersonation.tsx` — describes the read-only "view as user" flow
  - `admin.activity.tsx` — audit log timeline placeholder
  - `admin.billing.tsx` — Stripe MRR / active subscriptions / failed payments placeholder
  - `admin.email-health.tsx` — bounces/suppressions/recent sends placeholder (data source: `email_send_log`, `suppressed_emails`)
  - `admin.announcements.tsx` — system banner CRUD placeholder

## Removals

- Delete `src/routes/_authenticated/admin.emails.tsx` (email copy editor).
- Leave `src/lib/email-admin.functions.ts`, `src/lib/email-preview.functions.ts`, `email_template_overrides`/`email_template_override_history` tables untouched — no other UI references. User said they'll edit copy in code.

## Out of scope this turn

- No real data wiring for the 6 stub pages — just routed shells with placeholder copy so the sidebar links resolve. Each becomes its own follow-up.
- No DB migrations.
- No changes to `admin.list.$kind.tsx` or `admin.users.$userId.tsx` — they remain reachable via the Users page's existing links.
