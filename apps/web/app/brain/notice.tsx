"use client";

import { RiErrorWarningLine } from "@remixicon/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Alert, AlertAction, AlertTitle } from "@/components/ui/alert";
import { CloseButton } from "@/components/ui/close-button";

import { SAID } from "./refuse";

// What a refused form said, on the page it was refused from. It goes when
// it is dismissed and when the person moves on, so a refusal is never a
// page of its own.
export function Notice() {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const said = params.get(SAID);
  if (!said) return null;
  const rest = new URLSearchParams(params);
  rest.delete(SAID);
  const query = rest.toString();
  return (
    <div className="brain-inset pb-3">
      <Alert key={said} variant="destructive">
        <RiErrorWarningLine />
        <AlertTitle>{said}</AlertTitle>
        <AlertAction>
          <CloseButton
            size="icon-xs"
            aria-label="Close"
            onClick={() =>
              router.replace(`${pathname}${query ? `?${query}` : ""}`, {
                scroll: false,
              })
            }
          />
        </AlertAction>
      </Alert>
    </div>
  );
}
