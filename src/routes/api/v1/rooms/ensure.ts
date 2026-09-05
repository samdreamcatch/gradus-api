import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { defineApiRoute } from "@/lib/api/define-route";
import { requireContext } from "@/lib/api/auth";
import {
  ensureAthleteRoom,
  ensureBody,
  ensureDirectRoom,
  ensureRoomForMyAthlete,
} from "@/lib/messages.server";

const outputSchema = z.object({ id: z.string() });

/**
 * One endpoint for the web's four room-opening functions (Appendix A
 * `POST /rooms/ensure`, discriminated body). Athlete rooms with a `coachId`
 * follow `ensureRoom` (coach, athlete, or guardian may open); without one the
 * caller must be the coach (`ensureRoomForAthlete`). Direct rooms follow
 * `ensureDirectRoom`. Opening an existing room returns its id.
 */
export const Route = createFileRoute("/api/v1/rooms/ensure")({
  server: {
    handlers: defineApiRoute({
      method: "POST",
      path: "/api/v1/rooms/ensure",
      auth: "user",
      summary: "Open (or find) a conversation",
      input: ensureBody,
      output: outputSchema,
      handler: async ({ ctx, input }) => {
        const c = { userId: requireContext(ctx).userId };
        switch (input.kind) {
          case "athlete":
            return input.coachId
              ? ensureAthleteRoom(c, { coachId: input.coachId, athleteId: input.athleteId })
              : ensureRoomForMyAthlete(c, { athleteId: input.athleteId });
          case "coach_coach":
          case "coach_parent":
            return ensureDirectRoom(c, input);
        }
      },
    }),
  },
});
