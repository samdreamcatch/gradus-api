import { describe, expect, it } from "bun:test";
import {
  applyLibrary,
  findLibraryMove,
  libraryIndex,
  withAddition,
  type LibraryMove,
} from "./plan-draft-library";

const LIB: LibraryMove[] = [
  {
    name: "Bump and Run",
    category: "Short game",
    description: "A low chip that lands short and rolls to the hole.",
    cue: "Hands ahead, small swing.",
    why: "The safest shot from just off the green.",
    defaultTargetKind: "reps",
    defaultTargetValue: 12,
  },
  {
    name: "Lag Putting",
    category: "Putting",
    description: "",
    cue: "",
    why: "",
    defaultTargetKind: "mins",
    defaultTargetValue: 5,
  },
];

describe("findLibraryMove", () => {
  it("takes the model's libraryName, else the move's own name, case-insensitively", () => {
    expect(
      findLibraryMove(
        {
          libraryName: "bump and run",
          name: "Low chip",
          description: "",
          cue: "",
          why: "",
          targetKind: "reps",
          targetValue: null,
        },
        libraryIndex(LIB),
      )?.name,
    ).toBe("Bump and Run");
    expect(
      findLibraryMove(
        {
          libraryName: null,
          name: " LAG PUTTING ",
          description: "",
          cue: "",
          why: "",
          targetKind: "reps",
          targetValue: null,
        },
        libraryIndex(LIB),
      )?.name,
    ).toBe("Lag Putting");
    expect(
      findLibraryMove(
        {
          libraryName: "Flop shot",
          name: "Flop shot",
          description: "",
          cue: "",
          why: "",
          targetKind: "reps",
          targetValue: null,
        },
        libraryIndex(LIB),
      ),
    ).toBeNull();
  });
});

describe("applyLibrary", () => {
  it("library wins on a matched move, the source's addition follows its description, and the source's count wins", () => {
    const [m] = applyLibrary(
      [
        {
          libraryName: "Bump and Run",
          name: "Bump & run under the handle",
          description: "Keep it under the Gobbler handle.",
          cue: "No click",
          why: "Rolls like a putt",
          targetKind: "reps",
          targetValue: 9,
        },
      ],
      LIB,
    );
    expect(m).toEqual({
      name: "Bump and Run",
      description:
        "A low chip that lands short and rolls to the hole. Keep it under the Gobbler handle.",
      cue: "Hands ahead, small swing.",
      why: "The safest shot from just off the green.",
      targetKind: "reps",
      targetValue: 9,
    });
  });

  it("library default wins when the source gave no count", () => {
    const [m] = applyLibrary(
      [
        {
          libraryName: "Bump and Run",
          name: "Bump and Run",
          description: "",
          cue: "",
          why: "",
          targetKind: "mins",
          targetValue: null,
        },
      ],
      LIB,
    );
    expect(m.targetKind).toBe("reps");
    expect(m.targetValue).toBe(12);
  });

  it("a library move with empty fields keeps the model's words for those fields", () => {
    const [m] = applyLibrary(
      [
        {
          libraryName: "Lag Putting",
          name: "Lag putting",
          description: "Roll long putts to a towel.",
          cue: "Easy pace.",
          why: "Avoids three-putts.",
          targetKind: "reps",
          targetValue: null,
        },
      ],
      LIB,
    );
    expect(m).toEqual({
      name: "Lag Putting",
      description: "Roll long putts to a towel.",
      cue: "Easy pace.",
      why: "Avoids three-putts.",
      targetKind: "mins",
      targetValue: 5,
    });
  });

  it("an unmatched move keeps the model's words and gets 10 reps only when the source gave nothing", () => {
    const [a, b] = applyLibrary(
      [
        {
          libraryName: null,
          name: "High shot",
          description: "Hit it over the handle.",
          cue: "Fly it.",
          why: "Learn height.",
          targetKind: "reps",
          targetValue: 3,
        },
        {
          libraryName: null,
          name: "Walk the line",
          description: "",
          cue: "",
          why: "",
          targetKind: "mins",
          targetValue: null,
        },
      ],
      LIB,
    );
    expect(a.targetValue).toBe(3);
    expect(a.name).toBe("High shot");
    expect(b).toMatchObject({ targetKind: "reps", targetValue: 10 });
  });
});

describe("withAddition", () => {
  it("appends the source's addition after the library text, once, with a full stop between", () => {
    expect(withAddition("A low chip that rolls", "Under the Gobbler handle.")).toBe(
      "A low chip that rolls. Under the Gobbler handle.",
    );
    expect(withAddition("A low chip that rolls.", "")).toBe("A low chip that rolls.");
    expect(withAddition("", "Under the handle.")).toBe("Under the handle.");
    expect(withAddition("Keep it under the handle.", "under the handle")).toBe(
      "Keep it under the handle.",
    );
  });
});
