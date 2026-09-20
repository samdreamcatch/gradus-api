import type { ErrorReportInput } from "./api/errors-schema";
import type { ErrorLogInput } from "./error-tracking.server";

/**
 * Files an iOS error into `client_errors` through the same `logError` the
 * web's `reportClientError` uses, so it lands in the existing admin errors
 * dashboard (PRD §6.10). Tagged `platform: "ios"` with version and build in
 * `metadata`; `source` stays `"client"` because the table's CHECK only knows
 * client and server. The admin list and the hourly digest read
 * `metadata->>platform` to label iOS rows; version, build, OS and device are
 * in the row's metadata on the detail page.
 *
 * Test users are dropped inside `logError`, as on the web.
 */
export async function reportIosError(
  deps: {
    userId: string | null;
    userAgent: string | null;
    host: string | null;
    log?: (input: ErrorLogInput) => Promise<unknown>;
  },
  input: ErrorReportInput,
): Promise<{ ok: true }> {
  const log = deps.log ?? (await import("./error-tracking.server")).logError;
  const environment: ErrorLogInput["environment"] =
    deps.host && (deps.host.includes("id-preview") || deps.host.includes("-dev.lovable.app"))
      ? "preview"
      : "production";
  await log({
    source: "client",
    message: input.kind === "error" ? input.message : `[${input.kind}] ${input.message}`,
    stack: input.stack ?? null,
    route: input.route ?? null,
    userId: deps.userId,
    userAgent: deps.userAgent,
    environment,
    metadata: {
      ...(input.metadata ?? {}),
      platform: "ios",
      kind: input.kind,
      appVersion: input.appVersion,
      build: input.build,
      osVersion: input.osVersion ?? null,
      device: input.device ?? null,
      occurredAt: input.occurredAt ?? null,
    },
  });
  return { ok: true };
}
