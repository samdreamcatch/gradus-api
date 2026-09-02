# Competition scores as coaching data

Today the Live Board is a viewer: each competition keeps one snapshot blob that is
overwritten on every refresh, and "following" a skater lives only in the browser.
Nothing in the database says a skater on the board is a Gradus athlete, and no
score survives the next refresh.

To later generate practice plans from an athlete's scores, two things must exist
first: a **claim** that ties a board skater to an athlete, and a **durable score
history** written for claimed athletes only.

## Claiming is an existing-relationship action, not a following action

Following is public and anonymous — anyone at the rink can follow any skater, and
that stays true. Claiming is different and is gated on a relationship Gradus already
knows about:

- The claim starts **from the athlete, not from the board**. The person picks one of
  their own athletes and attaches a skater to it. Nobody types in a stranger's name.
- The list of athletes they can pick from is built server-side from the existing
  access rules: a coach sees only rostered athletes, a parent or guardian only their
  own, an athlete only themselves. A follower with no relationship sees no claim
  option at all — the control never renders and the server rejects the call.
- Nothing about a claim is public. It does not appear on the board, and it does not
  reveal that a skater has a Gradus account.

That means a claim can never create a new link between a person and a minor. It can
only annotate a link that already exists and was already vetted by the invite,
guardian, and roster flows.

## What gets built

1. **Claim a skater from an athlete.** On the athlete's page (and, for a viewer who
   already has access, from the board), "link this athlete to a competition skater"
   shows likely matches in the current event and stores the confirmed link.
2. **Score history for claimed athletes.** Every snapshot refresh writes durable rows
   for claimed skaters only — placement, segment scores, and the full judged protocol
   (elements, base value, GOE, program components, deductions). Unclaimed skaters
   stay in the ephemeral snapshot exactly as now.
3. **A scores view on the athlete.** Coaches see a per-athlete competition history
   with element-level detail. This is the surface a future plan generator reads from.

Plan generation itself is not in this phase — but once these rows exist, it is
ordinary work against the plans and moves tables we already have.
