# Knowledge corpus: sources and rights ledger

The documents Ask Gradus may answer from (PRD §6.7 "Grounded Ask Gradus", milestone L4). Every row in `knowledge_sources` carries a `rights_basis` and a `quote_allowed` flag; this file is the human-readable record of why each basis was chosen and who confirmed it. **Nothing is ingested without a basis**, and a source whose permission is pending is registered **cite-only**: after ingestion the database keeps its embeddings, section headings and page numbers, and scrubs its text, so an answer can point a reader to the document but never reproduce it.

Rights bases in use:

| Basis | Meaning | Quote allowed |
|---|---|---|
| `coach_upload` | A coach uploaded the PDF for their own athletes; indexed per coach, retrievable only for that coach's athletes and guardians (automatic on upload) | yes |
| `gradus_owned` | Written by Gradus (Safe Sport panel copy, starter programs, guides) | yes |
| `public_domain_us_gov` | A U.S. federal government publication (17 U.S.C. § 105) | yes |
| `written permission <date> (<who>)` | The publisher's written reply granting storage and short quotation with attribution | yes |
| `pending permission: cite-only` | Publicly available but copyrighted; permission requested, not yet granted | no |

## Corpus v0 (what L4 ingests today)

Registered from the admin panel (Content → Knowledge corpus). Mariah's decision 2026-09-20: build L4 on what Gradus already has the rights to, and let the three pending sources drop in when their replies arrive, with no code change.

| Source | Publisher | How to register | Chunker | Basis | Status |
|---|---|---|---|---|---|
| Safe Sport panel copy (hotlines, "what counts") | Gradus | Text source; paste from `src/components/resources/safe-sport-panel.tsx` | prose | `gradus_owned` | to register |
| Coach uploads | each coach | automatic on upload (`createCoachResource`) | prose | `coach_upload` | live |
| HEADS UP to Youth Sports: concussion fact sheets | CDC | Public PDF by URL from cdc.gov | prose | `public_domain_us_gov` | to register (Mariah picks the sheets) |
| Physical Activity Guidelines for Americans, 2nd ed. (youth chapter) | HHS | Public PDF by URL from health.gov | prose | `public_domain_us_gov` | to register |
| Protecting Young Victims from Sexual Abuse and Safe Sport Authorization Act of 2017 (Pub. L. 115-126) | U.S. Congress | Public PDF by URL from congress.gov | rules | `public_domain_us_gov` | to register |
| The six safety PDFs (Abuse in Sports; Appropriate Athlete–Coach Relationships; Barriers to Reporting Abuse in Sports; Power and Control Wheel; Survivor Safety Plan; What to Do: Abuse & Neglect) | The Athlete Survivors' Assist | Library PDF (already at `library/safety/…`) | prose | `pending permission: cite-only` | to register cite-only |
| SafeSport Code; MAAPP | U.S. Center for SafeSport | Public PDF by URL | rules | `pending permission: cite-only` | to register cite-only |
| 2026-27 Rulebook | U.S. Figure Skating | Public PDF by URL (`usfigureskating.org/documents/2026/8/13/2026-27_Rulebook.pdf`) | rules | `pending permission: cite-only` | to register cite-only |

Not yet sourced: USTA *Friend at Court* (tennis), USGA/R&A *Rules of Golf*, and the coaching and athlete-development sources Mariah names (PRD §12 #15). Register them the same way once chosen.

## Pending permissions (PRD §12 #16)

What was found on 2026-09-20, in the publishers' own terms:

- **U.S. Figure Skating.** Site notice "© 2026 U.S. Figure Skating. All Rights Reserved."; the site's terms limit content to personal, non-commercial use and prohibit copying or storing it for any other use without written permission from the copyright holder. *Ask for:* a written license to store the current-season rulebook and quote short passages with attribution inside Gradus, refreshed each August.
- **U.S. Center for SafeSport.** Terms of use address only the disciplinary database ("no commercial use"); silent on the Code, MAAPP and handbooks. *Ask for:* the same, for the Code, MAAPP and the parent and athlete handbooks.
- **The Athlete Survivors' Assist.** Terms grant a license for personal, educational or nonprofit use with attribution and prohibit reproduction or distribution for commercial purposes without express written permission; contact via theathletesurvivorsassist.org/contact. *Ask for:* express written permission for the six documents already in the library and any further material.

When a reply arrives: paste its date and sender into the source's `rights_basis`, set `quote_allowed`, and re-ingest from the admin panel (the text is re-extracted; nothing else changes).

## Operating notes

- Ingestion runs inside the Worker: pg_cron calls `POST /api/public/hooks/knowledge-ingest` every minute, and "Run ingestion now" on the admin page takes the same steps without waiting. A 300-page PDF takes roughly 20 ticks.
- Embeddings go through the Lovable AI Gateway; the model is `KNOWLEDGE_EMBEDDING_MODEL` (default `openai/text-embedding-3-small`, 1536 dimensions). Changing it requires re-ingesting every source; `knowledge_sources.embedding_model` shows which model produced each.
- Quality gate: "Run known-answer set" on the admin page (cases in `src/lib/knowledge-known-answers.ts`). L4 is done when the expected source is in the top 3 for at least 90% of the cases whose source is registered.
- The tables are service-role only. Retrieval for Ask Gradus (L5) runs server-side through `match_knowledge_chunks`.
