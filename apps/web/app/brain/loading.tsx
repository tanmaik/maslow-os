import { Skeleton } from "@/components/ui/skeleton";

// The shape of a brain view while its rows are read: the sheet it is about
// to become, with its bar and its first rows, so nothing jumps when the
// page arrives.
export default function Loading() {
  return (
    <div
      className="page-sheet rounded-3xl border border-border-button-default bg-background-primary-default"
      aria-busy
    >
      <div className="p-3">
        <Skeleton className="h-8 w-full rounded-2lg" />
      </div>
      {[0, 1, 2, 3, 4, 5].map((n) => (
        <div key={n} className="flex flex-col gap-1.5 px-5 py-2.5">
          <Skeleton className="h-4 w-1/2 rounded-sm" />
          <Skeleton className="h-3 w-3/4 rounded-sm" />
        </div>
      ))}
    </div>
  );
}
