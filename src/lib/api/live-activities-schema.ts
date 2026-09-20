import { z } from "zod";

/** `POST /live-activities/tokens` body (PRD §6.6 "Live Activities"). */
export const registerLiveActivityTokenInput = z.object({
  /** Hex token from ActivityKit: `pushToStartTokenUpdates` or an activity's `pushTokenUpdates`. */
  token: z.string().min(8).max(512),
  /** `board_start` = push-to-start token for the device; `board_update` = one activity's update token. */
  kind: z.enum(["board_start", "board_update"]),
  /** Required for `board_update`: the activity's `activityKey` ("<slug>|<event file>|<normalized name>"). */
  activityKey: z.string().min(1).max(300).optional(),
});

export type RegisterLiveActivityTokenInput = z.infer<typeof registerLiveActivityTokenInput>;
