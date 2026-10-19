# Club Trust Center (Phase 1 of the "Vanta for Safe Sport" build)

The plan covers all six areas but builds them in phases. Each phase ships on its own and can be tested as Buddy Garrity (Test Club) before the next one starts. This plan covers **Phase 1: the Trust Center dashboard and the Policy center**. Later phases are listed at the end so the layout leaves room for them now.

## Desktop-first, still Gradus
Org admins will mostly use this on a laptop. The layout follows familiar admin-tool patterns (Vanta, Linear, Stripe dashboard) and keeps Gradus materials:
- **Familiar structure:** a sidebar on the left (it already exists), a page header with actions on the right, a row of key numbers, and a main column with a narrower side column. Tables use sticky headers, sorting, filters and a selected-rows action bar. Clicking a row opens a details panel from the right, like Linear, so the admin keeps their place in the list.
- **Gradus identity:** the paper background, EB Garamond page titles with the highlighter stripe, Atkinson body text, mono for counts and dates, and pen color used only for status and the main action. Small Caveat notes ("3 coaches left") stand in for the coach's-notebook feel.
- **Desktop density:** a new "dense" setting for tables and cards (smaller row height, 13px text), used only in the admin area. The mobile layout still works: columns stack and the side panel becomes a bottom sheet.
- **Status language:** three states everywhere: Ready (pen ink), Needs attention (orange ink), Blocked (pink ink), shown as a tag. Each is labeled with text, so status isn't shown by color alone.

## What Buddy sees

**1. Trust Center (new landing page, `/org-admin`)**
- Header: "Club readiness", the club name, an overall status tag, and an "Export report" button.
- Four key numbers: policy sign-off %, coaches ready, families covered (minors with a linked guardian), and open items.
- **Needs attention list** (main column): one card per issue with a count, a short reason and one button that takes you there. Examples: "4 coaches haven't signed the Safe Sport policy" → Policy center, filtered. "2 coach invites expired" → Roster. "1 club PDF held in review". "6 athletes need a guardian to acknowledge".
- **Side column:** progress by sport (a small bar per sport), then a recent activity feed (sign-offs, invites, document changes, archived items).
- Filters across the page: sport and coach.

**2. Policy center (`/org-admin/policies`)**
- **Policy packs:** group required documents (Safe Sport, Communication, Travel, Photo and video, Medical, Club-specific). A pack holds documents, the people who must sign (coaches, parents, athletes), a due date and an optional yearly renewal.
- **Gradus documents can now be required**, not only club uploads. Each club keeps its own requirement and version history.
- **Sign-off matrix:** people as rows, documents as columns, each cell showing Signed, Due, Overdue, or No account. Filter by role, sport and coach. Select rows and choose Remind.
- **Proof packet:** for one document, export a PDF and CSV with the file, version history, who had to sign, and each signer's name, role and time, plus "signed by guardian for athlete".
- Existing acknowledgement records stay the source of truth. Nothing about how people acknowledge changes for coaches and parents, except they also see due dates.

**3. Sidebar regroup**
Overview (Trust Center) · Safety (Policies, with Communications, Cases, People shown as "Soon") · Roster · Content (Resources, Moves, Levels, Templates) · Settings.
