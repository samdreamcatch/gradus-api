/**
 * Seeded results for the demo competition. The demo's `ijs_base_url` points at
 * `example.invalid`, so there is nothing to scrape — linking a demo skater
 * reads these fixtures instead, which keeps the post-event linking, results,
 * and draft-plan flows demonstrable end to end.
 */

import { normalizeName } from "./board-types";
import type { SkaterProtocol } from "./board-types";

export const DEMO_RESULTS_HOST = "example.invalid";

export interface DemoResult {
  eventName: string;
  segment: string;
  rink: string;
  eventFile: string;
  startOrder: number | null;
  placement: string;
  segmentScore: string;
  totalScore: string;
  protocol: SkaterProtocol;
}

const TOBIAS_SHORT: SkaterProtocol = {
  total: "48.62",
  elementsScore: "25.14",
  componentsScore: "23.48",
  deductionsScore: "0.00",
  elements: [
    { planned: "2A", executed: "2A", baseValue: "3.30", goe: "0.33", score: "3.63" },
    { planned: "3T", executed: "3T<", baseValue: "3.36", goe: "-0.90", score: "2.46" },
    { planned: "3S", executed: "3S", baseValue: "4.30", goe: "0.21", score: "4.51" },
    { planned: "CSSp3", executed: "CSSp2", baseValue: "2.30", goe: "-0.23", score: "2.07" },
    { planned: "StSq2", executed: "StSq2", baseValue: "2.60", goe: "0.26", score: "2.86" },
    { planned: "2Lz+2Lo", executed: "2Lz+2Lo", baseValue: "3.80", goe: "0.15", score: "3.95" },
    { planned: "CCoSp4", executed: "CCoSp3", baseValue: "3.00", goe: "-0.34", score: "2.66" },
  ],
  elementsTotal: { baseValue: "22.66", score: "25.14" },
  components: [
    { name: "Composition", unfactored: "5.00", factor: "1.00" },
    { name: "Presentation", unfactored: "4.75", factor: "1.00" },
    { name: "Skating Skills", unfactored: "5.25", factor: "1.00" },
  ],
  deductions: [],
};

const TOBIAS_FREE: SkaterProtocol = {
  total: "78.15",
  elementsScore: "41.15",
  componentsScore: "38.00",
  deductionsScore: "1.00",
  elements: [
    { planned: "3S", executed: "3S", baseValue: "4.30", goe: "0.43", score: "4.73" },
    { planned: "3T+2T", executed: "3T+2T", baseValue: "5.50", goe: "0.22", score: "5.72" },
    { planned: "2A", executed: "2A", baseValue: "3.30", goe: "0.30", score: "3.60" },
    { planned: "3Lo", executed: "3Lo<<", baseValue: "1.80", goe: "-0.90", score: "0.90" },
    { planned: "FCCoSp4", executed: "FCCoSp3", baseValue: "3.00", goe: "-0.20", score: "2.80" },
    { planned: "StSq3", executed: "StSq2", baseValue: "2.60", goe: "0.13", score: "2.73" },
    { planned: "2A+2T", executed: "2A+2T", baseValue: "4.60", goe: "0.23", score: "4.83" },
    { planned: "LSp4", executed: "LSp4", baseValue: "2.70", goe: "0.27", score: "2.97" },
  ],
  elementsTotal: { baseValue: "27.80", score: "41.15" },
  components: [
    { name: "Composition", unfactored: "5.75", factor: "1.60" },
    { name: "Presentation", unfactored: "5.50", factor: "1.60" },
    { name: "Skating Skills", unfactored: "6.00", factor: "1.60" },
  ],
  deductions: [{ name: "Falls", value: "-1.00" }],
};

const JAMIE_SHORT: SkaterProtocol = {
  total: "54.18",
  elementsScore: "29.80",
  componentsScore: "24.38",
  deductionsScore: "0.00",
  elements: [
    { planned: "2A", executed: "2A", baseValue: "3.30", goe: "0.44", score: "3.74" },
    { planned: "3T", executed: "3T<", baseValue: "3.36", goe: "-0.85", score: "2.51" },
    { planned: "FCSp3", executed: "FCSp3", baseValue: "2.80", goe: "0.28", score: "3.08" },
    { planned: "3S", executed: "3S", baseValue: "4.30", goe: "0.43", score: "4.73" },
    { planned: "StSq2", executed: "StSq2", baseValue: "2.60", goe: "0.35", score: "2.95" },
    { planned: "2Lz+2Lo", executed: "2Lz+2Lo", baseValue: "3.80", goe: "0.21", score: "4.01" },
    { planned: "CCoSp4", executed: "CCoSp4", baseValue: "3.50", goe: "0.47", score: "3.97" },
  ],
  elementsTotal: { baseValue: "23.66", score: "29.80" },
  components: [
    { name: "Composition", unfactored: "5.25", factor: "1.00" },
    { name: "Presentation", unfactored: "5.00", factor: "1.00" },
    { name: "Skating Skills", unfactored: "5.50", factor: "1.00" },
  ],
  deductions: [],
};

const JAMIE_FREE: SkaterProtocol = {
  total: "82.40",
  elementsScore: "44.30",
  componentsScore: "39.10",
  deductionsScore: "1.00",
  elements: [
    { planned: "3S", executed: "3S", baseValue: "4.30", goe: "0.60", score: "4.90" },
    { planned: "3T+2T", executed: "3T+2T", baseValue: "5.50", goe: "0.28", score: "5.78" },
    { planned: "2A", executed: "2A", baseValue: "3.30", goe: "0.33", score: "3.63" },
    { planned: "3Lo", executed: "3Lo<<", baseValue: "1.80", goe: "-0.90", score: "0.90" },
    { planned: "FCCoSp4", executed: "FCCoSp4", baseValue: "3.50", goe: "0.35", score: "3.85" },
    { planned: "StSq3", executed: "StSq3", baseValue: "3.30", goe: "0.44", score: "3.74" },
    { planned: "2A+2T", executed: "2A+2T", baseValue: "4.60", goe: "0.30", score: "4.90" },
    { planned: "LSp4", executed: "LSp4", baseValue: "2.70", goe: "0.36", score: "3.06" },
  ],
  elementsTotal: { baseValue: "29.00", score: "44.30" },
  components: [
    { name: "Composition", unfactored: "6.25", factor: "1.60" },
    { name: "Presentation", unfactored: "6.00", factor: "1.60" },
    { name: "Skating Skills", unfactored: "6.50", factor: "1.60" },
  ],
  deductions: [{ name: "Falls", value: "-1.00" }],
};

const DEMO_RESULTS: Record<string, DemoResult[]> = {
  [normalizeName("Jamie Gilmore")]: [
    {
      eventName: "Intermediate Ladies",
      segment: "Short Program",
      rink: "A Rink",
      eventFile: "d1.html",
      startOrder: 4,
      placement: "4",
      segmentScore: "54.18",
      totalScore: "54.18",
      protocol: JAMIE_SHORT,
    },
    {
      eventName: "Intermediate Ladies",
      segment: "Free Skate",
      rink: "A Rink",
      eventFile: "d2.html",
      startOrder: 11,
      placement: "2",
      segmentScore: "82.40",
      totalScore: "136.58",
      protocol: JAMIE_FREE,
    },
  ],
  [normalizeName("Tobias Fairbank")]: [

    {
      eventName: "Intermediate Men",
      segment: "Short Program",
      rink: "A Rink",
      eventFile: "d1.html",
      startOrder: 3,
      placement: "3",
      segmentScore: "48.62",
      totalScore: "48.62",
      protocol: TOBIAS_SHORT,
    },
    {
      eventName: "Intermediate Men",
      segment: "Free Skate",
      rink: "A Rink",
      eventFile: "d2.html",
      startOrder: 6,
      placement: "2",
      segmentScore: "78.15",
      totalScore: "126.77",
      protocol: TOBIAS_FREE,
    },
  ],
};

/** Seeded results for a demo skater, filtered to the requested event files. */
export function demoSkaterResults(skaterName: string, files: string[]): DemoResult[] {
  const rows = DEMO_RESULTS[normalizeName(skaterName)] ?? [];
  const wanted = new Set(files);
  return rows.filter((r) => wanted.has(r.eventFile));
}
