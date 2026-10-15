import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionMoveRatings } from "./session-move-ratings";

describe("SessionMoveRatings", () => {
  it("lists each rated move with its own rating, then the note", () => {
    const html = renderToStaticMarkup(
      <SessionMoveRatings
        ratings={[
          { planMoveId: "pm-1", moveName: "Waltz jump", stateIndex: 4 },
          { planMoveId: null, moveName: "Single salchow", stateIndex: 0 },
        ]}
        note="Salchow wouldn't come."
      />,
    );
    expect(html.indexOf("Waltz jump")).toBeLessThan(html.indexOf("Single salchow"));
    expect(html).toContain("Flowing");
    expect(html).toContain("Frustrated");
    expect(html).toContain("Salchow wouldn&#x27;t come.");
  });

  it("leaves the note out when there is none", () => {
    const html = renderToStaticMarkup(
      <SessionMoveRatings
        ratings={[{ planMoveId: "pm-1", moveName: "Sit spin", stateIndex: 2 }]}
      />,
    );
    expect(html).not.toContain("<p");
  });
});
