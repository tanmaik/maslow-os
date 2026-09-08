import { Skeleton } from "@/components/ui/skeleton";

// The shape of the computer page while its row is read.
export default function Loading() {
  return (
    <main className="space-y-4" aria-busy>
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-16 w-full" />
    </main>
  );
}
