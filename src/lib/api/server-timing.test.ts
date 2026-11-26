import { describe, expect, it } from "bun:test";
import { RequestTimer } from "./server-timing";

function fakeClock() {
  const clock = { t: 1_000 };
  return { clock, now: () => clock.t };
}

describe("RequestTimer", () => {
  it("lists only the phases that ran, in pipeline order, then the total", async () => {
    const { clock, now } = fakeClock();
    const timer = new RequestTimer(now);
    await timer.measure("handler", async () => {
      clock.t += 230;
    });
    await timer.measure("auth", async () => {
      clock.t += 12;
    });
    clock.t += 8; // time outside any phase still counts toward the total

    expect(timer.header(false)).toBe("auth;dur=12, handler;dur=230, total;dur=250");
  });

  it("marks a request that waited for a new server instance", () => {
    const { now } = fakeClock();
    expect(new RequestTimer(now).header(true)).toBe("total;dur=0, cold");
  });

  it("counts a phase that throws, and adds repeat visits to the same phase", async () => {
    const { clock, now } = fakeClock();
    const timer = new RequestTimer(now);
    await expect(
      timer.measure("body", async () => {
        clock.t += 40;
        throw new Error("cut off");
      }),
    ).rejects.toThrow("cut off");
    await timer.measure("body", async () => {
      clock.t += 10;
    });

    expect(timer.snapshot()).toEqual({ body: 50, total: 50 });
  });

  it("takes time back out of a phase without going below zero", async () => {
    const { clock, now } = fakeClock();
    const timer = new RequestTimer(now);
    await timer.measure("idem", async () => {
      clock.t += 300;
    });
    timer.subtract("idem", 220);
    expect(timer.get("idem")).toBe(80);
    timer.subtract("idem", 500);
    expect(timer.get("idem")).toBe(0);
    // A phase that never ran stays unlisted.
    timer.subtract("auth", 5);
    expect(timer.snapshot()).toEqual({ idem: 0, total: 300 });
  });

  it("never reports a negative duration when the clock steps back", async () => {
    const { clock, now } = fakeClock();
    const timer = new RequestTimer(now);
    await timer.measure("auth", async () => {
      clock.t -= 50;
    });
    expect(timer.snapshot()).toEqual({ auth: 0, total: 0 });
  });
});
