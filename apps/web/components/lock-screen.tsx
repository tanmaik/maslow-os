"use client";

// The lock screen: the way into Maslow, drawn on the desk's own wallpaper.
// Three steps on one screen — who you are, the code we mailed you, and
// which org you land in when you are in more than one.

import { RiCloseLine } from "@remixicon/react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { srcOf } from "@/app/room/wallpapers";
import { AuthCard } from "@/components/application/auth/auth-card";
import { Avatar } from "@/components/base/avatar/avatar";
import { Chip } from "@/components/base/badges/chip";
import { Divider } from "@/components/base/divider/divider";
import { Button } from "@/components/base/buttons/button";
import { LinkButton } from "@/components/base/buttons/link-button";
import { Input } from "@/components/base/input/input";
import { InputOtp } from "@/components/base/input-otp/input-otp";
import { RadioGroup } from "@/components/base/radio/radio";
import { RadioCard } from "@/components/base/radio/radio-card";
import { initials } from "@/lib/initials";
import { BASE } from "@/lib/motion";
import { cx } from "@/utils/cx";

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

// Remembers whoever is at the desk, so the next sign-in on this device
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

// The wallpaper this device last saw, so the lock screen wears it too.
export function rememberPaper(choice: string | null): void {
  if (choice) localStorage.setItem(PAPER, choice);
  else localStorage.removeItem(PAPER);
}

// What the desk lies on, under the lock screen: the picture this device
// last saw, Dusk until it has seen one, and a darkening over it deep enough
// that white words read over the lightest thing a desk can wear.
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
          className={cx(
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
    <div className="flex flex-col items-center gap-1 text-text-white">
      {/* A width held from the first paint, so nothing moves when the
          clock arrives. */}
      <span className="min-h-10 text-display-3-medium tabular-nums">
        {now?.toLocaleTimeString(undefined, {
          hour: "numeric",
          minute: "2-digit",
        }) ?? " "}
      </span>
      <span className="text-body-medium text-text-white/80">
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
      <Avatar
        // The ladder's next step up: the lock screen is the whole page, and
        // the face is what it is about.
        className="size-24 text-[28px] leading-9 font-semibold"
        src={who?.picture ?? undefined}
        alt={who?.name}
        initials={who ? initials(who.name) : undefined}
      />
    </motion.span>
  );
}

// What the last leg left to say, under what it is about.
function Said({ children }: { children: ReactNode }) {
  return (
    <p
      role="status"
      className="text-body-regular text-text-error-primary text-center"
    >
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
        className="flex w-28 flex-col items-center gap-2 rounded-2lg p-1 outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring"
      >
        <Face who={who} />
        <span className="w-full truncate text-body-medium text-text-primary">
          {who.name.split(" ")[0]}
        </span>
      </button>
      <button
        type="button"
        onClick={onForget}
        aria-label={`Forget ${who.name}`}
        className="absolute top-0 right-2 grid size-6 place-items-center rounded-full bg-background-quaternary-default text-foreground-icon-secondary opacity-0 transition-opacity duration-fast ease-plain group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-border-focus-ring focus-visible:outline-none"
      >
        <RiCloseLine className="size-4" aria-hidden />
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
    <div className="mt-8 flex flex-col gap-4">
      <Divider className="text-caption-1-medium">For development</Divider>
      <form action="/auth/dev" method="post" className="flex flex-col gap-4">
        {next && <input type="hidden" name="next" value={next} />}
        <div className="flex items-start gap-2">
          <Chip variant="caption" color="yellow" className="mt-px">
            dev
          </Chip>
          <p className="text-caption-1-regular text-text-secondary">
            These people are made up, and this way in does not exist in
            production.
          </p>
        </div>
        {/* Capped, so the way in is on the screen however many people are
            seeded and however short the screen is. */}
        <RadioGroup
          name="user"
          aria-label="Seeded people"
          defaultValue={first}
          className="max-h-[32dvh] gap-4 overflow-y-auto"
        >
          {made.map((org) => (
            <div key={org.org} className="flex flex-col gap-2">
              <p className="text-caption-1-semibold text-text-secondary">
                {org.org}
              </p>
              {org.people.map((p) => (
                <RadioCard
                  key={p.id}
                  value={p.id}
                  title={p.name}
                  description={p.email}
                />
              ))}
            </div>
          ))}
        </RadioGroup>
        <Button type="submit" variant="secondary" className="w-full">
          Sign in
        </Button>
      </form>
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
}: {
  // Which leg of the way in this is: who you are, the code, or where to land.
  step: "who" | "code" | "choose";
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
      <AuthCard
        bare
        centered
        providers={[]}
        logo={<Face who={who} />}
        title="Where are you working?"
        description="You're in more than one org. You can move between them from the Maslow menu."
        action="/auth/switch"
        cta="Continue"
        footer={null}
        fields={
          <>
            {onward}
            <RadioGroup
              name="membership"
              aria-label="Your orgs"
              defaultValue={landings[0]?.userId}
              className="gap-2"
            >
              {landings.map((m) => (
                <RadioCard
                  key={m.userId}
                  value={m.userId}
                  title={
                    <span className="flex items-center gap-2">
                      <Avatar size="sm" initials={initials(m.orgName)} />
                      {m.orgName}
                    </span>
                  }
                  description={ROLE[m.role]}
                />
              ))}
            </RadioGroup>
          </>
        }
      />
    ) : step === "code" ? (
      <AuthCard
        bare
        centered
        providers={[]}
        logo={<Face who={who} />}
        title={who ? who.name : "Check your inbox"}
        description={
          noMail ? (
            <>
              No mail is configured: the code for{" "}
              <span className="text-body-medium text-text-primary">
                {email}
              </span>{" "}
              is in the server&rsquo;s terminal.
            </>
          ) : (
            <>
              Enter the six-digit code sent to{" "}
              <span className="text-body-medium text-text-primary">
                {email}
              </span>
              .
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
              className="mt-6 flex justify-center"
            >
              {onward}
              <LinkButton type="submit" size="small">
                Use a different email
              </LinkButton>
            </form>
          )
        }
        fields={
          <div className="flex flex-col gap-3">
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
                <InputOtp
                  value={code}
                  onChange={setCode}
                  groupEvery={3}
                  aria-label="Code"
                  className="justify-center"
                />
              </>
            )}
            {said && <Said>{said}</Said>}
          </div>
        }
      />
    ) : (
      <AuthCard
        bare
        centered
        providers={[]}
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
        footer={null}
        fields={
          <div className="flex flex-col gap-3">
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
              <>
                <Input
                  ref={field}
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  aria-label="Email"
                  autoFocus
                  isRequired
                  isInvalid={said !== null}
                  fieldClassName="h-11"
                  inputClassName="placeholder:text-text-placeholder focus:placeholder:text-text-placeholder"
                />
              </>
            )}
            {said && <Said>{said}</Said>}
          </div>
        }
      />
    );

  return (
    // Chrome over a wallpaper is the dark look, whichever look the desk
    // wears: the words are on a picture, not on paper.
    <div className="dark fixed inset-0 z-50 overflow-y-auto">
      <Paper />
      <div className="relative flex min-h-full flex-col items-center gap-12 px-6 py-12">
        <Clock />
        <motion.div
          key={step}
          initial={still ? false : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={BASE}
          className="flex w-full max-w-[400px] flex-1 flex-col justify-center pb-12"
        >
          {card}
          {made && step === "who" && <Made made={made} next={next} />}
        </motion.div>
      </div>
    </div>
  );
}
