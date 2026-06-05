## Plan — `/parent/resources`

Build a Resources tab for parents matching the design system, with sport-filtered PDF library + Ask Gradus AI.

### Note on PDF source
I checked the **Mobile Document Creator** project — it's a PDF *generator* app and its repo only contains fonts (Atkinson, Caveat, JetBrainsMono), no committed PDFs. Generated PDFs there would be ephemeral artifacts. So "copy what's there now" isn't actionable as-is. I'll build the storage + admin upload path now and **you upload PDFs through the app** (or hand me a batch and I'll upload them via the storage tool). Generated PDFs from the Doc Creator can be re-run and dropped in.

---

### 1. Backend — storage + table

**Storage bucket** `resource-pdfs` (private, signed URLs for inline viewing).

**Table `resources`** with columns: `sport` (text), `title`, `description`, `storage_path`, `display_order`, `published` (bool), timestamps. RLS:
- Read: any authenticated parent whose athlete's sport matches `resources.sport`.
- Write: service role only (uploads done via admin path / migration / storage tool for now).

Helper SQL function `parent_has_athlete_in_sport(_sport text)` (security definer) joins `parent_profiles → athletes → coach_athlete_sports` (or `athlete_primary_coaches.sport`) to gate reads.

### 2. Server functions (`src/lib/parent-resources.functions.ts`)
- `getParentResources()` — returns `{ sports: string[], resources: ResourceDTO[] }` filtered to the parent's child sports.
- `getResourceSignedUrl({ resourceId })` — returns a short-lived signed URL after re-checking sport eligibility.

### 3. Route `/parent/resources` (`src/routes/_authenticated/parent.resources.index.tsx`)
Layout, top-to-bottom:
- **Page title** `Resources` (display serif, matches `Plans` / `Messages` headers).
- **Sport filter chips** — reuse `SportFilterChips` from coach side; only shows if parent has >1 sport. Single-sport parents see a static chip.
- **Ask Gradus** section: gradient-bordered card containing `<textarea>` + mic stub + **Ask** button. Streams Gemini answers via `/api/parent-resources/ask` server route using Lovable AI Gateway (`google/gemini-3-flash-preview`), system prompt scoped to the selected sport ("You are Gradus, a coach for {sport}…"). Renders streaming markdown response below the card with a "New question" reset.
- **Sport Library** collapsible section:
  - Search input (filters titles/descriptions client-side).
  - List of `ResourceCard`s (title + 1-line description, rounded-2xl, divider border, paper-card surface).
  - Tap → opens a `Sheet` with embedded `<iframe src={signedUrl}>` for inline PDF view, plus open-in-new-tab fallback.
- Empty states for: parent has no athletes yet, sport has no resources yet.

### 4. Bottom nav wiring
Update `src/components/parent/bottom-nav.tsx` — point the existing Resources item to `/parent/resources` (remove the "coming soon" toast).

### 5. Design system adherence
All surfaces use `bg-card`, sheets use `bg-popover`, dividers `border-divider`, accents via `text-accent`/`bg-accent`. Display serif for the page title, `pen-highlight` for the active state, gradient border on the Ask card built with `bg-gradient-to-br from-secondary-accent via-accent to-attention` wrapping a `bg-popover` inner.

### 6. Out of scope (this pass)
- "Something feel off?" support card (skipped per your answer).
- In-app PDF uploader UI (will add an admin route later; for now I can bulk-upload PDFs you send me).

---

### Technical notes
- Streaming chat uses TanStack server route `src/routes/api/parent-resources.ask.ts` with `streamText` + `toUIMessageStreamResponse`, client uses `useChat` scoped per sport, history kept in component state only (not persisted) for this pass.
- Signed URL TTL: 5 minutes; re-fetched per open.
- Resources table seeded empty; you provide PDFs to upload.
