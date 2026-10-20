import { expect, it } from "bun:test";
import { PDFDocument } from "pdf-lib";
import { buildPolicyProof } from "./policy-proof.server";

it("includes every page of the original document after the sign-off records", async () => {
  const original = await PDFDocument.create();
  original.addPage();
  original.addPage();
  const bytes = await buildPolicyProof({
    club: "Test Club",
    title: "Safe Sport",
    version: 2,
    audiences: ["coach"],
    dueAt: null,
    requiredAt: "2026-10-20T00:00:00Z",
    sourceUrl: null,
    signers: [],
    history: [],
    versions: [],
    original: await original.save(),
  });
  const output = await PDFDocument.load(bytes);
  expect(output.getPageCount()).toBe(3);
});
