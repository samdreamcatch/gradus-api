import { describe, expect, it } from "bun:test";
import * as React from "react";
import { render } from "@react-email/render";
import { RetentionNoticeEmail, retentionNoticeSubject } from "./retention-notice";

describe("retention-notice email", () => {
  const name = "D'Angelo <b>Keep</b>";
  it("escapes the name only where html-react-parser reads it", async () => {
    const subject = retentionNoticeSubject({ athleteName: name, deleteDate: "November 3, 2026" });
    expect(subject).toBe(
      "D'Angelo <b>Keep</b>'s Gradus account will be deleted on November 3, 2026",
    );
    const html = await render(
      React.createElement(RetentionNoticeEmail, {
        athleteName: name,
        deleteDate: "November 3, 2026",
      }),
    );
    expect(html).not.toContain("<b>Keep</b>");
    expect(html).not.toContain("&amp;#39;");
    expect(html).not.toContain("&amp;lt;");
    const text = await render(
      React.createElement(RetentionNoticeEmail, {
        athleteName: name,
        deleteDate: "November 3, 2026",
      }),
      { plainText: true },
    );
    expect(text).toContain("Keep D'Angelo <b>Keep</b>'s account");
    expect(text).toContain("https://gradus.training/login");
  });
});
