/**
 * Zod schemas for binding an athlete to their App Store download (PRD §6.13
 * B4, S3), mirroring `app-store-notifications.server.ts` (`satisfies` keeps
 * them honest). Plain objects only (Swift codegen).
 */
import { z } from "zod";
import {
  registerAppTransactionInput,
  type RegisterAppTransactionResult,
} from "@/lib/app-store-notifications.server";

export const registerAppTransactionInputSchema = registerAppTransactionInput;

export const registerAppTransactionResultSchema = z.object({
  ok: z.literal(true),
  bound: z.boolean(),
}) satisfies z.ZodType<RegisterAppTransactionResult>;
