"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

// Whether this device has been asked, whatever it answered; one with no
// storage to say so is asked again.
const KEY = "maslow.permissions";
export function permissionsAsked(): boolean {
  try {
    return localStorage.getItem(KEY) === "asked";
  } catch {
    return false;
  }
}
// Told to every frame of the page that waits on the answer, once the
// card's own prompts are over, so nothing else asks meanwhile.
export const PERMISSIONS_EVENT = "maslow:permissions";
function asked(tell: boolean) {
  try {
    localStorage.setItem(KEY, "asked");
  } catch {
    // A device with no storage is asked again next time.
  }
  if (tell) document.dispatchEvent(new Event(PERMISSIONS_EVENT));
}

// How long the card waits on a browser's prompts before it goes anyway.
const PATIENCE = 30_000;

// One card, the first time the desktop is drawn on a device, for
// everything Maslow will want of it: notifications and the location,
// each by the browser's own prompt in turn from one tap, since a browser
// gives the first only to a tap and being stopped mid-task is not
// elegant. Answered or declined, it never comes back on
// this device; the browser's own answers stand.
export function Permissions({ computers }: { computers: boolean }) {
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  useEffect(() => setOpen(!permissionsAsked()), []);
  if (!open) return null;
  const allow = async () => {
    // Asked is the tap, whatever the browser then says; the card stays
    // while its prompts are up, and not past a browser that never
    // answers.
    asked(false);
    setAsking(true);
    const prompts = (async () => {
      // The one that needs the tap first, while it is fresh; a refusal
      // does not stop the next.
      if ("Notification" in window && Notification.permission === "default")
        await Notification.requestPermission().catch(() => {});
      if (computers && navigator.geolocation)
        await new Promise<void>((done) =>
          navigator.geolocation.getCurrentPosition(
            () => done(),
            () => done(),
            { enableHighAccuracy: false, timeout: 10_000 },
          ),
        );
    })();
    await Promise.race([prompts, new Promise((r) => setTimeout(r, PATIENCE))]);
    asked(true);
    setOpen(false);
  };
  // Not now asks nothing now: the location is read at its next minute,
  // with the browser's own prompt then, once.
  const later = () => {
    asked(false);
    setOpen(false);
  };
  return (
    <div
      role="dialog"
      aria-labelledby="permissions-title"
      className="fixed inset-0 bg-black/30 z-[65] flex items-center justify-center select-none"
    >
      <div className="flex w-[22rem] max-w-[calc(100vw-2rem)] flex-col gap-3 rounded-lg border border-border bg-popover p-4 text-popover-foreground shadow-lg">
        <p
          id="permissions-title"
          className="text-base font-medium text-foreground"
        >
          Let Maslow use this device
        </p>
        <ul className="text-sm text-muted-foreground flex flex-col gap-1">
          <li>Notifications, for what waits on you.</li>
          {computers && (
            <li>
              Your location, logged to your own computer and nowhere else.
            </li>
          )}
        </ul>
        <p className="text-xs text-muted-foreground">
          {asking
            ? "Answer your browser as it asks for each."
            : "Your browser asks for each in turn, once, here, so nothing stops you mid-task."}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={later} disabled={asking}>
            Not now
          </Button>
          <Button size="sm" onClick={allow} disabled={asking}>
            Allow
          </Button>
        </div>
      </div>
    </div>
  );
}
