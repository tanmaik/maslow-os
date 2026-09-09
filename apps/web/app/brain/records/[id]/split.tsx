"use client";

import { useSyncExternalStore, type ReactNode } from "react";

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";

const WIDE = "(min-width: 768px)";
const subscribe = (cb: () => void) => {
  const q = window.matchMedia(WIDE);
  q.addEventListener("change", cb);
  return () => q.removeEventListener("change", cb);
};

// A record beside its map, when it has one: side by side with a draggable
// divider on a wide screen, the map above the record on a narrow one. The
// aside, the record's fields and who may see it, sits under the map.
export function Split({
  children,
  graph,
  aside,
}: {
  children: ReactNode;
  graph: ReactNode | null;
  aside: ReactNode;
}) {
  const wide = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(WIDE).matches,
    () => true,
  );
  if (!wide) {
    return (
      <div className="space-y-4">
        {graph && (
          <div className="h-[min(50dvh,420px)] overflow-hidden rounded-md border">
            {graph}
          </div>
        )}
        {children}
        {aside}
      </div>
    );
  }
  return (
    <div className="h-[calc(100dvh_-_9.5rem)]">
      <ResizablePanelGroup orientation="horizontal">
        <ResizablePanel defaultSize={58} minSize={30}>
          <div className="h-full space-y-4 overflow-auto pr-4">{children}</div>
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize={42} minSize={20}>
          <div className="flex h-full flex-col gap-4 pl-4">
            {graph && (
              <div className="h-[42%] shrink-0 overflow-hidden rounded-md border">
                {graph}
              </div>
            )}
            <div className="min-h-0 flex-1 space-y-4 overflow-auto">
              {aside}
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
