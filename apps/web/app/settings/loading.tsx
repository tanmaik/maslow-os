import { Skeleton } from "@/components/ui/skeleton";

// The shape of the settings while the org is read: the rail, then cards.
export default function Loading() {
  return (
    <main
      className="gap-6 md:grid md:grid-cols-[13.75rem_minmax(0,1fr)]"
      aria-busy
    >
      <Skeleton className="h-12 w-full rounded-[16px] md:h-80" />
      <div className="mt-4 grid gap-6 md:mt-0 xl:grid-cols-2">
        <Skeleton className="h-64 w-full rounded-[14px]" />
        <Skeleton className="h-64 w-full rounded-[14px]" />
      </div>
    </main>
  );
}
