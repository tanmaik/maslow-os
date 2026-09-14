"use client";

import { RiSearchLine } from "@remixicon/react";

import { Input } from "@/components/base/input/input";

// The field a list is searched from: a magnifier, and Return submits the
// form it stands in.
export function Search({
  name,
  defaultValue,
  placeholder,
}: {
  name: string;
  defaultValue?: string;
  placeholder: string;
}) {
  return (
    <Input
      name={name}
      size="small"
      defaultValue={defaultValue}
      placeholder={placeholder}
      leadingIcon={RiSearchLine}
    />
  );
}
