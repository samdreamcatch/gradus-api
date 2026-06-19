Apply prompt refinements to two AI server functions. Pure prompt/system-message changes; no schema, no data flow, no caching changes.

## 1. `src/lib/pre-lesson-briefing.functions.ts`

- Add a module-level constant `PRE_LESSON_BRIEFING_SYSTEM` (verbatim text from the request) near the top, after imports.
- In the `generateText({ model, prompt })` call at line 288, add `system: PRE_LESSON_BRIEFING_SYSTEM`.
- Replace the single-paragraph instruction line at line 281 (`Write a terse pre-lesson briefing for the coach: …`) with the new multi-rule instruction block from the request (lead-with-signal, sparse-data, no-fabrication, no-coaching-advice, second-person rules). Keep the surrounding `${PROMPT_INJECTION_GUARD}` header and the `${context_lines.filter(Boolean).join("\n")}` data block exactly as they are.

## 2. `src/lib/coach-athlete-detail.functions.ts`

- Add a module-level constant `ATHLETE_SUMMARY_SYSTEM` (verbatim text from the request) near the top, after imports.
- In the `generateObject({ model, schema, prompt })` call at line 424, add `system: ATHLETE_SUMMARY_SYSTEM`.
- Replace the trailing instruction block (lines 404–411, from `Write a 2-3 sentence summary…` through `Provide a single-sentence rationale tied to specific evidence above.`) with the new instruction block from the request: the stricter summary instructions, the expanded verdict rules requiring citable evidence, and the rationale-must-cite / default-to-hold fallback. Keep the `${safeName}` interpolation, keep the closing backtick, and leave the Zod `schema` and all data sections (`PLANS`, `PRACTICE LOGS`, `MESSAGES …`) untouched.

## Out of scope

No changes to: caching (`pre_lesson_briefings` table, `source_hash`), the Zod output schema, model selection, sanitization (`sanitizeUserContent`, `wrapUntrusted`, `PROMPT_INJECTION_GUARD`), DB queries, or the markdown catalog at `/mnt/documents/ai-prompts-catalog.md` (we can regenerate that separately if you want it kept in sync).