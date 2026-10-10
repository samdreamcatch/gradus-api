import { describe, expect, it } from "bun:test";
import { coachLabel, guardianActivitySubject } from "./guardian-activity";
import { renderTemplateString, resolveCopy } from "./copy-schema";

describe("guardian-activity sender label", () => {
  it("adds Coach once", () => {
    expect(coachLabel("Jen Park")).toBe("Coach Jen Park");
  });

  it("never doubles a title the coach typed into their own name", () => {
    expect(coachLabel("Coach Jen")).toBe("Coach Jen");
    expect(coachLabel("coach jen")).toBe("coach jen");
    expect(coachLabel("Coachella Reyes")).toBe("Coach Coachella Reyes");
    expect(coachLabel("Coachéla Reyes")).toBe("Coach Coachéla Reyes");
    expect(coachLabel("Coach")).toBe("Coach");
  });

  it("reads as the athlete's coach with no name", () => {
    expect(coachLabel("  ")).toBe("Your athlete's coach");
  });

  it("keeps the subject unchanged", () => {
    expect(guardianActivitySubject({ athleteName: "Linnea" })).toBe(
      "New message about Linnea on Gradus",
    );
  });

  it("headline uses the label", () => {
    const c = resolveCopy("guardian-activity");
    expect(renderTemplateString(c.heading, { senderLabel: coachLabel("Tobias Fairbank") })).toBe(
      "Coach Tobias Fairbank sent a message",
    );
  });
});
