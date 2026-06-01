Shrink the vertical height of the session-timer component (both idle "Start session" slide and the running pill / End-session slide).

**Changes in `src/routes/_authenticated/athlete.plans.$planId.tsx`:**

1. **IdleSlide track** (line 388) — tighten padding so the track hugs the knob:
   ```diff
   - className="relative overflow-hidden rounded-full border border-accent/40 bg-accent/15 p-1.5"
   + className="relative overflow-hidden rounded-full border border-accent/40 bg-accent/15 p-1"
   ```

2. **IdleSlide knob** (line 424) — drop knob height from `h-10` to `h-8`:
   ```diff
   - "relative z-10 inline-flex h-10 select-none items-center gap-2 rounded-full bg-accent pl-4 pr-5 text-sm font-bold text-accent-foreground shadow-sm",
   + "relative z-10 inline-flex h-8 select-none items-center gap-2 rounded-full bg-accent pl-3 pr-4 text-sm font-bold text-accent-foreground shadow-sm",
   ```

3. **RunningPill pause/resume button** (line 476) — match new height:
   ```diff
   - className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-attention/15 text-attention-ink ring-1 ring-attention/40"
   + className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-attention/15 text-attention-ink ring-1 ring-attention/40"
   ```

4. **RunningPill End-session track** (line 484) — tighter padding:
   ```diff
   - className="relative flex-1 overflow-hidden rounded-full border border-attention/50 bg-attention/15 p-1.5"
   + className="relative flex-1 overflow-hidden rounded-full border border-attention/50 bg-attention/15 p-1"
   ```

5. **RunningPill End-session knob** (line 520) — `h-10` → `h-8`:
   ```diff
   - "relative z-10 inline-flex h-10 select-none items-center gap-2 rounded-full bg-attention pl-3 pr-4 text-sm font-bold text-attention-foreground shadow-sm",
   + "relative z-10 inline-flex h-8 select-none items-center gap-2 rounded-full bg-attention pl-3 pr-4 text-sm font-bold text-attention-foreground shadow-sm",
   ```

Width is left unchanged. Total height drops by ~12px in both states. If you want it even shorter (e.g. `h-7` knob + `p-0.5` track), say the word.