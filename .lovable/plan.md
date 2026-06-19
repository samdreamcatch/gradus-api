## Upload 8 wrestling resources to the library

The 10 uploads include two duplicates (the `(1).pdf` files are copies of the same titles). I'll upload one of each — 8 unique PDFs — under `sport='wrestling'`.

### Files & ordering

| # | Title | storage_path |
|---|---|---|
| 10 | Folkstyle vs. Freestyle vs. Greco-Roman: The Three Styles Explained | wrestling/styles-explained.pdf |
| 20 | The Stance and Motion: Why Posture Is Everything in Wrestling | wrestling/stance-and-motion.pdf |
| 30 | Level Changes and Penetration Steps: The Foundation of Takedowns | wrestling/level-changes-penetration.pdf |
| 40 | Takedowns: What They Are and Why They're Valued | wrestling/takedowns.pdf |
| 50 | Pins, Technical Falls, and Decisions: How Matches End | wrestling/pins-tech-falls-decisions.pdf |
| 60 | Weight Classes: How They Work and Why They Exist | wrestling/weight-classes.pdf |
| 70 | Weight Management: What Parents Need to Know | wrestling/weight-management.pdf |
| 80 | Drilling vs. Live Wrestling: The Two Modes of Practice | wrestling/drilling-vs-live.pdf |

### Steps
1. Upload each PDF to the `resource-pdfs` Storage bucket at the path above (using `supabase--storage_upload`).
2. Insert 8 rows into `public.resources` with `sport='wrestling'`, `published=true`, the title, storage_path, and `display_order` shown above. Description left blank (matches existing rows).

No code changes — wrestling is already in `coach-sports.ts` and the library page is sport-agnostic.