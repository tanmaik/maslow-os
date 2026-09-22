"use client";

import dynamic from "next/dynamic";

// The graph drawn only in the browser, once its pane has a size to fit.
export const BrainGraph = dynamic(
  () => import("./graph").then((m) => m.BrainGraph),
  {
    ssr: false,
    loading: () => <div className="h-full bg-muted" />,
  },
);
