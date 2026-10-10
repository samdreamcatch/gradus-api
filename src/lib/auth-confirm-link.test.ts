import { describe, expect, it } from "bun:test";
import { authConfirmUrl, isAuthConfirmType } from "./auth-confirm-link";

const SITE = "https://gradus.training";
const verify = (params: string) =>
  `https://sdqfaqxmdmujxqhwlqdi.supabase.co/auth/v1/verify?${params}`;

describe("authConfirmUrl", () => {
  it("turns a reset link into gradus.training/auth/confirm with the same code", () => {
    expect(
      authConfirmUrl(
        verify(
          "redirect_to=https%3A%2F%2Fgradus.training%2Freset-password&token=5a1ee81f874196b9&type=recovery",
        ),
        SITE,
      ),
    ).toBe("https://gradus.training/auth/confirm?token_hash=5a1ee81f874196b9&type=recovery");
  });

  it("does the same for an email change", () => {
    expect(authConfirmUrl(verify("token=abc&type=email_change"), SITE)).toBe(
      "https://gradus.training/auth/confirm?token_hash=abc&type=email_change",
    );
  });

  it("leaves anything it doesn't recognize alone, so the email keeps a working link", () => {
    for (const url of [
      verify("token=abc&type=signup"),
      verify("type=recovery"),
      "https://sdqfaqxmdmujxqhwlqdi.supabase.co/auth/v1/other?token=abc&type=recovery",
      "not a url",
    ]) {
      expect(authConfirmUrl(url, SITE)).toBe(url);
    }
    expect(authConfirmUrl(undefined, SITE)).toBeUndefined();
  });
});

describe("isAuthConfirmType", () => {
  it("knows only reset and email change", () => {
    expect(isAuthConfirmType("recovery")).toBe(true);
    expect(isAuthConfirmType("email_change")).toBe(true);
    expect(isAuthConfirmType("signup")).toBe(false);
    expect(isAuthConfirmType(null)).toBe(false);
  });
});
