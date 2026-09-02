# Competition scores as coaching data

Today the Live Board is a viewer: each competition keeps one snapshot blob that is
overwritten on every refresh, and "following" a skater lives only in the browser.
Nothing in the database says a skater on the board is a Gradus athlete, and no
score survives the next refresh.

To later generate practice plans from an athlete's scores, two things must exist
first: a **claim** that ties a board skater to an athlete, and a **durable score
history** written for claimed athletes only.

## What gets built

1. **Claim a skater.** On the board, a coach, parent, or athlete sees "Is this your
   skater?" next to a name that plausibly matches an athlete they already have
   access to. They confirm, and the link is stored. Anyone with write access to that
   athlete can unlink it later.
2. **Score history for claimed athletes.** Every snapshot refresh writes durable rows
   for claimed skaters only — placement, segment scores, and the full judged protocol
   (elements, base value, GOE, program components, deductions). Unclaimed skaters
   stay in the ephemeral snapshot exactly as now.
3. **A scores view on the athlete.** Coaches see a per-athlete competition history
   with element-level detail. This is the surface a future plan generator reads from.

Plan generation itself is not in this phase — but once these rows exist, it is
ordinary work against the plans and moves tables we already have.
