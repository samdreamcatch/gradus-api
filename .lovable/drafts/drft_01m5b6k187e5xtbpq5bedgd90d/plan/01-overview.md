# Gradus Club

Rebuild the organization-admin experience around **practice, development, and protection**, retaining the existing club content, invite flows and Gradus components.

**Your latest direction takes precedence:** support **light and dark mode**, and treat the forthcoming PDF mockups as design direction rather than literal layouts. Keep ruled paper, recognizable Gradus typography, desktop-friendly tables, and no explainer subheadings.

## Shared experience
- One panel for every authorized club admin, including admins without a coach account or coach seat.
- Navigation: **Home · Notifications · Coaches · People · Library · Schedule · Storefront · Settings**. Club name in the sidebar; unread count on Notifications.
- Tables with gridlines, shaded headers, zebra rows, mono numeric columns and totals where meaningful. Default to eight columns or fewer; additional columns through Columns.
- Quick search, visible filter toggles with counts, removable filter chips, Clear, per-admin saved views and CSV export on each data page.
- A shared status dot and legend: healthy/done, attention, critical/in-review, informational. Accent used sparingly; attention wash only where warranted.
- Nominal 38px data rows, with 44px interactive targets even when action rows need more height. Validate contrast rather than assuming tokens meet AAA.
- Home and Coaches receive aggregate-only data: **no athlete names or IDs in responses or DOM**. Identifiable safeguarding facts are restricted to Notifications; People members remain group rollups.

## Preserve and replace
Preserve org-admin authorization, club sports/resource/move/level tables, existing Moves, Template plans and Levels, and coach invite paths. Replace the current overview, roster, resource presentation, settings and sidebar. Integrate existing policy functionality into Library without losing prior signatures.

The existing People page is coach-only; the new People directory adds staff roles and seat management, with members presented as groups. Coaches becomes a separate analytics page with full profile pages, not detail sheets.