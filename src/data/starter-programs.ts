/**
 * Gradus starter programs.
 *
 * A brand-new athlete gets real work to do the moment onboarding finishes —
 * before any coach exists. Programs are keyed by sport + level; anything a
 * sport doesn't define simply produces nothing.
 *
 * Figure skating source: representative well-balanced programs built from the
 * U.S. Figure Skating element pools for each level.
 *
 * Two known gaps carried in as-is from the source chart:
 *  - Intermediate Free Skate is one element short of the required 12.
 *  - Junior Short Program has no step sequence.
 */

export interface StarterProgramMove {
  /** Element name, e.g. "Double Axel". Becomes the plan move name. */
  name: string;
  /** Element category, e.g. "Jump combination". Becomes the move description. */
  elementType: string;
  /** 1-based order within the program. */
  position: number;
}

export interface StarterProgram {
  /** Stable identifier, unique per sport. */
  key: string;
  /** Plan title shown to the athlete. */
  title: string;
  moves: StarterProgramMove[];
}

function program(
  key: string,
  title: string,
  rows: Array<[elementType: string, name: string]>,
): StarterProgram {
  return {
    key,
    title,
    moves: rows.map(([elementType, name], i) => ({ name, elementType, position: i + 1 })),
  };
}

const JUVENILE_FS = program("fs_juvenile_fs", "Juvenile — Free Skate", [
  ["Axel-type jump", "Double Axel"],
  ["Solo jump", "Triple Salchow"],
  ["Solo jump", "Double Flip"],
  ["Jump combination", "Double Loop + Single Euler + Double Salchow"],
  ["Flying spin", "Fly Sit Spin"],
  ["Spin combination, change of foot", "Change Foot Combo Spin"],
  ["Spin, one position", "Sit Spin"],
  ["Step sequence", "Step Sequence"],
]);

const INTERMEDIATE_SP = program("fs_intermediate_sp", "Intermediate — Short Program", [
  ["Axel-type jump", "Double Axel"],
  ["Solo jump", "Triple Toeloop"],
  ["Jump combination", "Triple Salchow + Double Toeloop"],
  ["Camel/sit spin, change of foot", "Change Foot Camel Spin"],
  ["Spin combination, change of foot", "Change Foot Combo Spin"],
  ["Step sequence", "Step Sequence"],
]);

// Known gap: 11 elements, required 12.
const INTERMEDIATE_FS = program("fs_intermediate_fs", "Intermediate — Free Skate", [
  ["Axel-type jump", "Double Axel"],
  ["Solo jump", "Triple Salchow"],
  ["Solo jump", "Triple Loop"],
  ["Jump combination", "Triple Toeloop + Double Toeloop"],
  ["Jump combination", "Triple Salchow + Double Toeloop"],
  ["Jump sequence", "Double Axel + Single Axel + Double Loop"],
  ["Jump combination", "Double Flip + Double Loop"],
  ["Flying spin", "Fly Sit Spin"],
  ["Spin combination, change of foot", "Change Foot Combo Spin"],
  ["Combination spin", "Combination Spin"],
  ["Step sequence", "Step Sequence"],
]);

const NOVICE_SP = program("fs_novice_sp", "Novice — Short Program", [
  ["Axel-type jump", "Double Axel"],
  ["Solo jump", "Triple Salchow"],
  ["Jump combination", "Triple Flip + Triple Toeloop"],
  ["Camel/sit spin, change of foot", "Change Foot Camel Spin"],
  ["Spin combination, change of foot", "Change Foot Combo Spin"],
  ["Step sequence", "Step Sequence"],
]);

const NOVICE_FS = program("fs_novice_fs", "Novice — Free Skate", [
  ["Jump combination", "Double Axel + Double Toeloop"],
  ["Solo jump", "Double Lutz"],
  ["Solo jump", "Double Salchow"],
  ["Flying spin", "Fly Sit Spin"],
  ["Jump combination", "Double Flip + Double Axel"],
  ["Choreographic sequence", "Choreo Sequence"],
  ["Jump combination", "Double Lutz + Double Toeloop + Double Loop"],
  ["Flying spin/combination", "Fly Camel Spin"],
  ["Solo jump", "Double Flip"],
  ["Spin combination, change of foot", "Change Foot Combo Spin"],
  ["Spin", "Layback Spin"],
  ["Jump combination", "Double Lutz + Single Axel"],
]);

// Known gap: no step sequence in the source pool.
const JUNIOR_SP = program("fs_junior_sp", "Junior — Short Program", [
  ["Axel-type jump", "Double Axel"],
  ["Solo jump", "Triple Lutz"],
  ["Jump combination", "Triple Salchow + Double Toeloop"],
  ["Flying spin", "Fly Camel Spin"],
  ["Spin combination, change of foot", "Change Foot Combo Spin"],
  ["Spin", "Layback Spin"],
]);

const JUNIOR_FS = program("fs_junior_fs", "Junior — Free Skate", [
  ["Axel-type jump", "Double Axel"],
  ["Solo jump", "Triple Flip"],
  ["Solo jump", "Triple Loop"],
  ["Solo jump", "Triple Salchow"],
  ["Jump combination", "Triple Lutz + Double Toeloop"],
  ["Jump combination", "Triple Toeloop + Double Euler + Double Toeloop"],
  ["Jump combination", "Triple Loop + Double Toeloop"],
  ["Flying spin", "Fly Camel Spin"],
  ["Flying spin combination, change of foot", "Fly Change Foot Combo Sit Spin"],
  ["Spin", "Layback Spin"],
  ["Spin combination, change of foot", "Change Foot Combo Spin"],
  ["Choreographic sequence", "Choreo Sequence"],
]);

const SENIOR_SP = program("fs_senior_sp", "Senior — Short Program", [
  ["Axel-type jump", "Double Axel"],
  ["Solo jump", "Triple Flip"],
  ["Jump combination", "Triple Lutz + Triple Toeloop"],
  ["Flying spin", "Fly Camel Spin"],
  ["Spin combination, change of foot", "Change Foot Combo Spin"],
  ["Spin", "Layback Spin"],
  ["Step sequence", "Step Sequence"],
]);

const SENIOR_FS = program("fs_senior_fs", "Senior — Free Skate", [
  ["Axel-type jump", "Double Axel"],
  ["Solo jump", "Triple Loop"],
  ["Solo jump", "Triple Salchow"],
  ["Jump combination", "Triple Lutz + Double Toeloop + Double Loop"],
  ["Jump combination", "Triple Loop + Double Axel"],
  ["Jump combination", "Triple Toeloop + Double Toeloop"],
  ["Jump combination", "Double Flip + Single Euler + Double Salchow"],
  ["Flying spin combination, change of foot", "Fly Change Foot Combo Spin"],
  ["Flying spin", "Fly Camel Spin"],
  ["Spin combination, change of foot", "Change Foot Combo Spin"],
  ["Spin", "Layback Spin"],
  ["Choreographic sequence", "Choreo Sequence"],
]);

/**
 * sport key -> level key -> programs created for that level.
 * Sports with no entry create nothing.
 */
export const STARTER_PROGRAMS: Record<string, Record<string, StarterProgram[]>> = {
  figure_skating: {
    basic_skills: [JUVENILE_FS],
    pre_preliminary: [JUVENILE_FS],
    preliminary: [JUVENILE_FS],
    pre_juvenile: [JUVENILE_FS],
    juvenile: [JUVENILE_FS],
    intermediate: [INTERMEDIATE_SP, INTERMEDIATE_FS],
    novice: [NOVICE_SP, NOVICE_FS],
    junior: [JUNIOR_SP, JUNIOR_FS],
    senior: [SENIOR_SP, SENIOR_FS],
  },
};

/** Level used when a sport has programs but the athlete's level isn't mapped. */
const FALLBACK_LEVEL: Record<string, string> = {
  figure_skating: "juvenile",
};

export function resolveStarterPrograms(sport: string, levelKey: string): StarterProgram[] {
  const bySport = STARTER_PROGRAMS[sport];
  if (!bySport) return [];
  const exact = bySport[levelKey];
  if (exact) return exact;
  const fallbackKey = FALLBACK_LEVEL[sport];
  return (fallbackKey ? bySport[fallbackKey] : undefined) ?? [];
}
