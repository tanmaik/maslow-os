import { Skeleton } from "@/components/ui/skeleton";

// The shape of the settings while the org is read: the toolbar, then the
// grid's bands.
export default function Loading() {
  return (
    <main className="-mx-6 -mt-6 flex flex-col" aria-busy>
      <div className="flex min-h-11 items-center gap-2 border-b border-separator-border px-4 py-2">
        <Skeleton className="h-[30px] w-[62px] rounded-2lg" />
        <Skeleton className="h-[30px] w-20 rounded-2lg" />
        <Skeleton className="ml-auto h-8 w-60 rounded-2lg" />
      </div>
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-3 px-4 py-3">
        <Skeleton className="h-4 w-16 rounded-md" />
        <div className="flex gap-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-[74px] w-[84px] rounded-2lg" />
          ))}
        </div>
      </div>
    </main>
  );
}
