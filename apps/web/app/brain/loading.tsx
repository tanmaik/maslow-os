import { Skeleton } from "@/components/ui/skeleton";

// The shape of a brain view while its rows are read.
export default function Loading() {
  return (
    <div className="bg-card space-y-3 rounded-[14px] border p-3.5" aria-busy>
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-96 w-full" />
    </div>
  );
}
