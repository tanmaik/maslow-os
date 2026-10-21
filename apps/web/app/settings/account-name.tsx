"use client";

import { InputBase } from "@/components/base/input/input";

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
      <InputBase
        size="small"
        name="name"
        defaultValue={name ?? ""}
        placeholder="Name this account, e.g. work"
        aria-label="Account name"
        maxLength={40}
        autoFocus={focus}
        autoComplete="off"
        fieldClassName="max-w-[202px]"
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLElement).blur();
        }}
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
