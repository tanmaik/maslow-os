import { Skeleton } from "@/components/ui/skeleton";

// The shape of a pane while its page is read: a bar and a few lines, so a
// click in the sidebar shows something at once and nothing jumps when the
// page arrives.
export function PaneLoading() {
  return (
    <div className="flex h-full flex-col bg-background" aria-busy>
      <div className="border-b border-border px-3 py-2">
        <Skeleton className="h-7 w-48 rounded-md" />
      </div>
      <div className="flex flex-col gap-3 p-4">
        {[0, 1, 2, 3].map((n) => (
          <div key={n} className="flex flex-col gap-1.5">
            <Skeleton className="h-4 w-1/3 rounded-sm" />
            <Skeleton className="h-3 w-2/3 rounded-sm" />
          </div>
        ))}
      </div>
    </div>
  );
}
