import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";

import { cn } from "@/lib/utils";

const Popover = PopoverPrimitive.Root;

const PopoverTrigger = PopoverPrimitive.Trigger;

const PopoverAnchor = PopoverPrimitive.Anchor;

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "center", sideOffset = 4, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        "z-50 w-72 rounded-md border bg-popover p-3 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-(--radix-popover-content-transform-origin)",
        // Mobile: pin to top of viewport so on-screen keyboard doesn't cover it.
        // Radix sets inline styles (position/left/top/transform/min-width) directly, so
        // we override via arbitrary !important on <sm only. `![transform:none]` is required
        // because Tailwind's !translate-* classes only set CSS vars — they lose to inline transform.
        "max-sm:![position:fixed] max-sm:![top:1rem] max-sm:![left:1rem] max-sm:![right:1rem] max-sm:![bottom:auto] max-sm:![transform:none] max-sm:![min-width:0] max-sm:!w-auto max-sm:!max-w-none",
        className,
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
));

PopoverContent.displayName = PopoverPrimitive.Content.displayName;


export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor };
