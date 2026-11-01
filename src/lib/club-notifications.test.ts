import { describe, it, expect } from "bun:test";
import {
  notificationTotals,
  notificationRollup,
  type ClubNotification,
} from "./club-notifications";
const row = (
  id: string,
  openedAt: string,
  status: ClubNotification["status"] = "needs_action",
): ClubNotification => ({
  id,
  openedAt,
  status,
  kind: "parent_not_joined",
  about: "athletes",
  title: "Parent not joined",
  subject: "Private athlete",
  coach: "Coach",
  resolvedAt: null,
  resolution: null,
  unread: true,
  goTo: "/org-admin/notifications",
});
describe("club notification rules", () => {
  it("excludes resolved items from open ages and counts", () => {
    const totals = notificationTotals(
      [row("1", "2026-10-28"), row("2", "2026-10-30"), row("3", "2026-10-01", "resolved")],
      new Date("2026-11-01"),
    );
    expect(totals.open).toBe(2);
    expect(totals.averageDays).toBe(3);
    expect(totals.medianDays).toBe(3);
  });
  it("keeps athlete names and identifiers out of Home rollups", () => {
    expect(notificationRollup([row("private-athlete-id", "2026-10-28")])).toEqual([
      { kind: "parent_not_joined", count: 1 },
    ]);
  });
  it("shows no age statistic when no notifications are open", () => {
    expect(notificationTotals([]).medianDays).toBeNull();
  });
});
