import { Skeleton } from "@/components/ui/skeleton";

// The shape of the settings while the org is read.
export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-3xl space-y-6" aria-busy>
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-40 w-full" />
    </main>
  );
}
