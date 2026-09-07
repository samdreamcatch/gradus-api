/**
 * Path-parameter validation shared by the `/api/v1/parent/athletes/{id}*`
 * routes: a malformed id answers 400 `validation_failed` rather than
 * reaching the database.
 */
import { z } from "zod";
import { ApiError } from "./errors";

function uuidParam(raw: string | undefined, message: string): string {
  const id = z.string().uuid().safeParse(raw);
  if (!id.success) throw new ApiError({ code: "validation_failed", status: 400, message });
  return id.data;
}

export const athleteIdParam = (params: Record<string, string>) =>
  uuidParam(params.id, "Athlete id must be a UUID.");

export const coachIdParam = (params: Record<string, string>) =>
  uuidParam(params.coachId, "Coach id must be a UUID.");
