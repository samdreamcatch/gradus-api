/**
 * Writes docs/api/vectors/message-rules.json from src/lib/message-rules.ts
 * (the source of truth). Run after any change to the rules or the cases:
 *
 *   bun scripts/export-message-rules-vector.ts
 */
import { writeFileSync } from "node:fs";
import { MESSAGE_RULE_SET, checkMessage } from "../src/lib/message-rules";
import { MESSAGE_RULE_CASES } from "../src/lib/message-rules.cases";

const vector = {
  description:
    "The message check (PRD decision #64). The first case carries the whole rule set (input { list: 'rules' }); the apps bundle this file and run the same engine as checkMessage. Every other case is a message and the one match the product acts on, or null when it passes. Normalization and matching are specified in the header of the source file.",
  source: "src/lib/message-rules.ts",
  cases: [
    { input: { list: "rules" }, expected: MESSAGE_RULE_SET },
    ...MESSAGE_RULE_CASES.map(([text]) => {
      const m = checkMessage(text);
      return { input: { text }, expected: m ? { category: m.category, ruleId: m.ruleId } : null };
    }),
  ],
};

writeFileSync("docs/api/vectors/message-rules.json", JSON.stringify(vector, null, 2) + "\n");
console.log(`Wrote ${vector.cases.length - 1} cases and ${MESSAGE_RULE_SET.rules.length} rules.`);
