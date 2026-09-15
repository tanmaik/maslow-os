"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { CloseButton } from "@/components/base/buttons/close-button";

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/20 transition-opacity duration-slow ease-out-quart data-starting-style:opacity-0 data-ending-style:duration-base data-ending-style:ease-in-quad data-ending-style:opacity-0 supports-backdrop-filter:backdrop-blur-xs",
        className,
      )}
      {...props}
    />
  );
}

// A dialog a key opens many times a day arrives with no entrance and no
// exit, backdrop and all.
const PLAIN_POPUP =
  "transition-none data-starting-style:scale-100 data-starting-style:opacity-100 data-starting-style:blur-none data-ending-style:scale-100 data-ending-style:opacity-100 data-ending-style:blur-none";
const PLAIN_OVERLAY =
  "transition-none data-starting-style:opacity-100 data-ending-style:opacity-100";

function DialogContent({
  className,
  children,
  showCloseButton = true,
  plain = false,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean;
  plain?: boolean;
}) {
  return (
    <DialogPortal>
      <DialogOverlay className={cn(plain && PLAIN_OVERLAY)} />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          "glass-sheet fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] grid-cols-[minmax(0,1fr)] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-clip rounded-3xl bg-background-full px-5 pt-4 pb-5 text-body-regular text-text-primary shadow-xs outline-none sm:max-w-sm transform-gpu transition-[opacity,scale,filter] duration-slow ease-in-out-soft data-starting-style:opacity-0 data-starting-style:scale-[0.85] data-starting-style:blur-[4px] data-ending-style:duration-base data-ending-style:ease-in-quad data-ending-style:opacity-0 data-ending-style:scale-[0.85] data-ending-style:blur-[4px]",
          plain && PLAIN_POPUP,
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <CloseButton
                size="md"
                aria-label="Close"
                className="absolute top-4 right-4 after:absolute after:-inset-1.5 after:content-['']"
              />
            }
          />
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  );
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean;
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "-mx-5 -mb-5 flex flex-col-reverse gap-2 rounded-b-3xl border-t border-separator-border bg-background-secondary-default p-5 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          Close
        </DialogPrimitive.Close>
      )}
    </div>
  );
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-title-3-medium text-text-primary", className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-body-regular text-text-secondary *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-text-primary",
        className,
      )}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
