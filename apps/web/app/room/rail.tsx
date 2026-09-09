import { Card } from "@/components/ui/card";
import { initials } from "@/lib/initials";

// Who is in the room: every current member of the org, by name.
export function Rail({ people }: { people: { id: string; name: string }[] }) {
  return (
    <aside className="sticky top-24 hidden w-56 shrink-0 md:block">
      <Card className="gap-0.5 rounded-2xl p-2 shadow-lg">
        <div className="flex items-baseline justify-between px-2 pt-0.5 pb-1.5 text-xs">
          <span className="text-muted-foreground font-medium">In the room</span>
          <span className="text-muted-foreground/70">
            {people.length} {people.length === 1 ? "member" : "members"}
          </span>
        </div>
        {people.map((m) => (
          <div key={m.id} className="flex h-8 items-center gap-2.5 px-2">
            <span className="bg-muted text-muted-foreground flex size-[22px] shrink-0 items-center justify-center rounded-full text-[10px] font-semibold">
              {initials(m.name)}
            </span>
            <span className="truncate text-[12.5px] font-medium">{m.name}</span>
          </div>
        ))}
      </Card>
    </aside>
  );
}
