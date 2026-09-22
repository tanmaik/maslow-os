import type { ReactNode } from "react";

// One part of a pane: one line on what it holds, and the rest, lying on
// the pane itself with a hairline between it and the next. The pane's
// head already says which pane this is, so the name is there for a
// screen reader and nowhere else.
export function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className="relative flex flex-col gap-4 py-5 [&+&]:border-t [&+&]:border-border"
    >
      <h2 className="sr-only">{title}</h2>
      {description && (
        <p className="text-sm text-muted-foreground text-pretty">
          {description}
        </p>
      )}
      {children}
    </section>
  );
}
