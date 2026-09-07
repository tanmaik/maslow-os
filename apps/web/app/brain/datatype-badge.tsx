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

const ICONS: Record<Property["datatype"], typeof TypeIcon> = {
  text: TypeIcon,
  number: HashIcon,
  boolean: ToggleLeftIcon,
  date: CalendarIcon,
  datetime: ClockIcon,
  enum: ListIcon,
  list: TagsIcon,
};

// A field's datatype as a small badge with its icon, the same wherever a
// field is named.
export function DatatypeBadge({
  datatype,
}: {
  datatype: Property["datatype"];
}) {
  const Icon = ICONS[datatype];
  return (
    <Badge variant="outline" className="text-muted-foreground font-normal">
      <Icon />
      {datatype}
    </Badge>
  );
}
