import { describe, expect, it } from "bun:test";
import {
  getCoachSetupChecklist,
  normalizeCoachSetupChecklist,
  updateCoachSetupChecklist,
  updateCoachSetupChecklistInput,
} from "./coach-setup-checklist.server";

const NONE_DONE = {
  identityVerification: false,
  payoutSetup: false,
  uploadProfilePhoto: false,
  saveFirstPlan: false,
};

type Client = Parameters<typeof getCoachSetupChecklist>[0];

/** `.from().select().eq().maybeSingle()` returns `row`; `.rpc()` records its call and returns `merged`. */
function fakeClient(row: Record<string, unknown> | null, merged: unknown = null) {
  const rpcCalls: { fn: string; args: unknown }[] = [];
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: () => Promise.resolve({ data: row, error: null }),
  };
  const client = {
    from: () => chain,
    rpc: (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      return Promise.resolve({ data: merged, error: null });
    },
  } as unknown as Client;
  return { client, rpcCalls };
}

describe("updateCoachSetupChecklistInput", () => {
  it("takes one step or several", () => {
    expect(
      updateCoachSetupChecklistInput.safeParse({ checklist: { identityVerification: true } })
        .success,
    ).toBe(true);
    expect(
      updateCoachSetupChecklistInput.safeParse({
        checklist: { payoutSetup: true, saveFirstPlan: false },
      }).success,
    ).toBe(true);
  });

  it("refuses no step, an unknown step, or a value that isn't a boolean", () => {
    for (const checklist of [{}, { firstLesson: true }, { payoutSetup: "yes" }]) {
      expect(updateCoachSetupChecklistInput.safeParse({ checklist }).success).toBe(false);
    }
    expect(updateCoachSetupChecklistInput.safeParse({}).success).toBe(false);
  });
});

describe("normalizeCoachSetupChecklist", () => {
  it("fills every step, false where missing or not a boolean", () => {
    expect(normalizeCoachSetupChecklist(null)).toEqual(NONE_DONE);
    expect(normalizeCoachSetupChecklist({ payoutSetup: true, saveFirstPlan: "true" })).toEqual({
      ...NONE_DONE,
      payoutSetup: true,
    });
  });
});

describe("getCoachSetupChecklist", () => {
  it("reads the coach's stored steps, and all false for a user with no coach profile", async () => {
    const stored = fakeClient({ checklist: { ...NONE_DONE, uploadProfilePhoto: true } });
    expect(await getCoachSetupChecklist(stored.client, "u1")).toEqual({
      ...NONE_DONE,
      uploadProfilePhoto: true,
    });
    expect(await getCoachSetupChecklist(fakeClient(null).client, "u2")).toEqual(NONE_DONE);
  });
});

describe("updateCoachSetupChecklist", () => {
  it("merges only the sent step and returns the whole checklist", async () => {
    const { client, rpcCalls } = fakeClient(null, { ...NONE_DONE, identityVerification: true });
    expect(
      await updateCoachSetupChecklist(client, { checklist: { identityVerification: true } }),
    ).toEqual({ checklist: { ...NONE_DONE, identityVerification: true } });
    expect(rpcCalls).toEqual([
      { fn: "merge_coach_checklist", args: { _patch: { identityVerification: true } } },
    ]);
  });

  it("answers 404 when the caller has no coach profile", async () => {
    const { client } = fakeClient(null, null);
    await expect(
      updateCoachSetupChecklist(client, { checklist: { payoutSetup: true } }),
    ).rejects.toThrow("Coach profile not found.");
  });
});
