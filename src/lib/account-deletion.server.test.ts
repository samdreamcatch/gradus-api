import { describe, expect, it } from "bun:test";
import {
  DELETE_CONFIRM_PHRASE,
  deleteAccountInput,
  isDeleteConfirmed,
} from "./account-deletion.server";

describe("isDeleteConfirmed", () => {
  it("accepts the phrase regardless of case and surrounding whitespace", () => {
    expect(isDeleteConfirmed(DELETE_CONFIRM_PHRASE)).toBe(true);
    expect(isDeleteConfirmed("delete account")).toBe(true);
    expect(isDeleteConfirmed(" DELETE ACCOUNT ")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isDeleteConfirmed("nope")).toBe(false);
    expect(isDeleteConfirmed("")).toBe(false);
    expect(isDeleteConfirmed("DELETE")).toBe(false);
  });
});

describe("deleteAccountInput", () => {
  it("defaults minorChoices to an empty list", () => {
    expect(deleteAccountInput.parse({ confirmPhrase: "x" })).toEqual({
      confirmPhrase: "x",
      minorChoices: [],
    });
  });

  it("requires a non-empty phrase and uuid athlete ids with a keep/delete action", () => {
    expect(deleteAccountInput.safeParse({ confirmPhrase: "" }).success).toBe(false);
    expect(
      deleteAccountInput.safeParse({
        confirmPhrase: "x",
        minorChoices: [{ athleteId: "not-a-uuid", action: "keep" }],
      }).success,
    ).toBe(false);
    expect(
      deleteAccountInput.safeParse({
        confirmPhrase: "x",
        minorChoices: [{ athleteId: "8b1a9c2e-3f4d-4e5f-8a6b-7c8d9e0f1a2b", action: "purge" }],
      }).success,
    ).toBe(false);
    expect(
      deleteAccountInput.safeParse({
        confirmPhrase: "x",
        minorChoices: [{ athleteId: "8b1a9c2e-3f4d-4e5f-8a6b-7c8d9e0f1a2b", action: "delete" }],
      }).success,
    ).toBe(true);
  });
});
