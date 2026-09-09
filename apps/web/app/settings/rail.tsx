import type { ReactNode } from "react";

import { EagerLink } from "@/components/eager-link";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

// One place on the settings page, reached by its anchor.
function Place({
  href,
  warn = false,
  children,
}: {
  href: string;
  warn?: boolean;
  children: ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      className={`h-8 shrink-0 justify-start rounded-[10px] px-2.5 text-[13px] font-normal ${
        warn ? "text-primary hover:text-primary" : ""
      }`}
      nativeButton={false}
      render={<EagerLink href={href} />}
    >
      {children}
    </Button>
  );
}

// A heading in the rail: whose settings the places under it are.
const Heading = ({ children }: { children: ReactNode }) => (
  <span className="text-muted-foreground shrink-0 self-center px-2.5 text-xs font-medium whitespace-nowrap md:self-auto md:py-1">
    {children}
  </span>
);

// The rail beside the settings: yours, then the org's. A row on a narrow
// screen, a column beside the cards on a wide one.
export function Rail({
  orgName,
  owner,
  holder,
}: {
  orgName: string;
  owner: boolean;
  holder: boolean;
}) {
  return (
    <nav
      aria-label="Settings"
      className="shadow-float bg-card flex gap-1 overflow-x-auto rounded-[16px] border p-2 md:sticky md:top-24 md:flex-col md:self-start"
    >
      <Heading>Yours</Heading>
      <Place href="#you">You</Place>
      <Place href="#apps">Connected apps</Place>
      <Place href="#agents">Agents</Place>
      <Place href="#ssh">SSH</Place>
      <Separator className="my-1 hidden w-auto md:block" />
      <Heading>{orgName}</Heading>
      {owner && <Place href="#org">Org</Place>}
      <Place href="#members">Members</Place>
      <Place href="#groups">Groups</Place>
      {holder && (
        <Place href="#delete" warn>
          Delete {orgName}
        </Place>
      )}
    </nav>
  );
}
