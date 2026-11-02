import { describe, expect, it } from "bun:test";
import { canRemoveClubAdmin, clubSeatStatus, seatGraceUntil } from "./club-seat-rules";

describe("club seat rules", () => {
  it("preserves a departing coach's 90-day grace", () => {
    expect(seatGraceUntil("2026-11-01T01:00:00.000Z")).toBe("2027-01-30T01:00:00.000Z");
  });
  it("a seat can be filled while the previous coach keeps their independent grace", () => {
    const departingGrace = seatGraceUntil("2026-11-01T01:00:00.000Z");
    expect(
      clubSeatStatus({
        coach_id: "replacement",
        released_at: null,
        grace_until: null,
        reserved_invite_id: null,
      }),
    ).toBe("filled");
    expect(departingGrace).toBe("2027-01-30T01:00:00.000Z");
  });
  it("refuses removal of the last owner", () => {
    expect(
      canRemoveClubAdmin(
        [
          { id: "owner", club_role: "owner" },
          { id: "admin", club_role: "admin" },
        ],
        "owner",
      ),
    ).toBe(false);
  });
  it("refuses removal of the last admin", () => {
    expect(canRemoveClubAdmin([{ id: "owner", club_role: "owner" }], "owner")).toBe(false);
  });
  it("allows removing an admin while an owner remains", () => {
    expect(
      canRemoveClubAdmin(
        [
          { id: "owner", club_role: "owner" },
          { id: "admin", club_role: "admin" },
        ],
        "admin",
      ),
    ).toBe(true);
  });
  it("reserved seats are not open seats", () => {
    expect(
      clubSeatStatus({
        coach_id: null,
        released_at: null,
        grace_until: null,
        reserved_invite_id: "invite",
      }),
    ).toBe("invited");
  });
});
