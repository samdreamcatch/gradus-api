import { describe, expect, it } from "bun:test";
import { getAthleteResources } from "./athlete-resources.server";

type Config = {
  athlete?: { id: string; birthdate?: string | null } | null;
  goals?: { sport: string }[];
  coachSports?: { sport: string }[];
  libraryRows?: unknown[];
  coachRows?: unknown[];
};

/**
 * A fake `supabase` covering `getAthleteResources`'s query sequence: a
 * `maybeSingle` on `athletes`, list awaits on `athlete_goals` /
 * `coach_athlete_sports`, and two shapes of `resources` query distinguished
 * by whether `.is("coach_id", null)` or `.not("coach_id", "is", null)` was
 * applied.
 */
function fakeClient(config: Config) {
  const chain = (table: string) => {
    let coachIdIsNull = false;
    let coachIdNotNull = false;
    const self: Record<string, unknown> = {};
    for (const m of ["select", "order", "eq", "in"]) self[m] = () => self;
    self.is = (col: string) => {
      if (col === "coach_id") coachIdIsNull = true;
      return self;
    };
    self.not = (col: string) => {
      if (col === "coach_id") coachIdNotNull = true;
      return self;
    };
    self.maybeSingle = async () => {
      if (table === "athletes") return { data: config.athlete ?? null, error: null };
      return { data: null, error: null };
    };
    self.then = (resolve: (v: unknown) => void) => {
      if (table === "athlete_goals") return resolve({ data: config.goals ?? [], error: null });
      if (table === "coach_athlete_sports")
        return resolve({ data: config.coachSports ?? [], error: null });
      if (table === "resources") {
        if (coachIdIsNull) return resolve({ data: config.libraryRows ?? [], error: null });
        if (coachIdNotNull) return resolve({ data: config.coachRows ?? [], error: null });
      }
      return resolve({ data: [], error: null });
    };
    return self;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: (table: string) => chain(table) } as any;
}

describe("getAthleteResources", () => {
  it("returns empty when the caller has no athlete profile", async () => {
    const supabase = fakeClient({ athlete: null });
    expect(await getAthleteResources({ userId: "u1", supabase })).toEqual({
      sports: [],
      resources: [],
      canAskGradus: false,
    });
  });

  it("returns empty when the athlete has no sports, still reporting canAskGradus", async () => {
    const supabase = fakeClient({ athlete: { id: "a1", birthdate: null } });
    expect(await getAthleteResources({ userId: "u1", supabase })).toEqual({
      sports: [],
      resources: [],
      canAskGradus: false,
    });
  });

  it("reports canAskGradus: false when the athlete has no birthdate on file, even with sports/resources", async () => {
    const supabase = fakeClient({
      athlete: { id: "a1", birthdate: null },
      goals: [{ sport: "figure_skating" }],
    });
    const result = await getAthleteResources({ userId: "u1", supabase });
    expect(result.canAskGradus).toBe(false);
  });

  it("reports canAskGradus: false when the athlete's birthdate confirms under 18", async () => {
    const tenYearsAgo = new Date();
    tenYearsAgo.setUTCFullYear(tenYearsAgo.getUTCFullYear() - 10);
    const supabase = fakeClient({
      athlete: { id: "a1", birthdate: tenYearsAgo.toISOString().slice(0, 10) },
      goals: [{ sport: "figure_skating" }],
    });
    const result = await getAthleteResources({ userId: "u1", supabase });
    expect(result.canAskGradus).toBe(false);
  });

  it("reports canAskGradus: true when the athlete's birthdate confirms 18+", async () => {
    const thirtyYearsAgo = new Date();
    thirtyYearsAgo.setUTCFullYear(thirtyYearsAgo.getUTCFullYear() - 30);
    const supabase = fakeClient({
      athlete: { id: "a1", birthdate: thirtyYearsAgo.toISOString().slice(0, 10) },
      goals: [{ sport: "figure_skating" }],
    });
    const result = await getAthleteResources({ userId: "u1", supabase });
    expect(result.canAskGradus).toBe(true);
  });

  it("combines coach uploads (first) and library resources (second)", async () => {
    const supabase = fakeClient({
      athlete: { id: "a1", birthdate: null },
      goals: [{ sport: "figure_skating" }],
      coachSports: [{ sport: "hockey" }],
      libraryRows: [
        {
          id: "lib1",
          sport: "figure_skating",
          title: "Library",
          description: null,
          kind: "pdf",
          external_url: null,
        },
      ],
      coachRows: [
        {
          id: "c1",
          sport: "hockey",
          title: "Coach upload",
          description: "d",
          kind: "link",
          external_url: "https://x",
          coach_id: "coach1",
          coach_profiles: { first_name: "Dana", last_name: "Wallace" },
          resource_sports: [{ sport: "hockey" }],
        },
      ],
    });
    const result = await getAthleteResources({ userId: "u1", supabase });
    expect(result.sports).toEqual(["figure_skating", "hockey"]);
    expect(result.resources).toEqual([
      {
        id: "c1",
        sport: "hockey",
        sports: ["hockey"],
        title: "Coach upload",
        description: "d",
        kind: "link",
        source: "coach",
        externalUrl: "https://x",
        coachName: "Dana Wallace",
      },
      {
        id: "lib1",
        sport: "figure_skating",
        sports: ["figure_skating"],
        title: "Library",
        description: "",
        kind: "pdf",
        source: "library",
        externalUrl: null,
        coachName: null,
      },
    ]);
  });
});
