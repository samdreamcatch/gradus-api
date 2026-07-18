## Coach Pro: upload resources for their roster

Add a Resources tab to the coach bottom nav. All coaches see the same parent/athlete-facing library UI as a preview; Coach Pro and Club coaches can additionally upload PDFs, images, or external links tagged to one or more of the sports they coach. A coach's uploads are only visible to parents/athletes on that coach's roster (plus any other coaches sharing those athletes, so it looks consistent in the parent's Library).

### Behavior

- **Coach nav**: new "Resources" tab (BookOpen icon) at `/coach/resources`, placed between Plans and Messages.
- **Free Coach tier**: sees the same three-tab layout parents/athletes see (Library / Ask Gradus / Saved), scoped to the sports they coach. An "Upload" row at the top of the Library shows a lock icon + "PRO & CLUB" pill (same treatment as `also-coached-by-list`). Tapping it opens a small explainer sheet with an upgrade CTA.
- **Coach Pro & Club**: same layout, but the top of the Library shows an active "Upload resource" button. Opens a bottom sheet:
  - Type: PDF file / Image / Link
  - Title (required), short description (optional)
  - Sport tags: multi-select constrained to their `coach_levels` sports
  - File picker (PDF or jpg/png/webp, ≤20MB) OR URL field (validated `https://` only)
  - Save → resource appears immediately in their preview and in every connected parent/athlete's Library under the tagged sports.
- **Manage own uploads**: each row a coach owns shows an overflow with Edit and Delete. No admin overrides in this cut.
- **Parent/athlete Library**: unchanged UI; a new "From your coaches" section appears above the existing sport-scoped library when at least one coach upload exists for the current sport. Existing global rows remain in the "General" section below.
- **Empty states**: coach preview with no roster or no sports shows the existing "add an athlete / add a sport" empty state; upload button stays enabled but the save flow requires at least one tagged sport that the coach teaches.

### Technical

**Schema (single migration):**

```text
resources
├── + coach_id uuid null references coach_profiles(id) on delete cascade
├── + kind text not null default 'pdf' check (kind in ('pdf','image','link'))
├── + external_url text null              -- required when kind='link'
├── storage_path made nullable            -- null when kind='link'
├── + updated_by uuid null                -- audit
└── check: (kind='link' AND external_url IS NOT NULL AND storage_path IS NULL)
        OR (kind IN ('pdf','image') AND storage_path IS NOT NULL AND external_url IS NULL)

resource_sports (new)                     -- multi-sport tagging replaces single `sport` for coach uploads
├── resource_id uuid references resources on delete cascade
├── sport text not null
└── primary key (resource_id, sport)
```

Backfill: for every existing `resources` row, insert `(id, sport)` into `resource_sports`. Keep `resources.sport` for now as the row's canonical primary sport (used by existing global/org rows and by the trigger check when `coach_id IS NULL`); read paths use `resource_sports` for filtering.

**RLS on `resources`** (add alongside the existing parents-read policy):

- `SELECT` for coaches: `coach_id = <caller's coach_profiles.id>` (their own uploads, drafts included later if we add them).
- `SELECT` for parents: extend existing `parent_has_athlete_in_sport(sport)` — new predicate `parent_has_coach_upload(resource_id)` that returns true when the resource has `coach_id` and the parent has an athlete rostered under that coach with a sport in `resource_sports` for the resource. Combined policy: `(published AND is_org_or_global AND parent_has_athlete_in_sport(sport)) OR parent_has_coach_upload(resource_id)`.
- `SELECT` for athletes: mirror predicate `athlete_has_coach_upload(resource_id)` for the athlete's own coaches.
- `INSERT / UPDATE / DELETE` for coaches: `coach_id = caller's coach id` AND `coach_effective_tier(coach_id) IN ('coach_pro','club')`. Enforced via WITH CHECK and a `BEFORE INSERT/UPDATE` trigger that also validates every `resource_sports.sport` is in the coach's `coach_levels`.
- Grants: `SELECT/INSERT/UPDATE/DELETE ON resources TO authenticated`; `SELECT/INSERT/DELETE ON resource_sports TO authenticated`; `ALL TO service_role`.

**Storage**: reuse the existing private `resource-pdfs` bucket. Objects live under `coach/<coach_id>/<uuid>.<ext>`. Add `storage.objects` policies: owner-coach can insert/update/delete under their `coach/<id>/` prefix; signed URLs continue to be issued by `getResourceSignedUrl` (works for any authenticated caller whose `SELECT` on the parent `resources` row is allowed).

**Server functions** (new file `src/lib/coach-resources.functions.ts`):

- `listCoachResources()` — sports the coach teaches + resources they've uploaded (for preview management).
- `createCoachResource({ kind, title, description, sports[], storagePath?, externalUrl? })` — gates on `coach_effective_tier` ∈ Pro/Club.
- `updateCoachResource`, `deleteCoachResource`.
- `createCoachResourceUploadUrl({ ext })` — returns signed upload URL scoped to `coach/<id>/<uuid>.<ext>`.

Extend `parent-resources.functions.ts` and `athlete-resources.functions.ts` to return coach-upload rows alongside global ones, with a `source: 'coach' | 'library'` discriminant so the UI can render the "From your coaches" section.

**Routes / components**:

- `src/routes/_authenticated/coach.resources.index.tsx` — new page. Uses `PageTitle`, `SegmentedToggle`, `FilterBar`, existing `ResourceSheet` pattern from `parent.resources.index.tsx`.
- `src/components/coach/upload-resource-sheet.tsx` — new bottom Sheet with the form (Input, Textarea, native file input styled per system, sport chips).
- `src/components/coach/upload-resource-row.tsx` — the top-of-library row, uses the same locked-pill pattern as `also-coached-by-list.tsx` for free-tier coaches.
- `src/components/coach/bottom-nav.tsx` — add Resources item.
- `src/lib/paywall-flag.ts` gating helper reused for tier check; UI reads `effectiveTier` from the coach profile query.

**Out of scope for this pass**: draft/publish state (uploads go live immediately), reordering, admin overrides, analytics on views. Ask Gradus and Saved tabs are Library-only surfaces here — no coach-authored answers.

### Files touched

New: `coach.resources.index.tsx`, `coach-resources.functions.ts`, `upload-resource-sheet.tsx`, `upload-resource-row.tsx`. Edited: `coach/bottom-nav.tsx`, `parent-resources.functions.ts`, `athlete-resources.functions.ts`, `parent.resources.index.tsx` (add "From your coaches" section), `athlete.resources.index.tsx` (same). One migration for schema + RLS + storage policies.
