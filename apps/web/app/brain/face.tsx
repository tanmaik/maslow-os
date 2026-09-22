import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { initials } from "@/lib/initials";

// A person as the two letters of their name, named in full for the pointer.
export function Face({
  name,
  className,
  style,
}: {
  name: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <Avatar size="sm" title={name} className={className}>
      <AvatarFallback style={style}>{initials(name)}</AvatarFallback>
    </Avatar>
  );
}
