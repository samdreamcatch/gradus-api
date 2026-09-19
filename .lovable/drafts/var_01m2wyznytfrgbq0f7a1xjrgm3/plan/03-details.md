## What I'd change

**1. Enforce the structure at the source.** Turn on the provider's strict structured-output mode so the shape is guaranteed rather than hoped for, and adjust our field definitions to be compatible with it (every field declared, optional ones declared as "may be empty" rather than "may be absent"). This alone should remove most failures.

**2. Salvage partial results.** Instead of discarding everything when one piece doesn't validate, keep every move that is usable and skip only the broken one. A dictation with six moves where one is malformed should produce five moves, not an error.

**3. Simplify the retry.** The retry currently asks for exactly the same thing that just failed. Make the second attempt request a reduced version — moves, targets and names, without the per-field source quotes that drive most of the complexity — so a long dictation has a genuinely easier second chance.

**4. Make failures diagnosable.** Log the raw answer (truncated) plus the specific validation complaint when the shape check fails, so the next unreliable case can be traced in minutes instead of guessed at.

**5. Honest partial success in the UI.** If the retry also fails, keep today's behaviour (transcript saved on the plan, clear message). If we salvaged some moves, say so — "added 5 moves, one we couldn't read" — rather than a flat success or a flat failure.

## On RAG specifically

There is already a light form of retrieval in the pipeline: the coach's move library is passed into the request so spoken names snap to library entries, backed by five layers of fuzzy, phonetic and edit-distance matching. That part is working — in your recording it correctly produced Layback spin, Sit spin, Camel spin and Backward stroking.

The one place a retrieval upgrade would genuinely help is scale: we currently pass only the first 150 library moves, names and categories only. If a coach's library grows past that, or we want richer sport knowledge in the prompt, selecting the most relevant entries per dictation becomes worth doing. That's a follow-on, not the fix for this bug, and I'd only do it after confirming the reliability problem is gone.

## Verification

Run the dictation from your recording through the pipeline directly on the server, check the AI request log for the attempt, and confirm moves come back structured. Repeat with two or three long multi-move dictations, since length is where it currently breaks. No database changes are involved.
