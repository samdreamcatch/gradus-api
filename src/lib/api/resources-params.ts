/**
 * Path-parameter validation shared by the `/api/v1/resources/{id}*`,
 * `/api/v1/coach/resources/{id}`, and `/api/v1/saved-answers/{id}` routes:
 * a malformed id answers 400 `validation_failed` rather than reaching the
 * database.
 */
import { z } from "zod";
import { ApiError } from "./errors";

function uuidParam(raw: string | undefined, message: string): string {
  const id = z.string().uuid().safeParse(raw);
  if (!id.success) throw new ApiError({ code: "validation_failed", status: 400, message });
  return id.data;
}

export const resourceIdParam = (params: Record<string, string>) =>
  uuidParam(params.id, "Resource id must be a UUID.");

export const savedAnswerIdParam = (params: Record<string, string>) =>
  uuidParam(params.id, "Saved answer id must be a UUID.");
