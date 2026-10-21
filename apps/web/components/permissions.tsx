"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/base/buttons/button";

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
// everything Maslow will want of it: the microphone, notifications and
// the location, each by the browser's own prompt in turn from one tap,
// since a browser gives the first two only to a tap and being stopped
// mid-task is not elegant. Answered or declined, it never comes back on
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
      // The two that need the tap first, while it is fresh; a refusal of
      // one does not stop the next.
      if (navigator.mediaDevices?.getUserMedia)
        await navigator.mediaDevices
          .getUserMedia({ audio: true })
          .then((s) => s.getTracks().forEach((t) => t.stop()))
          .catch(() => {});
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
      className="bg-canvas/40 fixed inset-0 z-[65] flex items-center justify-center select-none"
    >
      <div className="glass-sheet border-separator-border flex w-[22rem] max-w-[calc(100vw-2rem)] flex-col gap-3 rounded-[12px] border p-5">
        <p
          id="permissions-title"
          className="text-headline-medium text-text-primary"
        >
          Let Maslow use this device
        </p>
        <ul className="text-body-regular text-text-secondary flex flex-col gap-1">
          <li>Your microphone, to hold and talk.</li>
          <li>Notifications, for what your agent leaves you.</li>
          {computers && (
            <li>
              Your location, logged to your own computer and nowhere else.
            </li>
          )}
        </ul>
        <p className="text-caption-1-regular text-text-tertiary">
          {asking
            ? "Answer your browser as it asks for each."
            : "Your browser asks for each in turn, once, here, so nothing stops you mid-task."}
        </p>
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            size="small"
            onClick={later}
            disabled={asking}
          >
            Not now
          </Button>
          <Button size="small" onClick={allow} disabled={asking}>
            Allow
          </Button>
        </div>
      </div>
    </div>
  );
}
