export const CLUB_SEAT_GRACE_DAYS = 90;

export function seatGraceUntil(releasedAt: string): string {
  const date = new Date(releasedAt);
  date.setUTCDate(date.getUTCDate() + CLUB_SEAT_GRACE_DAYS);
  return date.toISOString();
}

export function clubSeatStatus(
  seat: {
    coach_id: string | null;
    released_at: string | null;
    grace_until: string | null;
    reserved_invite_id: string | null;
  },
  now = new Date(),
): "filled" | "grace" | "invited" | "open" {
  if (seat.coach_id && !seat.released_at) return "filled";
  if (seat.reserved_invite_id) return "invited";
  if (seat.grace_until && new Date(seat.grace_until) > now) return "grace";
  return "open";
}

export function canRemoveClubAdmin(
  admins: { id: string; club_role: string }[],
  id: string,
): boolean {
  const target = admins.find((admin) => admin.id === id);
  if (!target || admins.length <= 1) return false;
  return (
    target.club_role !== "owner" ||
    admins.some((admin) => admin.id !== id && admin.club_role === "owner")
  );
}
