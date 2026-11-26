/**
 * Where one `/api/v1` request spent its time, sent back as a `Server-Timing`
 * header (and logged when the request was slow).
 *
 * Why: the phone logs how long each call took end to end, but that number
 * mixes the network with the server. With this header the same log line can
 * say "23 s, of which the server had it for 0.8 s", and a `curl -D -` shows
 * the split for any request without access to the host's logs.
 *
 * What the numbers mean: wall-clock milliseconds spent waiting in each phase.
 * On Cloudflare Workers the clock only moves forward across I/O, so these are
 * waits on Supabase (and on the request body arriving), not CPU time. The
 * time a new Worker instance spends loading the app's code before the first
 * request runs is therefore invisible here; `cold` marks the requests that
 * paid it (see `src/server.ts`).
 *
 * Phases: `auth` (token check), `ratelimit`, `body` (reading the request
 * body), `idem` (the idempotency reserve and complete calls), `handler` (the
 * route's own work) and `total`. Only phases that ran are listed. Durations
 * carry no ids, tokens or content.
 *
 * Not sent on public writes (sign-in, sign-up, password recovery): those
 * answer the same whether or not an account exists, and an exact server-side
 * duration for the lookup would make that easier to tell apart than the
 * caller's own stopwatch does. Their slow requests are still logged.
 */
export type TimingPhase = "auth" | "ratelimit" | "body" | "idem" | "handler";

const PHASE_ORDER: TimingPhase[] = ["auth", "ratelimit", "body", "idem", "handler"];

/** A request this slow is written to the server log with its phases. */
export const SLOW_REQUEST_MS = 3000;

export class RequestTimer {
  private readonly now: () => number;
  private readonly startedAt: number;
  private readonly phases = new Map<TimingPhase, number>();

  constructor(now: () => number = Date.now) {
    this.now = now;
    this.startedAt = now();
  }

  /** Runs `fn` and adds how long it took to `phase` (also when it throws). */
  async measure<T>(phase: TimingPhase, fn: () => Promise<T>): Promise<T> {
    const start = this.now();
    try {
      return await fn();
    } finally {
      this.add(phase, this.now() - start);
    }
  }

  add(phase: TimingPhase, milliseconds: number): void {
    this.phases.set(phase, (this.phases.get(phase) ?? 0) + Math.max(0, milliseconds));
  }

  /** Takes back time counted under `phase` that belongs to another one (never below zero). */
  subtract(phase: TimingPhase, milliseconds: number): void {
    if (!this.phases.has(phase)) return;
    this.phases.set(phase, Math.max(0, this.get(phase) - Math.max(0, milliseconds)));
  }

  get(phase: TimingPhase): number {
    return this.phases.get(phase) ?? 0;
  }

  total(): number {
    return Math.max(0, this.now() - this.startedAt);
  }

  /** Every phase that ran plus the total, in whole milliseconds. */
  snapshot(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const phase of PHASE_ORDER) {
      if (this.phases.has(phase)) out[phase] = Math.round(this.get(phase));
    }
    out.total = Math.round(this.total());
    return out;
  }

  /**
   * `auth;dur=12, handler;dur=230, total;dur=250` (+ `, cold` on a new
   * instance's first requests), from a `snapshot()` so the header and the
   * slow-request log line carry the same numbers.
   */
  static header(snapshot: Record<string, number>, cold: boolean): string {
    const parts = Object.entries(snapshot).map(([name, ms]) => `${name};dur=${ms}`);
    if (cold) parts.push("cold");
    return parts.join(", ");
  }

  header(cold: boolean): string {
    return RequestTimer.header(this.snapshot(), cold);
  }
}
