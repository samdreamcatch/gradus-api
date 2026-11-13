import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

const migration = readFileSync("drizzle/migrations/0042_unlimited_club_admins.sql", "utf8");

describe("club administrator capacity", () => {
  it("removes admin capacity enforcement without removing membership safeguards", () => {
    const guard = migration.split("CREATE OR REPLACE FUNCTION public.sync_club_seat_capacity")[0];
    expect(guard).not.toContain("admin_seats");
    expect(guard).not.toContain("No admin seat is available");
    expect(guard).toContain("The last club admin cannot be removed");
    expect(guard).toContain("The last club owner cannot be removed");
    expect(migration).toContain("IF NEW.coach_seats < used THEN");
    expect(migration).not.toContain("NEW.admin_seats < admins");
  });
});