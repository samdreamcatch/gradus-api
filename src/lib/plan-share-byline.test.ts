import { expect, it } from "bun:test";
import { sharedPlanByline } from "./plan-share-byline";

it("names the athlete, the coach, or Gradus", () => {
  expect(
    sharedPlanByline({
      authorKind: "athlete",
      authorFirstName: "Greta",
      coachFirstName: "",
      coachLastName: "",
    }),
  ).toBe("Plan by Greta");
  expect(
    sharedPlanByline({ authorKind: "coach", coachFirstName: "Renata", coachLastName: "Pruitt" }),
  ).toBe("Plan by Coach Renata Pruitt");
  expect(sharedPlanByline({ coachFirstName: "Renata", coachLastName: "" })).toBe(
    "Plan by Coach Renata",
  );
});

it("a Gradus plan with no coach named is by Gradus, including the old placeholder", () => {
  expect(sharedPlanByline({ authorKind: "coach", coachFirstName: "", coachLastName: "" })).toBe(
    "Plan by Gradus",
  );
  expect(
    sharedPlanByline({ authorKind: "coach", coachFirstName: "A Gradus coach", coachLastName: "" }),
  ).toBe("Plan by Gradus");
});
