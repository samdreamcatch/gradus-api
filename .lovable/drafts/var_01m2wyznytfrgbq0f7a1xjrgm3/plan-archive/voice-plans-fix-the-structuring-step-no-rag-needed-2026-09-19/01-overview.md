# Voice plans: fix the structuring step (no RAG needed)

Short answer: RAG isn't the problem here, and adding a NotebookLM-style retrieval layer wouldn't fix what you're seeing.

I checked the AI request log for the failure in your recording (9:32 this morning). Two AI calls went out five seconds apart — the first attempt and the automatic retry — and **both came back successfully**, with full-length answers. The AI did its job. What failed was our side: the answer didn't match the rigid shape our code demands, so we threw the whole thing away and showed "We couldn't turn that dictation into changes."

That also explains the pattern you describe: transcription is perfect every time, and structuring works sometimes and not others. It's shape validation, not comprehension.

## What's actually going wrong

1. **We ask for structure politely instead of enforcing it.** The request never tells the AI provider "this answer must follow this exact schema." Providers support a strict mode that guarantees the shape; we're not switching it on, so we get well-formed coaching content in a slightly-off wrapper.
2. **Validation is all-or-nothing.** One bad field out of fifty — a stray null, a number where text was expected — discards every move in the dictation. The longer and richer the dictation, the more chances to trip, which is exactly backwards.
3. **Failures are invisible.** When the shape check fails we log a one-line message but not what came back, so we've had no way to see which field keeps breaking.
