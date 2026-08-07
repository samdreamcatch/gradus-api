import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  completeOnboarding,
  getCoachProfile,
  saveCoachLevels,
  saveCoachProfile,
} from "@/lib/coach-profile.functions";

export const coachProfileQueryOptions = queryOptions({
  queryKey: ["coach-profile"],
  queryFn: () => getCoachProfile(),
});

export function useCoachProfile() {
  return useQuery(coachProfileQueryOptions);
}

export function useSaveCoachProfile() {
  const fn = useServerFn(saveCoachProfile);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { firstName: string; lastName: string }) => fn({ data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["coach-profile"] }),
  });
}

export function useSaveCoachLevels() {
  const fn = useServerFn(saveCoachLevels);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { entries: { sport: string; levelKey: string; hoursPerWeek: number }[] }) =>
      fn({ data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["coach-profile"] }),
  });
}

export function useCompleteOnboarding() {
  const fn = useServerFn(completeOnboarding);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => fn(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["coach-profile"] }),
  });
}
