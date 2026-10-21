"use client";

import type { ReactNode } from "react";

import { Button, type ButtonProps } from "@/components/base/buttons/button";
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
  leadingIcon,
  title,
  description,
  children,
  variant = "secondary",
  className,
}: {
  trigger: ReactNode;
  leadingIcon?: ButtonProps["leadingIcon"];
  title: string;
  description?: string;
  children: ReactNode;
  variant?: ButtonProps["variant"];
  className?: string;
}) {
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button
            variant={variant}
            size="small"
            leadingIcon={leadingIcon}
            className={className}
          />
        }
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
