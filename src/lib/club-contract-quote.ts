export function proratedSeatCost(
  rateCents: number,
  seats: number,
  startsOn: string,
  endsOn: string,
  effectiveOn: string,
): number | null {
  const start = Date.parse(`${startsOn}T00:00:00Z`);
  const end = Date.parse(`${endsOn}T00:00:00Z`);
  const today = Date.parse(`${effectiveOn}T00:00:00Z`);
  if (
    ![start, end, today].every(Number.isFinite) ||
    today < start ||
    today > end ||
    end < start ||
    !Number.isInteger(seats) ||
    seats < 1 ||
    !Number.isInteger(rateCents) ||
    rateCents < 0
  )
    return null;
  return Math.round(
    (rateCents * seats * ((end - today) / 86400000 + 1)) / ((end - start) / 86400000 + 1),
  );
}

export function clubUserType(
  admin: boolean,
  occupiedSeat: boolean,
): "Admin" | "Coach" | "Unassigned" {
  return admin ? "Admin" : occupiedSeat ? "Coach" : "Unassigned";
}
