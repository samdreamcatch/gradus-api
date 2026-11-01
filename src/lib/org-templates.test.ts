import { describe, expect, it } from "bun:test";
import { coachReceivesTemplate, groupTemplateCsv, planTargetKind } from "./org-templates";

describe("groupTemplateCsv", () => {
  it("groups rows with the same title and sport into one template", () => {
    const r = groupTemplateCsv(
      [
        { title: "Warm up", sport: "figure_skating", levels: "pre_preliminary;preliminary", move: "Crossovers", target: "10" },
        { title: "Warm up", sport: "figure_skating", move: "Spirals", target_kind: "minutes", target: "5" },
      ],
      ["figure_skating"],
    );
    expect(r.errors).toEqual([]);
    expect(r.templates).toHaveLength(1);
    expect(r.templates[0].levelKeys).toEqual(["pre_preliminary", "preliminary"]);
    expect(r.templates[0].moves[1]).toMatchObject({ name: "Spirals", targetKind: "minutes", targetValue: 5 });
  });

  it("rejects sports the club doesn't have", () => {
    const r = groupTemplateCsv([{ title: "X", sport: "hockey", move: "Stride" }], ["figure_skating"]);
    expect(r.templates).toHaveLength(0);
    expect(r.errors[0]).toContain("hockey");
  });

  it("drops templates with no moves and reports them", () => {
    const r = groupTemplateCsv([{ title: "Empty", sport: "figure_skating" }], ["figure_skating"]);
    expect(r.templates).toHaveLength(0);
    expect(r.errors).toEqual(['"Empty" has no moves']);
  });
});

describe("coachReceivesTemplate", () => {
  const coach = [{ sport: "figure_skating", levelKey: "preliminary" }];
  it("sends to coaches of the sport when no levels are named", () => {
    expect(coachReceivesTemplate(coach, { sport: "figure_skating", levelKeys: [] })).toBe(true);
  });
  it("skips coaches who don't teach the sport", () => {
    expect(coachReceivesTemplate(coach, { sport: "gymnastics", levelKeys: [] })).toBe(false);
  });
  it("needs at least one matching level when levels are named", () => {
    expect(coachReceivesTemplate(coach, { sport: "figure_skating", levelKeys: ["juvenile"] })).toBe(false);
    expect(coachReceivesTemplate(coach, { sport: "figure_skating", levelKeys: ["juvenile", "preliminary"] })).toBe(true);
  });
});

it("stores minutes as mins on plan steps", () => {
  expect(planTargetKind("minutes")).toBe("mins");
  expect(planTargetKind("reps")).toBe("reps");
});
