import { Skeleton } from "@/components/ui/skeleton";

// The shape of a pane while its rows are read: the rail stays where it
// was, and only this side of the window waits.
export function PaneSkeleton() {
  return (
    <div className="flex flex-col gap-3 py-5" aria-busy>
      <Skeleton className="h-4 w-40 rounded-md" />
      <Skeleton className="h-[52px] w-full rounded-md" />
      <Skeleton className="h-[52px] w-full rounded-md" />
      <Skeleton className="h-[52px] w-full rounded-md" />
    </div>
  );
}
