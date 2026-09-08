"use client";

import { Input } from "@/components/ui/input";

// The name of one connected account, saved when the person presses Enter or
// leaves the field for anything but a button, whose own submit then stands
// alone. The account just connected starts with the cursor in it.
export function AccountName({
  account,
  name,
  focus,
}: {
  account: string;
  name: string | null;
  focus: boolean;
}) {
  return (
    <form
      action="/settings/connections"
      method="post"
      className="min-w-0 flex-1"
    >
      <input type="hidden" name="intent" value="rename" />
      <input type="hidden" name="account" value={account} />
      <Input
        name="name"
        defaultValue={name ?? ""}
        placeholder="Name this account, e.g. work"
        aria-label="Account name"
        maxLength={40}
        autoFocus={focus}
        autoComplete="off"
        className="h-7 max-w-64 text-[0.8rem]"
        onBlur={(e) => {
          const to = e.relatedTarget;
          if (to instanceof Element && to.closest("button")) return;
          if (e.currentTarget.value.trim() !== (name ?? ""))
            e.currentTarget.form?.requestSubmit();
        }}
      />
    </form>
  );
}
