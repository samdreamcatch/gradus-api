import { describe, expect, it } from "bun:test";
import {
  DIRECT_NOTICE,
  DIRECT_NOTICE_EMAIL_DEFAULT,
  DIRECT_NOTICE_EMAIL_SAFETY_BODY_DEFAULT,
  DIRECT_NOTICE_EMAIL_SAFETY_HEADING_DEFAULT,
  DIRECT_NOTICE_EMAIL_UNCLAIMED_DEFAULT,
  directNoticeAthleteName,
  directNoticeSentences,
  renderDirectNotice,
} from "./direct-notice";
import { EMAIL_COPY_SCHEMA } from "../email-templates/copy-schema";

describe("direct notice (COPPA §312.4(c))", () => {
  it("leads with the no-photos-or-video promise", () => {
    expect(DIRECT_NOTICE_EMAIL_SAFETY_HEADING_DEFAULT).toBe(
      "Gradus never collects photos or video of {athleteName}.",
    );
    expect(DIRECT_NOTICE_EMAIL_SAFETY_BODY_DEFAULT).toContain("no profile pictures");
    expect(DIRECT_NOTICE_EMAIL_SAFETY_BODY_DEFAULT).toContain("can't send voice recordings");
    const prose = directNoticeSentences({ athleteName: "Rory" });
    expect(prose[0]).toBe("Gradus never collects photos or video of Rory.");
  });

  it("the email default carries every required element with its placeholders intact", () => {
    const n = DIRECT_NOTICE_EMAIL_DEFAULT;
    expect(n).toContain("{siteUrl}/privacy");
    // What is collected, how it is used, who processes it, retention, the deletion windows, parental control.
    expect(n).toContain(
      "<strong>What we keep:</strong> their name, date of birth, username, practice logs, goals, and text messages",
    );
    expect(n).toContain("never for advertising");
    expect(n).toContain("Kids Web Services verifies parents");
    expect(n).toContain("The full list is in our privacy policy at {siteUrl}/privacy.");
    expect(n).toContain("as long as the account exists");
    expect(n).not.toContain("three months");
    expect(DIRECT_NOTICE_EMAIL_UNCLAIMED_DEFAULT).toBe(
      "<strong>If you don't claim it:</strong> we delete this account and this email address after three months.",
    );
    expect(n).toContain(
      "athlete under 18 goes unused for three years, we email you, then delete it",
    );
    expect(n).toContain("review or delete");
    expect(n).not.toContain("payment-card");
    // One item per line, each with a bold label.
    for (const line of n.split("\n")) expect(line).toMatch(/^<strong>[^<]+:<\/strong> /);
  });

  it("is the guardian-invite email's default notice and callout slots", () => {
    const d = EMAIL_COPY_SCHEMA["guardian-invite"].defaults;
    expect(d.safetyHeading).toBe(DIRECT_NOTICE_EMAIL_SAFETY_HEADING_DEFAULT);
    expect(d.safetyBody).toBe(DIRECT_NOTICE_EMAIL_SAFETY_BODY_DEFAULT);
    expect(d.notice).toBe(DIRECT_NOTICE_EMAIL_DEFAULT);
    expect(d.noticeUnclaimed).toBe(DIRECT_NOTICE_EMAIL_UNCLAIMED_DEFAULT);
  });

  it("never puts a possessive on the athlete name (it can be 'your athletes')", () => {
    expect(JSON.stringify(DIRECT_NOTICE)).not.toContain("{athleteName}'s");
  });

  it("fills the name and the site, and falls back to 'your athlete'", () => {
    expect(renderDirectNotice(DIRECT_NOTICE.noMedia, { athleteName: "Rory" })).toBe(
      "Gradus never collects photos or video of Rory.",
    );
    expect(directNoticeAthleteName("  ")).toBe("your athlete");
    expect(directNoticeAthleteName(null)).toBe("your athlete");
    const prose = directNoticeSentences({ athleteName: null, siteUrl: "https://x.test" });
    expect(prose[0]).toBe("Gradus never collects photos or video of your athlete.");
    expect(prose.join(" ")).toContain("our privacy policy at https://x.test/privacy.");
    expect(prose.join(" ")).not.toContain("{");
  });

  it("in-app form drops the unclaimed item and adds the consent sentence on request", () => {
    const inApp = directNoticeSentences({ athleteName: "your athletes", consentAct: true });
    expect(inApp.join(" ")).not.toContain("three months");
    expect(inApp.at(-1)).toBe(
      "By continuing, you give your consent for your athletes on those terms.",
    );
    const email = directNoticeSentences({ unclaimed: true });
    expect(email.at(-1)).toBe(
      "If you don't claim it: we delete this account and this email address after three months.",
    );
    expect(email.join(" ")).not.toContain("By continuing");
  });
});
