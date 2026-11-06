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
    takeoff:
      "a sweeping edge jump off the back inside edge, powered by a wide free-leg swing rather than a toe pick",
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
    takeoff:
      "a toe-assisted jump off the back outside edge, rotating against the direction of the entry curve",
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
  "Waltz Jump": {
    description:
      "A half-rotation jump from a forward outside edge to a backward outside edge — the first jump every skater learns, and the shape of the axel.",
    cue: "Step forward onto a bending outside edge, swing the free leg through, land on a bent knee with the arms checked.",
    why: "Every edge jump and the axel itself grow out of this takeoff and landing; a clean waltz jump is the foundation of the whole jump list.",
  },
  "Half Flip": {
    description:
      "A half-rotation toe jump off the back inside edge, landing forward on the toe pick of the other foot.",
    cue: "Reach the pick straight back, vault up, and land light on the toe facing forward.",
    why: "Teaches the picking action and the air position that the full flip and lutz depend on.",
  },
  "Waltz Jump + Single Toeloop": {
    description:
      "Land the waltz jump on a strong back outside edge, then pick straight into a single toe loop with no steps in between.",
    cue: "Ride the landing edge for a count, reach the pick back, keep the arms quiet.",
    why: "The first combination most skaters learn; it proves the landing edge is strong enough to launch another jump.",
  },
  "Two-Foot Spin": {
    description: "A spin on both feet, upright, arms pulling in to speed it up.",
    cue: "Feet under the hips, arms out to start, then pull in and feel the speed come.",
    why: "Finds the center of a spin before balancing on one foot; everything spinning starts here.",
  },
  "Upright Spin": {
    description:
      "A one-foot upright spin on the back inside edge of the skating foot, free leg crossed in front.",
    cue: "Push into the spin on a bent knee, rise as the free leg crosses, stay over the ball of the foot.",
    why: "The basic one-foot spin that every sit, camel, and combination spin builds on.",
  },
  "Scratch Spin": {
    description:
      "A fast upright spin with the free foot crossed low and pulled in tight, finishing on the toe pick.",
    cue: "Cross low, squeeze the thighs together, pull the arms in last for the speed.",
    why: "The speed and centering learned here carry into every spin, and it closes a program with a flourish.",
  },
  "Forward Spiral": {
    description:
      "A long glide on one foot with the free leg held at or above hip height behind you.",
    cue: "Lift from the hip, keep the back flat and the chest up, hold the glide to the end of the edge.",
    why: "Builds balance and flexibility on a moving edge, and shows judges stretch and control.",
  },
  "Spiral Sequence": {
    description:
      "Two or more spirals on different edges, linked across the ice as one continuous pattern.",
    cue: "Hold each position until the edge runs out; make the change between them part of the pattern.",
    why: "A required element at the lower free skate levels and the clearest display of edge quality and extension.",
  },
  "Backward Crossovers": {
    description:
      "Power stroking backward on a curve, crossing the outside foot over the inside one.",
    cue: "Push with the whole blade, knees bent, look over the shoulder in the direction of travel.",
    why: "Backward speed is what sets up every jump entry; strong crossovers are where program speed comes from.",
  },
  "Bunny Hop": {
    description:
      "A small forward hop from one foot, landing on the toe pick of the other and pushing onto the first.",
    cue: "Swing the free leg forward, hop up not out, land light on the pick and glide away.",
    why: "The first jump off the ice: teaches a quick, balanced takeoff and a soft landing.",
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

/*
 * Pre-Juvenile and below: representative programs within each level's
 * well-balanced program limits (no double axel or triples; pre-preliminary
 * and basic skills singles only). Before 2026-11-05 all five of these
 * levels were handed the Juvenile program, which opens with a double axel.
 */

const BASIC_SKILLS_FS = program("fs_basic_skills_fs", "Basic Skills — Free Skate", [
  ["Jump", "Bunny Hop"],
  ["Jump", "Waltz Jump"],
  ["Jump", "Half Flip"],
  ["Jump", "Single Salchow"],
  ["Jump", "Single Toeloop"],
  ["Jump combination", "Waltz Jump + Single Toeloop"],
  ["Spin", "Two-Foot Spin"],
  ["Spin", "Upright Spin"],
  ["Spiral", "Forward Spiral"],
  ["Stroking", "Backward Crossovers"],
]);

// Adult Bronze: singles only, no axel (the axel arrives at Silver).
const ADULT_BRONZE_FS = program("fs_adult_bronze_fs", "Adult Bronze — Free Skate", [
  ["Solo jump", "Single Salchow"],
  ["Solo jump", "Single Toeloop"],
  ["Solo jump", "Single Loop"],
  ["Solo jump", "Single Flip"],
  ["Jump combination", "Single Salchow + Single Toeloop"],
  ["Spin, one position", "Upright Spin"],
  ["Spin, one position", "Sit Spin"],
  ["Spiral sequence", "Spiral Sequence"],
  ["Step sequence", "Step Sequence"],
]);

const PRE_PRELIMINARY_FS = program("fs_pre_preliminary_fs", "Pre-Preliminary — Free Skate", [
  ["Axel-type jump", "Single Axel"],
  ["Solo jump", "Single Lutz"],
  ["Solo jump", "Single Flip"],
  ["Jump combination", "Single Loop + Single Loop"],
  ["Spin, one position", "Scratch Spin"],
  ["Spin combination", "Combination Spin"],
  ["Spiral sequence", "Spiral Sequence"],
  ["Step sequence", "Step Sequence"],
]);

const PRELIMINARY_FS = program("fs_preliminary_fs", "Preliminary — Free Skate", [
  ["Axel-type jump", "Single Axel"],
  ["Solo jump", "Double Salchow"],
  ["Solo jump", "Single Lutz"],
  ["Jump combination", "Double Toeloop + Single Toeloop"],
  ["Spin, one position", "Sit Spin"],
  ["Spin combination, change of foot", "Change Foot Combo Spin"],
  ["Step sequence", "Step Sequence"],
]);

const PRE_JUVENILE_FS = program("fs_pre_juvenile_fs", "Pre-Juvenile — Free Skate", [
  ["Axel-type jump", "Single Axel"],
  ["Solo jump", "Double Loop"],
  ["Solo jump", "Double Flip"],
  ["Jump combination", "Double Salchow + Double Toeloop"],
  ["Jump combination", "Double Flip + Double Toeloop"],
  ["Spin, one position", "Camel Spin"],
  ["Spin combination, change of foot", "Change Foot Combo Spin"],
  ["Step sequence", "Step Sequence"],
]);

// Juvenile: double axel permitted, no triples (the chart's triple salchow was out of level).
const JUVENILE_FS = program("fs_juvenile_fs", "Juvenile — Free Skate", [
  ["Axel-type jump", "Double Axel"],
  ["Solo jump", "Double Lutz"],
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
    basic_skills: [BASIC_SKILLS_FS],
    pre_preliminary: [PRE_PRELIMINARY_FS],
    preliminary: [PRELIMINARY_FS],
    pre_juvenile: [PRE_JUVENILE_FS],
    juvenile: [JUVENILE_FS],
    intermediate: [INTERMEDIATE_SP, INTERMEDIATE_FS],
    novice: [NOVICE_SP, NOVICE_FS],
    junior: [JUNIOR_SP, JUNIOR_FS],
    senior: [SENIOR_SP, SENIOR_FS],
    // Excel (non-qualifying) track: the same element limits as the standard
    // level of the same name, one level earlier at the bottom (Excel Beginner
    // has no axel, High Beginner does).
    excel_beginner: [BASIC_SKILLS_FS],
    excel_high_beginner: [PRE_PRELIMINARY_FS],
    excel_pre_preliminary: [PRE_PRELIMINARY_FS],
    excel_preliminary: [PRELIMINARY_FS],
    excel_pre_juvenile: [PRE_JUVENILE_FS],
    excel_juvenile: [JUVENILE_FS],
    excel_intermediate: [INTERMEDIATE_SP, INTERMEDIATE_FS],
    excel_novice: [NOVICE_SP, NOVICE_FS],
    excel_junior: [JUNIOR_SP, JUNIOR_FS],
    excel_senior: [SENIOR_SP, SENIOR_FS],
    // Adult track: Pre-Bronze is the beginner list; Bronze has its own
    // (singles, no axel); Silver adds the axel, Gold doubles, Masters more.
    adult_pre_bronze: [BASIC_SKILLS_FS],
    adult_bronze: [ADULT_BRONZE_FS],
    adult_silver: [PRE_PRELIMINARY_FS],
    adult_gold: [PRELIMINARY_FS],
    adult_masters: [PRE_JUVENILE_FS],
  },
};

/**
 * The programs for a sport + level. A level the sport doesn't map produces
 * nothing: a wrong-level program is worse than none (every unmapped level
 * used to fall back to Juvenile).
 */
export function resolveStarterPrograms(sport: string, levelKey: string): StarterProgram[] {
  return STARTER_PROGRAMS[sport]?.[levelKey] ?? [];
}

/** Every title this sport could ever produce, at any level. */
export function starterTitlesForSport(sport: string): Set<string> {
  const titles = new Set<string>();
  for (const programs of Object.values(STARTER_PROGRAMS[sport] ?? {})) {
    for (const p of programs) titles.add(p.title);
  }
  return titles;
}

/**
 * Which of an athlete's existing Gradus plan titles belong to this sport but
 * to a level other than the one on file — seeded before the lower levels had
 * programs of their own, or before a level was corrected. Only these are
 * candidates for replacement; the caller still checks nothing was logged.
 */
export function staleStarterTitles(
  existingTitles: Iterable<string>,
  sport: string,
  levelKey: string,
): string[] {
  const sportTitles = starterTitlesForSport(sport);
  const current = new Set(resolveStarterPrograms(sport, levelKey).map((p) => p.title));
  return Array.from(new Set(existingTitles)).filter((t) => sportTitles.has(t) && !current.has(t));
}
