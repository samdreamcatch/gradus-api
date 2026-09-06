import { createServerFn } from "@tanstack/react-start";
import { getRequestIP, getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { inviteCodeSchema, resolveInviteCode as resolveInviteCodeShared } from "./invites.server";

export type { InviteKind } from "./invites.server";

function clientIp(): string {
  try {
    const ip = getRequestIP({ xForwardedFor: true });
    if (ip) return ip;
  } catch {
    // ignore
  }
  const ua = (() => {
    try {
      return getRequestHeader("user-agent") ?? "";
    } catch {
      return "";
    }
  })();
  return `ua:${ua.slice(0, 64)}`;
}

/**
 * Public: identify whether an 8-char code belongs to a coach, parent, or
 * athlete invite table. Rate-limited per IP to prevent enumeration. Used by
 * the universal `/i/$code` entry to decide where to send the recipient.
 * Thin wrapper over src/lib/invites.server.ts, shared with
 * `POST /api/v1/invites/resolve`.
 */
export const resolveInviteCode = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ code: inviteCodeSchema }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return resolveInviteCodeShared(supabaseAdmin, clientIp(), data.code);
  });
