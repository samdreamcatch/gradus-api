/**
 * Writes docs/api/design-tokens.json from src/styles.css. Run with
 * `bun run design-tokens`. CI re-runs this and fails the build if the
 * committed file would change (see .github/workflows/node.js.yml), per
 * docs/ios/PRD.md §8.2 / §9.6. The conversion itself lives in
 * scripts/lib/design-tokens.ts so it can be unit-tested.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildDesignTokens } from "./lib/design-tokens";

const cssPath = resolve(__dirname, "../src/styles.css");
const outPath = resolve(__dirname, "../docs/api/design-tokens.json");

const tokens = buildDesignTokens(readFileSync(cssPath, "utf8"));
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(tokens, null, 2) + "\n");

console.log(
  `Wrote ${outPath} (${Object.keys(tokens.colors).length} colors, ${Object.keys(tokens.numbers).length} numbers)`,
);
