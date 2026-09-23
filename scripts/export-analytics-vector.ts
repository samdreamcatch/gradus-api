/**
 * Writes docs/api/vectors/analytics-events.json from the allow-list in
 * src/lib/analytics.server.ts (PRD §6.12, A1): the event names, the areas,
 * and each event's allowed props, for the iOS tracker (A2) to pin against.
 * Run: bun scripts/export-analytics-vector.ts
 */
import { writeFileSync } from "node:fs";
import { ANALYTICS_AREAS, ANALYTICS_EVENTS, EVENT_PROPS } from "../src/lib/analytics.server";

const cases = [
  { name: "areas", input: { list: "areas" }, expected: [...ANALYTICS_AREAS] },
  ...ANALYTICS_EVENTS.map((event) => ({
    name: event,
    input: { event },
    expected: { props: Object.keys(EVENT_PROPS[event].shape).sort() },
  })),
];

writeFileSync(
  "docs/api/vectors/analytics-events.json",
  JSON.stringify(
    {
      description:
        "Usage analytics allow-list (PRD §6.12): the areas a screen belongs to, the event names, and the props each event may carry. Anything else is dropped server-side.",
      source: "src/lib/analytics.server.ts",
      cases,
    },
    null,
    2,
  ) + "\n",
);
