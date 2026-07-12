import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Teach tailwind-merge about our custom typography utilities defined in
// src/styles.css (`@utility text-pico`, `text-nano`, `text-micro`,
// `text-caption`, plus the display/body/hand/meta/label/mono tokens from the
// design system). Without this, twMerge classifies every `text-*` class as
// font-size and drops earlier ones when combined with color/tone classes like
// `text-accent-ink`, silently reverting components to browser-default 16px.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "pico",
            "nano",
            "micro",
            "caption",
            "meta",
            "label",
            "mono",
            "body",
            "hand",
            "h1",
            "h2",
            "h3",
          ],
        },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
