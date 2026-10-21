"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Notification } from "@/components/base/notification/notification";

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
      <Notification
        key={said}
        status="error"
        title={said}
        introDelay={0}
        dismissible
        closeLabel="Close"
        onDismiss={() =>
          router.replace(`${pathname}${query ? `?${query}` : ""}`, {
            scroll: false,
          })
        }
      />
    </div>
  );
}
