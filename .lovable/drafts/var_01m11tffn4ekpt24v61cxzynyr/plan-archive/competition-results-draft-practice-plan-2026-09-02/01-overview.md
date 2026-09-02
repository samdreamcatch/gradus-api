# Competition results → draft practice plan

A coach-initiated flow, available after a competition finishes. It starts from an
athlete the coach already coaches — never from the board, never from a name search.

```text
Athlete page  →  "Link to competition results"  →  likely matches from the board
              →  coach confirms the match       →  scores + protocol saved
              →  "Generate draft plan"          →  editable draft plan
```

## Why this is the safe shape

Following a skater on the board stays public and anonymous. Linking is a different
act and is locked down three ways:

- **Coach-only, and only their own roster.** The entry point lives on the athlete's
  page inside the coach's roster. There is no way to reach it from the board, so a
  spectator following a minor has nothing to click and no endpoint to call.
- **The athlete is chosen before the skater.** The coach picks the athlete they
  already coach; the app then offers matching skater names from that competition.
  A coach can never attach results to an athlete outside their roster — the server
  builds the athlete list from the existing roster link, ignoring anything the client
  sends.
- **Nothing is published.** The link is private to that athlete's existing circle. It
  does not appear on the board and does not reveal that a skater has a Gradus account.

Because a link can only annotate a coach-athlete relationship that already passed
through the invite and guardian flows, it cannot create new access to a minor.

## What gets built

1. **Link to competition results** on the athlete page: shows likely skater matches
   from recent finished competitions, ordered by name similarity, with club and event
   shown so the coach can tell two same-named skaters apart. Confirm to link; unlink
   any time.
2. **Durable score history** for linked athletes only — placement, segment scores, and
   the full judged protocol (elements, base value, GOE, program components,
   deductions). Unlinked skaters stay in the ephemeral board snapshot as they are now.
3. **Generate draft plan**: the coach sends the protocol to the AI plan generator and
   gets an editable draft plan — weak elements become moves, low components become
   focus notes. It lands as a draft the coach reviews and edits before sharing, exactly
   like today's AI-generated plans.

## Availability

Only after the competition's results are final, so the protocol is complete. Live
events show nothing to link.
