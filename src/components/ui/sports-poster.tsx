import { cn } from "@/lib/utils";
import posterAsset from "@/assets/sports-poster.png.asset.json";

/** CDN URL for the Gradus multi-sport line-art poster. */
export const sportsPosterUrl = posterAsset.url;

type Corner = "top-right" | "top-left" | "bottom-right" | "bottom-left" | "center";

interface SportsPosterProps {
  /** Where the poster anchors within its container. */
  corner?: Corner;
  /** CSS size for the poster's longest edge. Defaults to 420px. Ignored when `fill` is set. */
  size?: string;
  /** 0–1 opacity applied over the artwork. Defaults to 0.18. */
  opacity?: number;
  /** Extra margin (px) pulling the poster off the edge for a tucked look. Ignored when `fill` is set. */
  inset?: number;
  /** Fill the parent entirely with a single, un-repeated poster (cover). */
  fill?: boolean;
  className?: string;
}

/**
 * Gradus design-system watermark: the multi-sport line-art poster.
 *
 * DOCTRINE — ceremony surfaces only.
 * The watermark marks arrival, exit, and celebration. It is NOT a page skin,
 * NOT for authenticated app pages, lists, dashboards, or forms inside the
 * app shell. Adding it to a routine surface dilutes the moment.
 *
 * Allowed surfaces (kept in sync with the ESLint allowlist in
 * `eslint.config.js`):
 *   Auth entry:  login, forgot-password, reset-password, i.$code
 *   Signup:      signup.athlete, signup.athlete.adult, signup.coach, signup.parent
 *   Celebration: connection-celebration, onboarding/invite-card
 *
 * New ceremony surfaces require an additive change to that allowlist —
 * that friction is intentional.
 *
 * Parent must be `position: relative` (or `absolute/fixed`) and clip
 * overflow if you want the poster to bleed to the edge.
 */
export function SportsPoster({
  corner = "top-right",
  size = "420px",
  opacity = 0.18,
  inset = 30,
  fill = false,
  className,
}: SportsPosterProps) {
  const offset = `-${inset}px`;
  const pos: React.CSSProperties = fill
    ? { inset: 0 }
    : corner === "center"
      ? { top: "50%", left: "50%", transform: "translate(-50%, -50%)" }
      : {
          top: corner.startsWith("top") ? offset : "auto",
          bottom: corner.startsWith("bottom") ? offset : "auto",
          left: corner.endsWith("left") ? offset : "auto",
          right: corner.endsWith("right") ? offset : "auto",
        };
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute select-none dark:invert", className)}
      style={{
        ...pos,
        ...(fill ? {} : { width: size, height: size }),
        opacity,
        backgroundImage: `url("${sportsPosterUrl}")`,
        backgroundRepeat: "no-repeat",
        backgroundPosition: "center",
        backgroundSize: "cover",
      }}
    />
  );
}
