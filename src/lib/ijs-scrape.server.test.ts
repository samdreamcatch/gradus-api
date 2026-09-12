import { describe, expect, it } from "bun:test";
import { competitionTimeZone, parseIndex, toDate } from "./ijs-scrape.server";

function indexPage(zone: string) {
  return `
    <H1>Test Competition</H1>
    <H3>9/12/2026</H3>
    <H4>Test Rink</H4>
    <TABLE id=daySort><TBODY>
      <TR><TD class=date>Sat Sep 12</TD><TD class=time>2:15 PM</TD>
      <TD class=event>Test Event</TD><TD class=stat><A href=CAT001SEG001.html>Start order</A></TD></TR>
    </TBODY></TABLE>
    <P><FONT SIZE=-1>Saturday, Sep 12, 2026, 1:45 PM ${zone} Daylight Time</FONT><!-- Competition local time --></P>
  `;
}

describe("IJS competition time zones", () => {
  it("detects Central and Eastern published zones", () => {
    expect(competitionTimeZone(indexPage("Central"))).toBe("America/Chicago");
    expect(competitionTimeZone(indexPage("Eastern"))).toBe("America/New_York");
  });

  it("converts the same wall clock using the competition's zone", () => {
    expect(toDate("Sat Sep 12", "2:15 PM", 2026, "America/Chicago")?.toISOString()).toBe(
      "2026-09-12T19:15:00.000Z",
    );
    expect(toDate("Sat Sep 12", "2:15 PM", 2026, "America/New_York")?.toISOString()).toBe(
      "2026-09-12T18:15:00.000Z",
    );
  });

  it("uses the detected zone while parsing schedule rows", () => {
    const parsed = parseIndex(indexPage("Central"), 2026);
    expect(parsed.competition.timeZone).toBe("America/Chicago");
    expect(parsed.events[0]?.startAt?.toISOString()).toBe("2026-09-12T19:15:00.000Z");
  });
});