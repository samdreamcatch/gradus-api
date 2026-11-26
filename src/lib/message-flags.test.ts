import { describe, expect, it } from "bun:test";
import { decideMessageCheck, flagPriority } from "./message-flags";
import { checkMessage } from "./message-rules";

const warn = checkMessage("you're worthless")!;
const selfHarm = checkMessage("I want to kill myself")!;

describe("decideMessageCheck (PRD #64)", () => {
  it("sends a clean message untouched", () => {
    expect(
      decideMessageCheck({
        match: null,
        senderMinor: false,
        roomHasMinor: true,
        sendAnyway: false,
      }),
    ).toEqual({ action: "send", outcome: null });
  });

  it("never offers Send anyway to an adult in a room with a minor", () => {
    const d = decideMessageCheck({
      match: warn,
      senderMinor: false,
      roomHasMinor: true,
      sendAnyway: false,
    });
    expect(d).toEqual({
      action: "refuse",
      outcome: "stopped",
      canSendAnyway: false,
      showSafeSport: false,
    });
    // And asking for it anyway changes nothing.
    expect(
      decideMessageCheck({ match: warn, senderMinor: false, roomHasMinor: true, sendAnyway: true })
        .action,
    ).toBe("refuse");
  });

  it("always lets a sender under 18 send anyway, and points them to Safe Sport", () => {
    expect(
      decideMessageCheck({ match: warn, senderMinor: true, roomHasMinor: true, sendAnyway: false }),
    ).toEqual({ action: "refuse", outcome: "stopped", canSendAnyway: true, showSafeSport: true });
    expect(
      decideMessageCheck({ match: warn, senderMinor: true, roomHasMinor: true, sendAnyway: true }),
    ).toEqual({ action: "send", outcome: "sent_anyway" });
  });

  it("lets adults send anyway in a room with no minor", () => {
    expect(
      decideMessageCheck({
        match: warn,
        senderMinor: false,
        roomHasMinor: false,
        sendAnyway: false,
      }),
    ).toEqual({ action: "refuse", outcome: "stopped", canSendAnyway: true, showSafeSport: false });
    expect(
      decideMessageCheck({
        match: warn,
        senderMinor: false,
        roomHasMinor: false,
        sendAnyway: true,
      }),
    ).toEqual({ action: "send", outcome: "sent_anyway" });
  });

  it("never stops self-harm said about oneself, in any room, and asks for the 988 line", () => {
    for (const roomHasMinor of [true, false]) {
      for (const senderMinor of [true, false]) {
        expect(
          decideMessageCheck({ match: selfHarm, senderMinor, roomHasMinor, sendAnyway: false }),
        ).toEqual({ action: "send", outcome: "sent", crisisLine: true });
      }
    }
  });

  it("judges the sender on the seat they post from, not on other profiles the login holds", () => {
    // sendMessage passes senderMinor = false for a coach whose login also has an
    // athlete row with no birthdate; that must not unlock Send anyway in a minor's room.
    const d = decideMessageCheck({
      match: warn,
      senderMinor: false,
      roomHasMinor: true,
      sendAnyway: true,
    });
    expect(d.action).toBe("refuse");
  });

  it("orders flags: sent anyway, then a minor's, then the rest", () => {
    expect(flagPriority({ outcome: "sent_anyway", senderMinor: false, category: "abuse" })).toBe(0);
    // A voice note flagged after it was delivered ranks with "sent anyway".
    expect(flagPriority({ outcome: "sent", senderMinor: false, category: "sexual" })).toBe(0);
    expect(flagPriority({ outcome: "stopped", senderMinor: true, category: "abuse" })).toBe(1);
    expect(flagPriority({ outcome: "sent", senderMinor: true, category: "self_harm" })).toBe(1);
    expect(flagPriority({ outcome: "stopped", senderMinor: false, category: "abuse" })).toBe(2);
  });
});
