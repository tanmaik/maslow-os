import * as React from "react";
import { RiCloseLine } from "@remixicon/react";

import { Button } from "@/components/ui/button";

// A quiet cross that closes, removes or clears the thing it sits on.
function CloseButton({
  size = "icon-sm",
  "aria-label": label,
  ...props
}: Omit<React.ComponentProps<typeof Button>, "children" | "variant"> & {
  "aria-label": string;
}) {
  return (
    <Button
      data-slot="close-button"
      variant="ghost"
      size={size}
      aria-label={label}
      {...props}
    >
      <RiCloseLine />
    </Button>
  );
}

export { CloseButton };
