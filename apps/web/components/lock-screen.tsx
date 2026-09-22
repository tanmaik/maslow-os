"use client";

// The lock screen: the way into Maslow, drawn on the desktop's own wallpaper.
// Three steps on one screen — who you are, the code we mailed you, and
// which org you land in when you are in more than one.

import { RiCloseLine } from "@remixicon/react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { srcOf } from "@/app/desktop/wallpapers";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { initials } from "@/lib/initials";
import { BASE } from "@/lib/motion";
import { cn } from "@/lib/utils";

// Someone this device has signed in before: enough to greet them by, kept
// on the device and nowhere else.
export type Known = { email: string; name: string; picture: string | null };

// One org a person could land in, as the last step offers it.
type Landing = {
  userId: string;
  orgName: string;
  role: "owner" | "member";
};

// The seeded people of one org, as the development way in lists them.
export type Made = {
  org: string;
  people: { id: string; name: string; email: string }[];
};

const PEOPLE = "maslow.people";
const PAPER = "maslow.wallpaper";

// How many faces a shared device offers before the oldest drops off.
const MOST = 5;

// The people this device remembers, newest first.
function known(): Known[] {
  try {
    const kept: unknown = JSON.parse(localStorage.getItem(PEOPLE) ?? "[]");
    if (!Array.isArray(kept)) return [];
    return kept
      .filter(
        (p): p is Known =>
          typeof p?.email === "string" && typeof p?.name === "string",
      )
      .slice(0, MOST);
  } catch {
    return [];
  }
}

// Remembers whoever is at the desktop, so the next sign-in on this device
// offers their face.
export function remember(who: Known): void {
  const rest = known().filter((p) => p.email !== who.email);
  localStorage.setItem(PEOPLE, JSON.stringify([who, ...rest].slice(0, MOST)));
}

// Forgets one of them, at their own tile's asking.
function forget(email: string): Known[] {
  const rest = known().filter((p) => p.email !== email);
  localStorage.setItem(PEOPLE, JSON.stringify(rest));
  return rest;
}

// What the desktop lies on, under the lock screen: the picture this device
// last saw, Dusk until it has seen one, and a darkening over it deep enough
// that white words read over the lightest thing a desktop can wear.
function Paper() {
  const [src, setSrc] = useState<string | null>(null);
  const [lit, setLit] = useState(false);
  useEffect(() => setSrc(srcOf(localStorage.getItem(PAPER))), []);
  return (
    <div className="fixed inset-0 bg-canvas">
      {src && (
        <img
          src={src}
          alt=""
          aria-hidden
          onLoad={() => setLit(true)}
          className={cn(
            "absolute inset-0 size-full object-cover transition-opacity duration-slow ease-out-quart motion-reduce:transition-none",
            lit ? "opacity-100" : "opacity-0",
          )}
        />
      )}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(to bottom, rgba(0,0,0,0.68), rgba(0,0,0,0.5) 220px, rgba(0,0,0,0.5))",
        }}
      />
    </div>
  );
}

// The time and the day over the wallpaper, as the menu bar says them.
function Clock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const beat = setInterval(tick, 30_000);
    return () => clearInterval(beat);
  }, []);
  return (
    <div className="flex flex-col items-center gap-1 text-white">
      {/* A width held from the first paint, so nothing moves when the
          clock arrives. */}
      <span className="min-h-10 text-2xl font-medium tabular-nums">
        {now?.toLocaleTimeString(undefined, {
          hour: "numeric",
          minute: "2-digit",
        }) ?? " "}
      </span>
      <span className="text-sm font-medium text-white/80">
        {now
          ?.toLocaleDateString(undefined, {
            weekday: "long",
            month: "long",
            day: "numeric",
          })
          .replace(",", "") ?? " "}
      </span>
    </div>
  );
}

// The circle over the column: the person's picture when this device knows
// them, their initials when it knows only a name, and an empty disc when it
// knows neither.
function Face({ who }: { who: Known | null }) {
  const still = useReducedMotion();
  return (
    <motion.span
      key={who?.picture ?? who?.email ?? "nobody"}
      initial={still ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={BASE}
      className="inline-flex"
    >
      <Avatar className="size-20">
        {who?.picture && <AvatarImage src={who.picture} alt={who.name} />}
        <AvatarFallback className="text-xl font-medium">
          {who ? initials(who.name) : null}
        </AvatarFallback>
      </Avatar>
    </motion.span>
  );
}

// What the last leg left to say, under what it is about.
function Said({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="text-center text-sm text-destructive">
      {children}
    </p>
  );
}

// One face this device remembers, at the size the step is about, and the
// × that forgets it.
function Tile({
  who,
  onPick,
  onForget,
}: {
  who: Known;
  onPick: () => void;
  onForget: () => void;
}) {
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={onPick}
        className="flex w-24 flex-col items-center gap-2 rounded-md p-1 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <Face who={who} />
        <span className="w-full truncate text-sm font-medium text-foreground">
          {who.name.split(" ")[0]}
        </span>
      </button>
      <button
        type="button"
        onClick={onForget}
        aria-label={`Forget ${who.name}`}
        className="absolute top-0 right-1 grid size-5 place-items-center rounded-full bg-muted text-muted-foreground opacity-0 transition-opacity duration-fast ease-plain group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <RiCloseLine className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}

// The way in without an email, outside production: pick one of the seeded
// people. The route behind it does not exist in production, and the block
// says so, so nobody mistakes it for the real door.
function Made({ made, next }: { made: Made[]; next?: string }) {
  const first = made[0]?.people[0]?.id;
  return (
    <div className="mt-8 flex flex-col gap-3 rounded-lg border border-border bg-background/80 p-3">
      <form action="/auth/dev" method="post" className="flex flex-col gap-3">
        {next && <input type="hidden" name="next" value={next} />}
        <div className="flex items-start gap-2">
          <Badge variant="outline">dev</Badge>
          <p className="text-xs text-muted-foreground">
            These people are made up, and this way in does not exist in
            production.
          </p>
        </div>
        {/* Capped, so the way in is on the screen however many people are
            seeded and however short the screen is. */}
        <div className="max-h-[32dvh] overflow-x-hidden overflow-y-auto">
          <RadioGroup
            name="user"
            aria-label="Seeded people"
            defaultValue={first}
            className="relative grid-cols-[minmax(0,1fr)] gap-3"
          >
            {made.map((org) => (
              <div key={org.org} className="flex flex-col">
                <p className="pb-1 text-xs font-medium text-muted-foreground">
                  {org.org}
                </p>
                {org.people.map((p) => (
                  <Choice
                    key={p.id}
                    value={p.id}
                    title={p.name}
                    description={p.email}
                  />
                ))}
              </div>
            ))}
          </RadioGroup>
        </div>
        <Button type="submit" variant="outline" size="lg" className="w-full">
          Sign in
        </Button>
      </form>
    </div>
  );
}

// One thing to pick among a few: what it is, a line about it, and the mark
// that says it is the one.
function Choice({
  value,
  title,
  description,
}: {
  value: string;
  title: ReactNode;
  description: ReactNode;
}) {
  return (
    <label className="relative flex min-h-9 cursor-pointer items-center justify-between gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-accent has-data-checked:bg-accent">
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="shrink-0 text-sm font-medium text-foreground">
          {title}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {description}
        </span>
      </span>
      <RadioGroupItem value={value} />
    </label>
  );
}

// One leg of the way in: whose it is, what it asks, the form that answers
// it, and what else can be done instead.
function Column({
  mark,
  title,
  description,
  action,
  cta,
  footer,
  children,
}: {
  mark?: ReactNode;
  title: ReactNode;
  description: ReactNode;
  action?: string;
  cta: string | null;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex w-full flex-col">
      {mark && <div className="mb-4 flex justify-center">{mark}</div>}
      <div className="flex flex-col gap-1 text-center">
        <h1 className="text-lg font-medium text-foreground">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <form
        action={action}
        method={action ? "post" : undefined}
        className="mt-6 flex flex-col gap-3"
      >
        {children}
        {cta && (
          <Button type="submit" size="lg" className="w-full">
            {cta}
          </Button>
        )}
      </form>
      {footer}
    </div>
  );
}

// What a role is called where a person picks the org to land in.
const ROLE = { owner: "Owner", member: "Member" } as const;

export function LockScreen({
  step,
  email,
  said = null,
  locked = false,
  next,
  because,
  emails = true,
  noMail = false,
  made,
  landings = [],
  you,
  plain = false,
}: {
  // Which leg of the way in this is: who you are, the code, or where to land.
  step: "who" | "code" | "choose";
  // The column alone on the bare ground, with no wallpaper and no clock:
  // what production wears for now.
  plain?: boolean;
  // The address a code went to, on the code step.
  email?: string;
  // What the last leg left to say, and whether it stopped the sign-in.
  said?: string | null;
  locked?: boolean;
  // Where the sign-in is headed, and what asked for it.
  next?: string;
  because?: ReactNode;
  // Whether this deployment can mail a code at all.
  emails?: boolean;
  // No mail is configured: the code is on the server's terminal.
  noMail?: boolean;
  // The seeded way in, where this deployment has one.
  made?: Made[];
  // Where the person may land, and who they are, on the last step.
  landings?: Landing[];
  you?: Known;
}) {
  const still = useReducedMotion();
  const [people, setPeople] = useState<Known[]>([]);
  useEffect(() => setPeople(known()), []);

  const field = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState("");
  const carried = useRef<HTMLInputElement>(null);
  // The last digit sends the code, once the value it carries has caught up
  // with the boxes.
  useEffect(() => {
    if (code.length === 6) carried.current?.form?.requestSubmit();
  }, [code]);

  // The face on the code step is this device's memory, never the server's
  // answer: the server does not say whether an address has an account
  // before the code is right, and neither does this screen.
  const who =
    you ?? (email ? (people.find((p) => p.email === email) ?? null) : null);

  const onward = next && <input type="hidden" name="next" value={next} />;

  const pick = (p: Known) => {
    const input = field.current;
    if (!input) return;
    input.value = p.email;
    input.form?.requestSubmit();
  };

  const card =
    step === "choose" ? (
      <Column
        mark={<Face who={who} />}
        title="Where are you working?"
        description="You're in more than one org. You can move between them from the Maslow menu."
        action="/auth/switch"
        cta="Continue"
      >
        {onward}
        <RadioGroup
          name="membership"
          aria-label="Your orgs"
          defaultValue={landings[0]?.userId}
          className="gap-0 rounded-lg border border-border bg-background/80 p-1"
        >
          {landings.map((m) => (
            <Choice
              key={m.userId}
              value={m.userId}
              title={m.orgName}
              description={ROLE[m.role]}
            />
          ))}
        </RadioGroup>
      </Column>
    ) : step === "code" ? (
      <Column
        mark={<Face who={who} />}
        title={who ? who.name : "Check your inbox"}
        description={
          noMail ? (
            <>
              No mail is configured: the code for{" "}
              <span className="font-medium text-foreground">{email}</span> is in
              the server&rsquo;s terminal.
            </>
          ) : (
            <>
              Enter the six-digit code sent to{" "}
              <span className="font-medium text-foreground">{email}</span>.
            </>
          )
        }
        // Locked, the only thing left to do is start over, so the form is
        // the one that does it.
        action={locked ? "/auth/restart" : "/auth/code"}
        cta={locked ? "Start over" : null}
        footer={
          locked ? null : (
            <form
              action="/auth/restart"
              method="post"
              className="mt-4 flex justify-center"
            >
              {onward}
              <Button
                type="submit"
                variant="link"
                size="sm"
                className="text-muted-foreground"
              >
                Use a different email
              </Button>
            </form>
          )
        }
      >
        {onward}
        {!locked && (
          <>
            <input
              ref={carried}
              type="hidden"
              name="code"
              value={code}
              readOnly
            />
            <InputOTP
              maxLength={6}
              value={code}
              onChange={setCode}
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="one-time-code"
              autoFocus
              aria-label="Code"
              containerClassName="justify-center"
            >
              <InputOTPGroup>
                <InputOTPSlot
                  index={0}
                  className="size-10 bg-background/60 text-base"
                />
                <InputOTPSlot
                  index={1}
                  className="size-10 bg-background/60 text-base"
                />
                <InputOTPSlot
                  index={2}
                  className="size-10 bg-background/60 text-base"
                />
              </InputOTPGroup>
              <InputOTPSeparator className="text-muted-foreground" />
              <InputOTPGroup>
                <InputOTPSlot
                  index={3}
                  className="size-10 bg-background/60 text-base"
                />
                <InputOTPSlot
                  index={4}
                  className="size-10 bg-background/60 text-base"
                />
                <InputOTPSlot
                  index={5}
                  className="size-10 bg-background/60 text-base"
                />
              </InputOTPGroup>
            </InputOTP>
          </>
        )}
        {said && <Said>{said}</Said>}
      </Column>
    ) : (
      <Column
        title="Sign in"
        description={
          <>
            {because ? <>{because} </> : null}
            {emails
              ? "We'll email you a six-digit code. No password, no account to make."
              : "No identity provider is configured. Sign in as one of the seeded people."}
          </>
        }
        action={emails ? "/auth/email" : undefined}
        cta={emails ? "Continue" : null}
      >
        {onward}
        {emails && people.length > 0 && (
          <div className="flex flex-wrap justify-center gap-4 pb-2">
            {people.map((p) => (
              <Tile
                key={p.email}
                who={p}
                onPick={() => pick(p)}
                onForget={() => setPeople(forget(p.email))}
              />
            ))}
          </div>
        )}
        {emails && (
          <Input
            ref={field}
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            aria-label="Email"
            autoFocus
            required
            aria-invalid={said !== null || undefined}
            className="h-9 bg-background/60 dark:bg-background/60"
          />
        )}
        {said && <Said>{said}</Said>}
      </Column>
    );

  return (
    // Chrome over a wallpaper is the dark look, whichever look the desktop
    // wears: the words are on a picture, not on paper. Plain, the column
    // lies on the bare ground in the desktop's own look.
    <div
      className={cn(
        "fixed inset-0 z-50 overflow-y-auto text-foreground",
        plain ? "bg-canvas" : "dark",
      )}
    >
      {!plain && <Paper />}
      <div className="relative flex min-h-full flex-col items-center gap-12 px-6 py-12">
        {!plain && <Clock />}
        <motion.div
          key={step}
          initial={still ? false : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={BASE}
          className="flex w-full max-w-[360px] flex-1 flex-col justify-center pb-12"
        >
          {card}
          {made && step === "who" && <Made made={made} next={next} />}
        </motion.div>
      </div>
    </div>
  );
}
