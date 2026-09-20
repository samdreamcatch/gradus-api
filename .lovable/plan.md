# Add the six safety PDFs to every sport's library

The six uploaded documents become part of the Gradus library so coaches, parents, and athletes see them no matter which sport they're in.

## The documents

- Abuse in Sports
- Appropriate Athlete–Coach Relationships
- Barriers to Reporting Abuse in Sports
- Power and Control Wheel
- Survivor Safety Plan
- What to Do: Abuse & Neglect

## How they'll appear

Each document is stored once and listed under all twelve sports (tennis, golf, figure skating, dance, gymnastics, fencing, equestrian, swimming, track & field, wrestling, skiing, strength & conditioning). Everyone already sees library items for their sports, so nothing changes in the apps' screens — the six new entries just show up in the existing list, each with a short plain-language description of what it's for.

They'll sit at the end of each sport's library list as a small safety group, after the sport-specific material, so a coach opening tennis still lands on tennis coaching material first.

## Technical details

- Upload each PDF once to the private `resource-pdfs` bucket under `library/safety/<slug>.pdf` (viewing already goes through the existing signed-URL path, so no access changes are needed).
- One migration inserting 72 rows into `public.resources` (6 documents × 12 sports) with `coach_id` NULL, `kind = 'pdf'`, `published = true`, the shared `storage_path`, and `display_order` 900–950 so they sort last within each sport.
- Inserts are keyed on `(sport, storage_path)` with a guard so re-running the migration doesn't duplicate rows.
- No schema, RLS, or component changes — this reuses the existing library feed for coaches, parents, and athletes.
