"use client";

import { RiInformation2Line } from "@remixicon/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { Announcement } from "@/components/base/announcement/announcement";

// What a page of the computer shows while there is no computer to show:
// either the deployment has none at all, or this person's is still coming
// up, in which case the page asks after it every few seconds, so nobody
// has to reload to find out it arrived. Asking is what moves it on: the
// ask makes what is missing, starts a machine the cloud stopped, and takes an
// image its door cannot answer without.
export function ComputerWaiting({
  title,
  description,
  polls = false,
}: {
  title: string;
  description: string;
  polls?: boolean;
}) {
  const router = useRouter();
  useEffect(() => {
    if (!polls) return;
    let stopped = false;
    let again = 0;
    const ask = async () => {
      const res = await fetch("/computer/state", { method: "POST" }).catch(
        () => null,
      );
      if (stopped) return;
      if (res?.ok) router.refresh();
      again = window.setTimeout(ask, 5000);
    };
    void ask();
    return () => {
      stopped = true;
      window.clearTimeout(again);
    };
  }, [polls, router]);

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center">
      <Announcement
        className="max-w-sm"
        icon={RiInformation2Line}
        title={title}
        description={
          polls ? (
            <>
              {description}{" "}
              <Link
                href="/settings?pane=computer"
                className="text-text-primary underline underline-offset-2"
              >
                Computer, in Settings
              </Link>
              , shows it coming up.
            </>
          ) : (
            description
          )
        }
      />
    </div>
  );
}
