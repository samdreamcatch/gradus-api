import { describe, expect, it } from "bun:test";
import { proratedSeatCost, clubUserType } from "./club-contract-quote";
describe("club contract increases", () => {
  it("prorates the agreed per-seat term rate for the remaining days", () => {
    expect(proratedSeatCost(3100, 2, "2026-11-01", "2026-11-30", "2026-11-16")).toBe(3100);
    expect(proratedSeatCost(3100, 2, "2026-11-01", "2026-11-30", "2026-11-01")).toBe(6200);
    expect(proratedSeatCost(3100, 2, "2026-11-01", "2026-11-30", "2026-12-01")).toBeNull();
  });
  it("users without a contract seat are unassigned, while admins keep their role", () => {
    expect(clubUserType(false, false)).toBe("Unassigned");
    expect(clubUserType(false, true)).toBe("Coach");
    expect(clubUserType(true, false)).toBe("Admin");
  });
});