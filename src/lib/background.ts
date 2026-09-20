/**
 * Best-effort side effects that must not delay or fail the response
 * (push notifications, PRD §4.1 rule 7).
 *
 * Cloudflare Workers keep a request alive after the response only for
 * promises handed to `ctx.waitUntil`. `src/server.ts` receives that `ctx`
 * but TanStack never exposes it to route code, so the Worker entry runs the
 * request inside an AsyncLocalStorage scope that carries `waitUntil`, and
 * `inBackground` picks it up from wherever it is called. Outside a Worker
 * (tests, `bun run dev`) there is no `waitUntil`, and the task is awaited
 * inline instead — same result, just not deferred.
 */
type WaitUntil = (promise: Promise<unknown>) => void;
type RequestScope = { waitUntil: WaitUntil | null };

type Storage = {
  run<T>(store: RequestScope, fn: () => T): T;
  getStore(): RequestScope | undefined;
};

let storagePromise: Promise<Storage | null> | null = null;

/** `node:async_hooks` is available under `nodejs_compat`; degrade to "no scope" anywhere it is not. */
function storage(): Promise<Storage | null> {
  if (!storagePromise) {
    storagePromise = import("node:async_hooks")
      .then((m) => new m.AsyncLocalStorage<RequestScope>() as Storage)
      .catch((err) => {
        console.error("[background] AsyncLocalStorage unavailable; side effects run inline", err);
        return null;
      });
  }
  return storagePromise;
}

function extractWaitUntil(ctx: unknown): WaitUntil | null {
  if (ctx && typeof ctx === "object" && "waitUntil" in ctx) {
    const fn = (ctx as { waitUntil: unknown }).waitUntil;
    if (typeof fn === "function") return (p) => (fn as WaitUntil).call(ctx, p);
  }
  return null;
}

/** Run `fn` with the Worker's execution context in scope for `inBackground`. */
export async function runWithRequestContext<T>(ctx: unknown, fn: () => Promise<T>): Promise<T> {
  const als = await storage();
  if (!als) return fn();
  return als.run({ waitUntil: extractWaitUntil(ctx) }, fn);
}

/**
 * Run a side effect that must never throw into the caller. Deferred past the
 * response when the runtime offers `waitUntil`; awaited inline otherwise.
 */
export async function inBackground(label: string, task: () => Promise<unknown>): Promise<void> {
  let guarded: Promise<unknown>;
  try {
    guarded = task().catch((err) =>
      console.error(`[background] ${label} failed`, err instanceof Error ? err.message : err),
    );
  } catch (err) {
    console.error(`[background] ${label} threw synchronously`, err);
    return;
  }
  const als = await storage();
  const waitUntil = als?.getStore()?.waitUntil ?? null;
  if (waitUntil) {
    try {
      waitUntil(guarded);
      return;
    } catch (err) {
      console.error(`[background] waitUntil rejected ${label}; awaiting inline`, err);
    }
  }
  await guarded;
}
