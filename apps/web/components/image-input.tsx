"use client";

import { useEffect, useRef } from "react";

import { Input } from "@/components/ui/input";

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

// A file input that shrinks a chosen image before the form sends it, so a
// photo straight off a phone is as welcome as a tidy PNG. A file the browser
// cannot decode goes through as is, for the server to explain. Saving while
// a shrink is under way waits for it.
export function ImageInput(props: React.ComponentProps<"input">) {
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef<Promise<void> | null>(null);

  useEffect(() => {
    const form = input.current?.form;
    if (!form) return;
    const wait = (ev: SubmitEvent) => {
      if (!pending.current) return;
      ev.preventDefault();
      pending.current.then(() => form.requestSubmit());
    };
    form.addEventListener("submit", wait);
    return () => form.removeEventListener("submit", wait);
  }, []);

  return (
    <Input
      {...props}
      ref={input}
      type="file"
      accept="image/*"
      onChange={(e) => {
        const el = e.currentTarget;
        const file = el.files?.[0];
        if (!file) return;
        const job = shrink(file).then((small) => {
          if (small) {
            const dt = new DataTransfer();
            dt.items.add(small);
            el.files = dt.files;
          }
          if (pending.current === job) pending.current = null;
        });
        pending.current = job;
      }}
    />
  );
}
