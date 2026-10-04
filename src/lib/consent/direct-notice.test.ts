import { describe, expect, it } from "bun:test";
import {
  DIRECT_NOTICE,
  DIRECT_NOTICE_EMAIL_DEFAULT,
  DIRECT_NOTICE_EMAIL_UNCLAIMED_DEFAULT,
  directNoticeAthleteName,
  directNoticeSentences,
  renderDirectNotice,
} from "./direct-notice";
import { EMAIL_COPY_SCHEMA } from "../email-templates/copy-schema";

describe("direct notice (COPPA §312.4(c))", () => {
  it("the email default carries every required element with its placeholders intact", () => {
    const n = DIRECT_NOTICE_EMAIL_DEFAULT;
    expect(n).toContain("{athleteName}");
    expect(n).toContain("{siteUrl}/privacy");
    // What is collected, how it is used, who processes it, retention, the deletion windows, parental control.
    expect(n).toContain("name, date of birth, a username, practice logs, goals, and text messages");
    expect(n).toContain("never for advertising");
    expect(n).toContain("Kids Web Services verifies parents");
    expect(n).toContain("the full list is in our privacy policy at {siteUrl}/privacy.");
    expect(n).toContain("as long as the account exists");
    expect(n).not.toContain("within three months");
    expect(DIRECT_NOTICE_EMAIL_UNCLAIMED_DEFAULT).toContain("within three months");
    expect(n).toContain("athlete under 18 that nobody has used for three years");
    expect(n).toContain("review or delete");
    expect(n).toContain("can't send voice recordings");
    expect(n).not.toContain("payment-card");
  });

  it("is the guardian-invite email's default notice slot", () => {
    expect(EMAIL_COPY_SCHEMA["guardian-invite"].defaults.notice).toBe(DIRECT_NOTICE_EMAIL_DEFAULT);
    expect(EMAIL_COPY_SCHEMA["guardian-invite"].defaults.noticeUnclaimed).toBe(
      DIRECT_NOTICE_EMAIL_UNCLAIMED_DEFAULT,
    );
  });

  it("fills the name and the site, and falls back to 'your athlete'", () => {
    expect(renderDirectNotice(DIRECT_NOTICE.keeps, { athleteName: "Rory" })).toMatch(
      /^What Gradus keeps for Rory:/,
    );
    expect(directNoticeAthleteName("  ")).toBe("your athlete");
    expect(directNoticeAthleteName(null)).toBe("your athlete");
    const prose = directNoticeSentences({ athleteName: null, siteUrl: "https://x.test" });
    expect(prose.join(" ")).toContain("https://x.test/privacy");
    expect(prose.join(" ")).not.toContain("{");
  });

  it("in-app form drops the unclaimed line and adds the consent sentence on request", () => {
    const inApp = directNoticeSentences({ athleteName: "your athletes", consentAct: true });
    expect(inApp.join(" ")).not.toContain("within three months");
    expect(inApp.at(-1)).toBe(
      "By continuing, you give your consent for your athletes on those terms.",
    );
    const email = directNoticeSentences({ unclaimed: true });
    expect(email.join(" ")).toContain("within three months");
    expect(email.join(" ")).not.toContain("By continuing");
  });
});
