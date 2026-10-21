"use client";

import type { ReactNode } from "react";

import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";

// A sheet up from the bottom of a phone: what a menu is there. It is drawn
// only while it is open, and a panel's controls are put into it each time
// it opens.
export function PhoneSheet({
  open,
  onClose,
  label,
  children,
  bodyRef,
  controls = false,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  children?: ReactNode;
  bodyRef?: (el: HTMLDivElement | null) => void;
  // Whether what it holds is a panel's own controls, which stretch to the
  // sheet's width, rather than rows of words, which read from the left.
  controls?: boolean;
}) {
  return (
    <Drawer open={open} onOpenChange={(to) => to || onClose()} showSwipeHandle>
      <DrawerContent className="glass-sheet z-[70] rounded-t-3xl border-0 px-3 pt-2 pb-[calc(env(safe-area-inset-bottom)+12px)] [--drawer-content-max-height:70dvh]">
        <DrawerTitle className="text-caption-1-medium text-text-tertiary px-2 pb-1 text-left">
          {label}
        </DrawerTitle>
        <div
          ref={bodyRef}
          className={`flex flex-col items-stretch gap-2 overflow-y-auto ${
            controls
              ? "[&_[data-slot=button-group]]:w-full [&_button]:justify-center"
              : ""
          }`}
        >
          {children}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
