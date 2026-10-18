/**
 * The native apps that call `/api/v1`, as named in the `X-Gradus-Client`
 * header (`ios/1.4.0+87`, `android/1.0.0+1`, …; docs/android/PRD.md §9.4
 * rule 2). Pure, so the admin pages can label rows with it too.
 */
export const CLIENT_PLATFORMS = ["ios", "watchos", "android", "wearos"] as const;

export type ClientPlatform = (typeof CLIENT_PLATFORMS)[number];

export function isClientPlatform(value: unknown): value is ClientPlatform {
  return typeof value === "string" && (CLIENT_PLATFORMS as readonly string[]).includes(value);
}

/**
 * The platform an app request came from: the header when it names a known
 * platform, else the body's optional `platform`, else `"ios"` (the only app
 * that sent requests before Android, and it always sends the header).
 */
export function resolveClientPlatform(
  headerPlatform: string | null | undefined,
  bodyPlatform?: ClientPlatform | null,
): ClientPlatform {
  const fromHeader = headerPlatform?.toLowerCase();
  if (isClientPlatform(fromHeader)) return fromHeader;
  return bodyPlatform ?? "ios";
}

const LABELS: Record<ClientPlatform, string> = {
  ios: "iOS",
  watchos: "watchOS",
  android: "Android",
  wearos: "Wear OS",
};

/** "iOS", "Android", …; `null` for web rows (no platform in metadata). */
export function clientPlatformLabel(platform: string | null | undefined): string | null {
  return isClientPlatform(platform) ? LABELS[platform] : null;
}

/** `"[Android] "` before an app row's message in the error digest; `""` for web rows. */
export function digestPlatformPrefix(platform: string | null | undefined): string {
  const label = clientPlatformLabel(platform);
  return label ? `[${label}] ` : "";
}
