/**
 * Parses the `X-Gradus-Client` header (e.g. `ios/1.4.0+87`), per
 * docs/ios/PRD.md §6.2. Tolerant of absence or malformed values — every
 * field is `null` rather than throwing, since client identification is
 * informational, not required for a request to succeed.
 */
export interface GradusClientInfo {
  platform: string | null;
  version: string | null;
  build: string | null;
}

const CLIENT_HEADER_PATTERN = /^([a-z0-9_-]+)\/(\d+\.\d+\.\d+)\+(\d+)$/i;

const EMPTY_CLIENT_INFO: GradusClientInfo = { platform: null, version: null, build: null };

export function parseClientHeader(request: Request): GradusClientInfo {
  const header = request.headers.get("x-gradus-client");
  if (!header) return EMPTY_CLIENT_INFO;

  const match = CLIENT_HEADER_PATTERN.exec(header.trim());
  if (!match) return EMPTY_CLIENT_INFO;

  const [, platform, version, build] = match;
  return { platform, version, build };
}
