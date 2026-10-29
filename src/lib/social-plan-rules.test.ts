import { expect, test } from "bun:test";
import { isAdminSocialPlan } from "./social-plan-rules";

test("editing only accepts admin-created shared plans", () => {
  const plan = { kind: "template", source: "gradus", coach_id: null, athlete_id: null, share_token: "existing-link" };
  expect(isAdminSocialPlan(plan)).toBe(true);
  expect(isAdminSocialPlan({ ...plan, source: "coach" })).toBe(false);
  expect(isAdminSocialPlan({ ...plan, athlete_id: "athlete" })).toBe(false);
  expect(isAdminSocialPlan({ ...plan, coach_id: "coach" })).toBe(false);
  expect(isAdminSocialPlan({ ...plan, share_token: null })).toBe(false);
});