import { Skeleton } from "@/components/ui/skeleton";

// The shape of a brain view while its rows are read.
export default function Loading() {
  return (
    <div className="space-y-4" aria-busy>
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-80 max-w-full" />
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-96 w-full" />
    </div>
  );
}
