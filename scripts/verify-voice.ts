/**
 * Manual verification of the voice structuring step against a corpus of
 * realistic coaching dictations (`scripts/voice-corpus.json`).
 *
 * Makes real AI Gateway calls; not part of CI. No database access, no plans
 * created — it only reports what the structuring step produced.
 *
 *   bun run scripts/verify-voice.ts            # all cases, 3 runs each
 *   bun run scripts/verify-voice.ts --runs 1   # quick pass
 *   bun run scripts/verify-voice.ts --case long-ten-move
 */
import corpus from "./voice-corpus.json" with { type: "json" };
import { slotTranscript, type LibraryMove, type ParseContext } from "../src/lib/voice.server";

type Case = {
  id: string;
  mode: "create" | "edit";
  transcript: string;
  expect: { minMoves: number; athlete?: string; title?: boolean; unresolvedAthlete?: boolean };
  currentPlan?: ParseContext["currentPlan"];
};

const args = process.argv.slice(2);
const argValue = (flag: string) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const runs = Number(argValue("--runs") ?? 3);
const only = argValue("--case");

const library: LibraryMove[] = corpus.library.map((m, i) => ({
  id: `lib-${i}`,
  name: m.name,
  category: m.category,
  description: "",
  cue: "",
  why: "",
  defaultTargetKind: "reps",
  defaultTargetValue: 10,
}));

const athletes = corpus.athletes.map((name, i) => ({ id: `ath-${i}`, name }));

const cases = (corpus.cases as Case[]).filter((c) => !only || c.id === only);

type Row = {
  id: string;
  ok: number;
  total: number;
  moves: number[];
  notes: string[];
};

const rows: Row[] = [];

for (const c of cases) {
  const row: Row = { id: c.id, ok: 0, total: 0, moves: [], notes: [] };
  for (let run = 0; run < runs; run++) {
    row.total++;
    const ctx: ParseContext = {
      mode: c.mode,
      transcript: c.transcript,
      athletes,
      library,
      currentPlan: c.currentPlan,
    };
    try {
      const slots = await slotTranscript(ctx).catch(async (e) => {
        row.notes.push(`retry(simple) after: ${(e as Error).message}`);
        return slotTranscript(ctx, "simple");
      });
      const moveCount = slots.moves?.length ?? 0;
      row.moves.push(moveCount);

      const problems: string[] = [];
      if (moveCount < c.expect.minMoves) {
        problems.push(`expected >=${c.expect.minMoves} moves, got ${moveCount}`);
      }
      if ((slots.moves ?? []).some((m) => !m.name && !m.matchExistingMoveId)) {
        problems.push("a move has no name");
      }
      if (c.expect.athlete && !(slots.athleteName ?? "").includes(c.expect.athlete)) {
        problems.push(`athlete "${c.expect.athlete}" not captured (got ${slots.athleteName})`);
      }
      if (c.expect.title && !slots.title) problems.push("no title");
      if (c.expect.unresolvedAthlete && !slots.athleteName) {
        problems.push("unknown athlete name dropped entirely");
      }
      if (c.mode === "edit" && c.currentPlan) {
        const validIds = new Set(c.currentPlan.moves.map((m) => m.id));
        if ((slots.moves ?? []).some((m) => m.matchExistingMoveId && !validIds.has(m.matchExistingMoveId))) {
          problems.push("invented an existing-move id");
        }
      }

      if (problems.length === 0) row.ok++;
      else row.notes.push(problems.join("; "));
    } catch (e) {
      row.moves.push(0);
      row.notes.push(`threw: ${(e as Error).message}`);
    }
  }
  rows.push(row);
  const status = row.ok === row.total ? "PASS" : row.ok > 0 ? "FLAKY" : "FAIL";
  console.log(
    `${status.padEnd(5)} ${row.id.padEnd(24)} ${row.ok}/${row.total}  moves=[${row.moves.join(",")}]` +
      (row.notes.length ? `\n      ${[...new Set(row.notes)].join("\n      ")}` : ""),
  );
}

const failures = rows.filter((r) => r.ok === 0);
const flaky = rows.filter((r) => r.ok > 0 && r.ok < r.total);
console.log(
  `\n${rows.length - failures.length - flaky.length} pass, ${flaky.length} flaky, ${failures.length} fail (${runs} runs each)`,
);
if (failures.length) process.exit(1);
