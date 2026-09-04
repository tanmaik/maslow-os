import type { Property } from "@placeholder/brain";
import {
  CalendarIcon,
  ClockIcon,
  HashIcon,
  ListIcon,
  TagsIcon,
  ToggleLeftIcon,
  TypeIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";

const ICONS: Record<Property["type"], typeof TypeIcon> = {
  text: TypeIcon,
  number: HashIcon,
  boolean: ToggleLeftIcon,
  date: CalendarIcon,
  datetime: ClockIcon,
  enum: ListIcon,
  list: TagsIcon,
};

// A field's type as a small badge with its icon, the same wherever a field
// is named.
export function TypeBadge({ type }: { type: Property["type"] }) {
  const Icon = ICONS[type];
  return (
    <Badge variant="outline" className="text-muted-foreground font-normal">
      <Icon />
      {type}
    </Badge>
  );
}
