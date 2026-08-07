import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getCoachInviteCode, rotateCoachInviteCode } from "@/lib/coach-invite.functions";

export const coachInviteQueryOptions = queryOptions({
  queryKey: ["coach-invite"],
  queryFn: () => getCoachInviteCode(),
});

export function useCoachInvite() {
  return useQuery(coachInviteQueryOptions);
}

export function useRotateCoachInvite() {
  const fn = useServerFn(rotateCoachInviteCode);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => fn(),
    onSuccess: (data) => {
      qc.setQueryData(["coach-invite"], data);
    },
  });
}
