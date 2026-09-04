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

// A view beside its graph: side by side with a draggable divider on a wide
// screen, the graph above the view on a narrow one. An aside, when given,
// sits under the graph.
export function Split({
  children,
  graph,
  aside,
  graphSize = 40,
}: {
  children: ReactNode;
  graph: ReactNode;
  aside?: ReactNode;
  graphSize?: number;
}) {
  const wide = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(WIDE).matches,
    () => true,
  );
  if (!wide) {
    return (
      <div className="space-y-4">
        <div className="h-[min(50dvh,420px)] overflow-hidden rounded-md border">
          {graph}
        </div>
        {children}
        {aside}
      </div>
    );
  }
  return (
    <div className="h-[calc(100dvh_-_9.5rem)]">
      <ResizablePanelGroup orientation="horizontal">
        <ResizablePanel defaultSize={100 - graphSize} minSize={30}>
          <div className="h-full space-y-4 overflow-auto pr-4">{children}</div>
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize={graphSize} minSize={20}>
          <div className="flex h-full flex-col gap-4 pl-4">
            <div
              className={`shrink-0 overflow-hidden rounded-md border ${
                aside ? "h-[42%]" : "h-full"
              }`}
            >
              {graph}
            </div>
            {aside && (
              <div className="min-h-0 flex-1 space-y-4 overflow-auto">
                {aside}
              </div>
            )}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
