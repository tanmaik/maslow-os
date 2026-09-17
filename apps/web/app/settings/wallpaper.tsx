"use client";

import { RiImageAddLine } from "@remixicon/react";
import { useState } from "react";

import {
  DEFAULT_PAPER,
  PAPERS,
  type Kept,
  type Papers,
} from "@/app/desktop/wallpapers";
import { CloseButton } from "@/components/base/buttons/close-button";
import { cx } from "@/utils/cx";

// What a wallpaper of the person's own may weigh, said here as the page
// says it and refused again by the route.
const LIMIT = 24 * 1024 * 1024;

// Keeps one picture: an address to put it at, the put itself, and the key
// recorded once the object is there. A store that signs no address answers
// with none, and the picture is sent to the server whole.
async function kept(file: File): Promise<Response> {
  const asked = await fetch("/desktop/wallpaper", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: file.type, bytes: file.size }),
  });
  if (!asked.ok) return asked;
  const to = (await asked.json()) as { key: string; url: string } | null;
  if (!to) {
    const body = new FormData();
    body.append("wallpaper", file);
    return fetch("/desktop/wallpaper", { method: "POST", body });
  }
  const put = await fetch(to.url, { method: "PUT", body: file });
  if (!put.ok)
    return new Response("That picture could not be kept.", { status: 502 });
  return fetch("/desktop/wallpaper", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key: to.key }),
  });
}

// Tells the desktop showing this page which wallpaper to wear, so a choice
// made in a Settings window reaches the desktop behind it at once.
function told(choice: string) {
  if (window.parent !== window)
    window.parent.postMessage({ maslow: "wallpaper", choice }, location.origin);
}

// One tile: the picture, 16:10, ringed when it is the one being worn.
function Tile({
  name,
  credit,
  src,
  chosen,
  onPick,
  onRemove,
}: {
  name: string;
  credit?: string;
  src: string | null;
  chosen: boolean;
  onPick: () => void;
  onRemove?: () => void;
}) {
  return (
    <div className="group relative flex flex-col gap-1.5">
      <button
        type="button"
        aria-label={name}
        aria-pressed={chosen}
        onClick={onPick}
        className={cx(
          "block aspect-16/10 w-full overflow-hidden rounded-2lg bg-canvas outline-none",
          "ring-offset-2 ring-offset-background-primary-default focus-visible:ring-2 focus-visible:ring-border-focus-ring",
          chosen && "ring-2 ring-border-focus-ring",
        )}
      >
        {src && (
          <img
            // A built-in's tile is its small copy; a person's own picture
            // has none and is drawn as it is.
            src={
              src.startsWith("/wallpapers/")
                ? src.replace("/wallpapers/", "/wallpapers/small/")
                : src
            }
            alt=""
            loading="lazy"
            decoding="async"
            className="size-full object-cover object-center"
          />
        )}
      </button>
      <span className="truncate text-caption-1-medium text-text-secondary">
        {name}
      </span>
      {credit && (
        <span className="-mt-1.5 truncate text-caption-1-regular text-text-tertiary">
          {credit}
        </span>
      )}
      {onRemove && (
        <CloseButton
          size="2xs"
          aria-label={`Remove ${name}`}
          onClick={onRemove}
          className="absolute top-1.5 right-1.5 bg-background-primary-default opacity-0 transition-opacity duration-fast ease-out-quart group-hover:opacity-100 focus-visible:opacity-100"
        />
      )}
    </div>
  );
}

// What the desktop lies on: the wallpapers that ship with Maslow, then the
// person's own and the place to add one. Picking wears it at once.
export function Wallpaper({ papers }: { papers: Papers | null }) {
  const [worn, setWorn] = useState(papers?.choice ?? null);
  const [own, setOwn] = useState<Kept[]>(papers?.own ?? []);
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);

  const wear = (to: string) => {
    setWorn(to);
    told(to);
    void fetch("/desktop/wallpaper", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ choice: to }),
    });
  };

  // A picture goes straight from here into the bucket, on an address the
  // server signs for exactly its size, and is recorded once it is there:
  // nothing this big would fit through a function. A deployment whose
  // store signs nothing signs no address, and it goes through the server.
  const take = async (file: File | null | undefined) => {
    if (!file || busy) return;
    if (file.size > LIMIT) {
      setSaid("That picture is larger than 24 MB.");
      return;
    }
    setBusy(true);
    setSaid(null);
    const res = await kept(file).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setSaid((await res?.text()) || "That picture could not be kept.");
      return;
    }
    const made = (await res.json()) as Kept;
    setOwn((was) => [made, ...was]);
    setWorn(`own:${made.key}`);
    told(`own:${made.key}`);
  };

  const drop = async (key: string) => {
    setOwn((was) => was.filter((w) => w.key !== key));
    if (worn === `own:${key}`) {
      setWorn("plain");
      told("plain");
    }
    await fetch(`/desktop/wallpaper?key=${encodeURIComponent(key)}`, {
      method: "DELETE",
    }).catch(() => {});
  };

  return (
    <div id="wallpaper" className="flex scroll-mt-20 flex-col gap-3">
      <h3 className="text-body-regular text-text-primary">Wallpaper</h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {PAPERS.map((p) => (
          <Tile
            key={p.id}
            name={p.name}
            credit={p.credit}
            src={p.src}
            chosen={(worn ?? DEFAULT_PAPER) === p.id}
            onPick={() => wear(p.id)}
          />
        ))}
      </div>
      <h4 className="pt-2 text-caption-1-medium text-text-tertiary">Yours</h4>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            void take(e.dataTransfer.files[0]);
          }}
          className={cx(
            "flex aspect-16/10 cursor-pointer flex-col items-center justify-center gap-1 rounded-2lg border border-dashed border-border-button-default bg-background-secondary-default text-center transition-colors duration-fast ease-out-quart hover:bg-background-secondary-hover",
            over && "border-border-focus-ring bg-background-secondary-hover",
            busy && "cursor-progress",
          )}
        >
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            onChange={(e) => {
              void take(e.currentTarget.files?.[0]);
              e.currentTarget.value = "";
            }}
          />
          <RiImageAddLine className="size-5 text-foreground-icon-tertiary" />
          <span className="px-2 text-caption-1-medium text-text-secondary">
            {busy ? "Keeping…" : "Add a picture"}
          </span>
        </label>
        {/* Numbered in the order they were kept, so two of a person's own
            are two different things to name and to remove. */}
        {own.map((w, n) => (
          <Tile
            key={w.key}
            name={own.length > 1 ? `Yours ${n + 1}` : "Yours"}
            src={w.url}
            chosen={worn === `own:${w.key}`}
            onPick={() => wear(`own:${w.key}`)}
            onRemove={() => void drop(w.key)}
          />
        ))}
      </div>
      {said && (
        <p className="text-caption-1-regular text-text-error-primary">{said}</p>
      )}
    </div>
  );
}
