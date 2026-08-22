import { queryOptions } from "@tanstack/react-query";

import { getCoachRoster } from "@/lib/coach-roster.functions";

export const rosterQueryOptions = queryOptions({
  queryKey: ["coach", "roster"],
  queryFn: () => getCoachRoster(),
});
