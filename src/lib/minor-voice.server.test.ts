import { describe, expect, it } from "bun:test";
import { ApiError } from "./api/errors";
import { assertVoiceAllowed, athleteVoiceAllowed } from "./minor-voice.server";
import { recordingClient } from "./recording-client.test-util";

// Voice is off for athletes under 18 (decision #48): judged per login, conservatively.

const clientWith = (rows: { birthdate: string | null }[]) =>
  recordingClient((call) => (call.table === "athletes" ? { data: rows } : undefined)).client;

describe("athleteVoiceAllowed", () => {
  it("is null for a login with no athlete row (a coach or a parent)", async () => {
    expect(await athleteVoiceAllowed(clientWith([]), "user-1")).toBeNull();
  });

  it("is true only when every athlete row is a confirmed adult", async () => {
    expect(await athleteVoiceAllowed(clientWith([{ birthdate: "1990-05-01" }]), "user-1")).toBe(
      true,
    );
    expect(await athleteVoiceAllowed(clientWith([{ birthdate: "2012-03-14" }]), "user-1")).toBe(
      false,
    );
    expect(await athleteVoiceAllowed(clientWith([{ birthdate: null }]), "user-1")).toBe(false);
    expect(await athleteVoiceAllowed(clientWith([{ birthdate: "not a date" }]), "user-1")).toBe(
      false,
    );
    expect(
      await athleteVoiceAllowed(
        clientWith([{ birthdate: "1990-05-01" }, { birthdate: "2012-03-14" }]),
        "user-1",
      ),
    ).toBe(false);
  });

  it("filters by the login", async () => {
    const { client, calls } = recordingClient(() => ({ data: [] }));
    await athleteVoiceAllowed(client, "user-7");
    expect(
      calls[0].filters.some((f) => f[0] === "eq" && f[1] === "user_id" && f[2] === "user-7"),
    ).toBe(true);
  });
});

describe("assertVoiceAllowed", () => {
  it("answers 403 text_only for a minor and passes adults and non-athletes", async () => {
    let err: unknown = null;
    try {
      await assertVoiceAllowed(clientWith([{ birthdate: "2012-03-14" }]), "user-1");
    } catch (e) {
      err = e;
    }
    expect(err instanceof ApiError && err.code === "text_only" && err.status === 403).toBe(true);
    await assertVoiceAllowed(clientWith([{ birthdate: "1990-05-01" }]), "user-1");
    await assertVoiceAllowed(clientWith([]), "user-1");
  });
});
