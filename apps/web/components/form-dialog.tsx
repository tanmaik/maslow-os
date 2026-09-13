import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

// A form behind a button: the page stays a page until it is asked for.
export function FormDialog({
  trigger,
  title,
  description,
  children,
  variant = "outline",
  className,
}: {
  trigger: ReactNode;
  title: string;
  description?: string;
  children: ReactNode;
  variant?: "outline" | "default" | "ghost";
  className?: string;
}) {
  return (
    <Dialog>
      <DialogTrigger
        render={<Button variant={variant} size="sm" className={className} />}
      >
        {trigger}
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
