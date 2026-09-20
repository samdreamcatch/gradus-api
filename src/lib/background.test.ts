import { describe, expect, it } from "bun:test";
import { inBackground, runWithRequestContext } from "./background";

describe("inBackground", () => {
  it("hands the task to waitUntil when the request scope has one, without awaiting it", async () => {
    const handed: Promise<unknown>[] = [];
    let finished = false;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ctx = { waitUntil: (p: Promise<unknown>) => handed.push(p) };

    await runWithRequestContext(ctx, async () => {
      await inBackground("test", async () => {
        await gate;
        finished = true;
      });
      // Returned before the task finished: it was deferred, not awaited.
      expect(finished).toBe(false);
      expect(handed).toHaveLength(1);
    });

    release();
    await handed[0];
    expect(finished).toBe(true);
  });

  it("awaits the task inline when there is no waitUntil (tests, bun run dev)", async () => {
    let finished = false;
    await runWithRequestContext(undefined, async () => {
      await inBackground("test", async () => {
        await new Promise((r) => setTimeout(r, 5));
        finished = true;
      });
      expect(finished).toBe(true);
    });
  });

  it("swallows a rejection so the caller never sees it", async () => {
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    try {
      await inBackground("boom", async () => {
        throw new Error("apns down");
      });
      await inBackground("sync-boom", () => {
        throw new Error("threw before returning a promise");
      });
    } finally {
      console.error = original;
    }
    expect(errors).toHaveLength(2);
  });

  it("does not leak one request's waitUntil into another scope", async () => {
    const handed: Promise<unknown>[] = [];
    await runWithRequestContext(
      { waitUntil: (p: Promise<unknown>) => handed.push(p) },
      async () => {
        await inBackground("a", async () => {});
      },
    );
    let ranInline = false;
    await inBackground("outside", async () => {
      ranInline = true;
    });
    expect(handed).toHaveLength(1);
    expect(ranInline).toBe(true);
  });
});
