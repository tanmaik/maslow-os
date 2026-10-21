"use client";

import { createContext, useContext } from "react";

import { NO_COMPUTER, REPO, TRIAL_HOURS } from "@/lib/trial-rules";

// Whether this desktop is a public trial's, for the few places that say so.
export const Trial = createContext(false);
export const useTrial = () => useContext(Trial);

// The line the menu bar keeps while a trial lasts: what it is, and where to
// get the real thing.
export function TrialLine({ className = "" }: { className?: string }) {
  return (
    <a
      href={REPO}
      target="_blank"
      rel="noreferrer"
      className={`flex items-center self-stretch rounded-lg px-2 whitespace-nowrap text-text-white/80 transition-colors duration-fast ease-plain hover:bg-white/10 hover:text-text-white ${className}`}
    >
      <span className="max-lg:hidden">
        Trial · deleted {TRIAL_HOURS} hours after you start · Get Maslow OS
      </span>
      <span className="lg:hidden">Trial · Get Maslow OS</span>
    </a>
  );
}

// What a window that needs a computer shows in a trial: one line, and
// where to run your own.
export function NoComputer() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <p className="text-body-regular text-text-secondary text-center">
        {NO_COMPUTER}{" "}
        <a
          href={REPO}
          target="_blank"
          rel="noreferrer"
          className="text-text-primary underline underline-offset-2"
        >
          Run your own
        </a>
        .
      </p>
    </div>
  );
}
