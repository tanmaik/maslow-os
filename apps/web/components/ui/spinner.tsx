import { cn } from "@/lib/utils";
import { Loader2Icon } from "lucide-react";

// The one loop reduced motion keeps: a paused spinner reads as a frozen app,
// so it turns whatever the person has asked for.
function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <Loader2Icon
      data-slot="spinner"
      role="status"
      aria-label="Loading"
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  );
}

export { Spinner };
