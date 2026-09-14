import type { ReactNode } from "react";

// One well of a pane: a BoardUI card, one line on what it holds, and the
// rest. The toolbar already says which pane this is, so the name is there
// for a screen reader and nowhere else. Settings has one radius, 16, the
// one BoardUI's own settings card carries.
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
      className="prefs-well relative flex flex-col gap-4 rounded-2xl border border-border-button-default bg-background-primary-default p-5 shadow-card"
    >
      <h2 className="sr-only">{title}</h2>
      {description && (
        <p className="text-body-2-regular text-text-secondary text-pretty">
          {description}
        </p>
      )}
      {children}
    </section>
  );
}
