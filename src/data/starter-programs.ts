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
  /** Element category, e.g. "Jump combination". Kept for grouping/reference. */
  elementType: string;
  /** What the element is, in plain language. */
  description: string;
  /** What to focus on while doing it. */
  cue: string;
  /** Why it matters. */
  why: string;
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

interface MoveCopy {
  description: string;
  cue: string;
  why: string;
}

/* ---------------- jump copy ---------------- */

interface JumpFamily {
  /** How the jump leaves the ice. */
  takeoff: string;
  cue: string;
  why: string;
}

const JUMP_FAMILIES: Record<string, JumpFamily> = {
  axel: {
    takeoff: "the only jump that takes off going forward, from a forward outside edge",
    cue: "Strong forward takeoff, swing the free leg through hard, pull the arms in tight.",
    why: "The axel is the dividing line in figure skating — the extra half rotation is what separates advancing skaters from the rest.",
  },
  salchow: {
    takeoff: "a sweeping edge jump off the back inside edge, powered by a wide free-leg swing rather than a toe pick",
    cue: "Deep bend through the entry turn, swing the free leg out wide, push off one foot only.",
    why: "Salchow builds the edge control and free-leg swing every other edge jump depends on.",
  },
  toeloop: {
    takeoff: "a toe-assisted jump off the back outside edge, vaulted with the opposite toe pick",
    cue: "Reach the pick straight back, don't hook it. Vault up, then pull in immediately.",
    why: "Toe loop can follow almost any landing, which makes it the most useful second jump in a combination.",
  },
  loop: {
    takeoff: "an edge jump off the back outside edge with no toe pick and no change of foot",
    cue: "Sit into the entry edge, keep the shoulders square, rise straight up off the one foot.",
    why: "Loop teaches you to leave the ice off the same edge you land on, which is the foundation of combination jumps.",
  },
  flip: {
    takeoff: "a toe-assisted jump off the back inside edge, usually entered from a three-turn",
    cue: "Clean three-turn entry, hold the inside edge, reach the pick deep behind you.",
    why: "Flip is a standard element at every competitive level and trains a controlled picking action.",
  },
  lutz: {
    takeoff: "a toe-assisted jump off the back outside edge, rotating against the direction of the entry curve",
    cue: "Hold the outside edge all the way to the pick — don't let it roll over.",
    why: "The counter-rotated takeoff makes lutz one of the hardest jumps to keep clean; the edge is what judges watch.",
  },
  euler: {
    takeoff: "a half-rotation connecting jump that lands on the back inside edge",
    cue: "Quiet and quick — it's a bridge, not a showpiece. Land it small and keep moving.",
    why: "The euler links two jumps that couldn't otherwise be combined, opening up three-jump combinations.",
  },
};

const ROTATIONS: Record<string, string> = {
  single: "1",
  double: "2",
  triple: "3",
  quad: "4",
};

function jumpParts(name: string): { rotationWord: string; family: string } | null {
  const parts = name.trim().toLowerCase().split(/\s+/);
  if (parts.length < 2) return null;
  const rotationWord = parts[0]!;
  const family = parts.slice(1).join("");
  if (!ROTATIONS[rotationWord] || !JUMP_FAMILIES[family]) return null;
  return { rotationWord, family };
}

function jumpPhrase(name: string): string {
  const parsed = jumpParts(name);
  if (!parsed) return name;
  if (parsed.family === "euler") return "half-rotation euler";
  const base = ROTATIONS[parsed.rotationWord]!;
  const rotations = parsed.family === "axel" ? `${base}.5` : base;
  return `${rotations}-rotation ${parsed.family === "toeloop" ? "toe loop" : parsed.family}`;
}

function soloJumpCopy(name: string): MoveCopy | null {
  const parsed = jumpParts(name);
  if (!parsed) return null;
  const fam = JUMP_FAMILIES[parsed.family]!;
  return {
    description: `A ${jumpPhrase(name)} — ${fam.takeoff}.`,
    cue: fam.cue,
    why: fam.why,
  };
}

function comboCopy(name: string): MoveCopy | null {
  const jumps = name.split("+").map((p) => p.trim());
  if (jumps.length < 2) return null;
  const parsed = jumps.map(jumpParts);
  if (parsed.some((p) => !p)) return null;

  const phrases = jumps.map(jumpPhrase);
  const first = JUMP_FAMILIES[parsed[0]!.family]!;
  const last = JUMP_FAMILIES[parsed[parsed.length - 1]!.family]!;
  const middle = phrases.slice(1, -1);

  const chain =
    middle.length > 0
      ? `then straight through a ${middle.join(", then a ")}, and finish with a ${phrases[phrases.length - 1]}`
      : `then go straight into a ${phrases[1]}`;

  return {
    description: `Land the ${phrases[0]} cleanly, ${chain}. No steps, turns, or change of foot in between.`,
    cue: first.cue === last.cue ? first.cue : `Entry: ${first.cue} Finish: ${last.cue}`,
    why: "Combinations are won on the first landing — it has to be quiet and controlled enough to launch the next jump. If one jump misses, check which end of the combination broke down.",
  };
}

/* ---------------- spins, sequences, and everything else ---------------- */

const ELEMENT_COPY: Record<string, MoveCopy> = {
  "Sit Spin": {
    description: "A spin held in a low sitting position with the free leg extended out in front.",
    cue: "Deep knee bend, free leg out front, spinning leg directly under you.",
    why: "A required position spin in tests and programs, and it builds the deep knee strength everything else needs.",
  },
  "Camel Spin": {
    description:
      "A spin in a forward-leaning position with the free leg lifted to or above horizontal behind you.",
    cue: "Strong spiral position, free leg high, back flat.",
    why: "Builds the arabesque position in motion and trains a centered spin on a stretched edge.",
  },
  "Layback Spin": {
    description: "An upright spin with the back arched and the head dropped back.",
    cue: "Find the center first, then arch — don't trade the center for the position.",
    why: "A signature spin that builds back flexibility and centered balance under rotation.",
  },
  "Combination Spin": {
    description:
      "A spin that moves through at least two positions — sit, camel, or upright — without stopping.",
    cue: "Plan the change before you get there. Don't lose the center between positions.",
    why: "A required element in test and competition programs; the position changes are where most points are lost.",
  },
  "Change Foot Combo Spin": {
    description:
      "A combination spin that changes position and changes feet, holding the center throughout.",
    cue: "Push the change of foot cleanly out of the exit edge. Same center, both feet.",
    why: "The change of foot is worth real value, but only if the second half stays as centered as the first.",
  },
  "Change Foot Camel Spin": {
    description: "A camel spin held on one foot, then changed to the other foot without stopping.",
    cue: "Hold the first camel long enough to be counted, then change feet without dropping the free leg.",
    why: "Trains a matched camel position on both sides — most skaters have a strong side and a weak side.",
  },
  "Fly Sit Spin": {
    description: "A sit spin entered with a jump, landing straight into the low sitting position.",
    cue: "Jump up and out, not just up. Land already low, don't sink into it afterwards.",
    why: "The flying entry is what earns the level; landing straight into position is what keeps it clean.",
  },
  "Fly Camel Spin": {
    description: "A camel spin entered with a jump into the spiral position.",
    cue: "Reach the free leg back as you leave the ice, then land on a stretched edge.",
    why: "A staple flying spin in short programs; the air position sets up the whole spin.",
  },
  "Fly Change Foot Combo Spin": {
    description:
      "A flying entry into a combination spin that also changes feet through the positions.",
    cue: "Land the fly centered — everything after it inherits that center. Change feet without a wobble.",
    why: "One of the highest-value spins available, because it stacks a flying entry, a change of foot, and position changes.",
  },
  "Fly Change Foot Combo Sit Spin": {
    description:
      "A flying entry into a sit spin, then a change of foot into a second sitting position.",
    cue: "Land the fly already low, hold it, then push the change of foot straight back into a sit.",
    why: "Demands sit position strength on both legs, which is where the levels are won or lost.",
  },
  "Step Sequence": {
    description:
      "A sequence of turns, steps, and edges skated across the ice as one continuous pattern.",
    cue: "Skate it on deep edges with the upper body involved — not a checklist of turns.",
    why: "Step sequences are scored on edge quality and difficulty, and they're where skating skills show most clearly.",
  },
  "Choreo Sequence": {
    description:
      "A freely designed sequence of movements — spirals, spread eagles, hydroblades, small jumps — skated to the music.",
    cue: "Play to the music and the audience. Big, committed positions beat busy ones.",
    why: "Scored on performance rather than difficulty, so it's the easiest place to add points through expression.",
  },
};

function moveCopy(name: string): MoveCopy {
  const explicit = ELEMENT_COPY[name];
  if (explicit) return explicit;
  const combo = comboCopy(name);
  if (combo) return combo;
  const solo = soloJumpCopy(name);
  if (solo) return solo;
  return {
    description: name,
    cue: "Take it slow the first few times and keep the quality high.",
    why: "A required element for this level — steady reps now make it reliable in a program.",
  };
}

export function starterMoveCopy(name: string): MoveCopy {
  return moveCopy(name);
}

function program(
  key: string,
  title: string,
  rows: Array<[elementType: string, name: string]>,
): StarterProgram {
  return {
    key,
    title,
    moves: rows.map(([elementType, name], i) => ({
      name,
      elementType,
      ...moveCopy(name),
      position: i + 1,
    })),
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
