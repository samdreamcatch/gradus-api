import { cn } from "@/lib/utils";
import posterAsset from "@/assets/sports-poster.png.asset.json";

/** CDN URL for the Gradus multi-sport line-art poster. */
export const sportsPosterUrl = posterAsset.url;

type Corner = "top-right" | "top-left" | "bottom-right" | "bottom-left" | "center";

interface SportsPosterProps {
  /** Where the poster anchors within its container. */
  corner?: Corner;
  /** CSS size for the poster's longest edge. Defaults to 420px. */
  size?: string;
  /** 0–1 opacity applied over the artwork. Defaults to 0.18. */
  opacity?: number;
  /** Extra margin (px) pulling the poster off the edge for a tucked look. */
  inset?: number;
  className?: string;
}

/**
 * Gradus design-system watermark: the multi-sport line-art poster tucked
 * behind a container. Absolutely positioned, non-interactive, decorative.
 *
 * Parent must be `position: relative` (or `absolute/fixed`) and clip
 * overflow if you want the poster to bleed to the edge.
 */
export function SportsPoster({
  corner = "top-right",
  size = "420px",
  opacity = 0.18,
  inset = 30,
  className,
}: SportsPosterProps) {
  const offset = `-${inset}px`;
  const pos: React.CSSProperties =
    corner === "center"
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
      className={cn("pointer-events-none absolute select-none", className)}
      style={{
        ...pos,
        width: size,
        height: size,
        opacity,
        backgroundImage: `url("${sportsPosterUrl}")`,
        backgroundRepeat: "no-repeat",
        backgroundPosition: "center",
        backgroundSize: "contain",
      }}
    />
  );
}
