import { describe, expect, it } from "bun:test";
import * as React from "react";
import { render } from "@react-email/render";
import { GuardianInviteEmail } from "./guardian-invite";

const base = { athleteName: "Rory", claimUrl: "https://gradus.training/g/t" };

describe("guardian-invite email", () => {
  it("shows the no-photos callout and the notice items", async () => {
    const text = await render(React.createElement(GuardianInviteEmail, base), {
      plainText: true,
    });
    expect(text).toContain("Gradus never collects photos or video of Rory.");
    expect(text).toContain("There are no profile pictures");
    expect(text).toContain("What we keep:");
    expect(text).toContain("our privacy policy at https://gradus.training/privacy.");
    expect(text).toContain("You're in control:");
  });

  it("tells only a self-sign-up's guardian about the three-month deletion", async () => {
    const selfSignUp = await render(React.createElement(GuardianInviteEmail, base), {
      plainText: true,
    });
    expect(selfSignUp).toContain("If you don't claim it:");
    const coachAdded = await render(
      React.createElement(GuardianInviteEmail, { ...base, coachName: "Dana Wallace" }),
      { plainText: true },
    );
    expect(coachAdded).not.toContain("three months");
  });

  it("escapes the athlete name in parsed slots", async () => {
    const html = await render(
      React.createElement(GuardianInviteEmail, { ...base, athleteName: "Rory <b>X</b>" }),
    );
    expect(html).not.toContain("<b>X</b>");
  });

  it("renders an old one-paragraph notice override as a single item", async () => {
    const text = await render(
      React.createElement(GuardianInviteEmail, {
        ...base,
        coachName: "Dana Wallace",
        copyOverrides: { notice: "Old notice for {athleteName}." },
      }),
      { plainText: true },
    );
    expect(text).toContain("Old notice for Rory.");
    expect(text).not.toContain("What we keep:");
  });
});
