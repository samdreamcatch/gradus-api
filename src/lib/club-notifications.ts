export type NotificationAbout = "athletes" | "coaches" | "library";
export type NotificationStatus = "needs_action" | "in_review" | "resolved";
export type ClubNotification = {
  id: string;
  kind: string;
  about: NotificationAbout;
  title: string;
  subject: string;
  coach: string | null;
  status: NotificationStatus;
  openedAt: string;
  resolvedAt: string | null;
  resolution: string | null;
  unread: boolean;
  goTo: string;
};

export function notificationTotals(rows: ClubNotification[], now = new Date()) {
  const open = rows.filter((r) => r.status !== "resolved");
  const ages = open.map((r) => Math.max(0, (now.getTime() - new Date(r.openedAt).getTime()) / 86400000)).sort((a, b) => a - b);
  const middle = Math.floor(ages.length / 2);
  return {
    open: open.length,
    unread: rows.filter((r) => r.unread).length,
    averageDays: ages.length ? ages.reduce((a, b) => a + b, 0) / ages.length : null,
    medianDays: ages.length ? ages.length % 2 ? ages[middle] : ((ages[middle - 1] ?? 0) + (ages[middle] ?? 0)) / 2 : null,
  };
}

/** Home receives counts, never the feed's athlete subjects or identifiers. */
export function notificationRollup(rows: ClubNotification[]) {
  const counts = new Map<string, number>();
  for (const row of rows) if (row.status !== "resolved") counts.set(row.kind, (counts.get(row.kind) ?? 0) + 1);
  return [...counts].map(([kind, count]) => ({ kind, count }));
}