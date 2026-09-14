"use client";

import { useEffect, useRef, useState } from "react";

import { Avatar } from "@/components/base/avatar/avatar";
import { cx } from "@/utils/cx";

const SIDE = 512;

// Decodes any image the browser can read and re-encodes it small, as WebP
// where the browser can write it and PNG elsewhere. Null when it cannot
// decode the file.
async function shrink(file: File): Promise<File | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas
      .getContext("2d")!
      .drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((done) =>
      canvas.toBlob(done, "image/webp", 0.85),
    );
    if (!blob) return null;
    const ext = blob.type === "image/webp" ? "webp" : "png";
    const name = file.name.replace(/\.[^.]*$/, "") + "." + ext;
    return new File([blob], name, { type: blob.type });
  } catch {
    return null;
  }
}

// A picture that is its own file input: click it to choose another, which
// shows at once and is shrunk before the form sends it, so a photo straight
// off a phone is as welcome as a tidy PNG. A file the browser cannot decode
// goes through as is, for the server to explain. Saving while a shrink is
// under way waits for it.
export function ImageInput({
  id,
  name,
  src,
  fallback,
  className,
}: {
  id: string;
  name: string;
  src: string | null;
  fallback: string;
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef<Promise<void> | null>(null);
  const queued = useRef(false);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    const form = input.current?.form;
    if (!form) return;
    const wait = (ev: SubmitEvent) => {
      if (!pending.current) return;
      ev.preventDefault();
      if (queued.current) return;
      queued.current = true;
      pending.current.then(() => {
        queued.current = false;
        form.requestSubmit();
      });
    };
    form.addEventListener("submit", wait);
    return () => form.removeEventListener("submit", wait);
  }, []);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  return (
    <label htmlFor={id} className="group relative block cursor-pointer">
      <input
        ref={input}
        id={id}
        name={name}
        type="file"
        accept="image/*"
        aria-label="Change the picture"
        className="peer sr-only"
        onChange={(e) => {
          const el = e.currentTarget;
          const file = el.files?.[0];
          if (!file) return;
          const job = shrink(file).then((small) => {
            if (pending.current !== job) return;
            if (small) {
              const dt = new DataTransfer();
              dt.items.add(small);
              el.files = dt.files;
            }
            const url = URL.createObjectURL(small ?? file);
            if (!input.current) URL.revokeObjectURL(url);
            else setPreview(url);
            pending.current = null;
          });
          pending.current = job;
        }}
      />
      <Avatar
        size="lg"
        src={preview ?? src ?? undefined}
        initials={fallback}
        alt=""
        className={cx(
          "size-16 text-title-3-semibold peer-focus-visible:ring-2 peer-focus-visible:ring-border-focus-ring peer-focus-visible:ring-offset-2",
          className,
        )}
      />
      <span
        className={cx(
          "absolute inset-0 flex items-center justify-center rounded-full bg-background-primary-default/80 text-caption-1-semibold text-text-primary opacity-0 transition-opacity duration-fast ease-plain group-hover:opacity-100 peer-focus-visible:opacity-100",
          className,
        )}
      >
        Change
      </span>
    </label>
  );
}
