import { describe, expect, it } from "bun:test";
import { newCustomSportKeys } from "./coach-onboarding.server";

describe("newCustomSportKeys", () => {
  it("allows catalog sports", () => {
    expect(newCustomSportKeys(["figure_skating", "tennis"], [])).toEqual([]);
  });

  it("keeps a coach's existing custom sport saveable", () => {
    expect(newCustomSportKeys(["custom_curling_ab12c"], ["custom_curling_ab12c"])).toEqual([]);
  });

  it("refuses a custom sport the coach doesn't already have", () => {
    expect(
      newCustomSportKeys(
        ["figure_skating", "custom_new_sport_c715f", "custom_new_sport_c715f"],
        ["custom_curling_ab12c"],
      ),
    ).toEqual(["custom_new_sport_c715f"]);
  });
});
