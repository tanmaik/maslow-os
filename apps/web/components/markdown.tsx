import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cx } from "@/utils/cx";

// A record's body, which is markdown, rendered on the theme's tokens.
export function Markdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "max-w-2xl space-y-3 text-body-regular text-text-primary [&_a]:underline [&_blockquote]:border-s-2 [&_blockquote]:border-separator-border [&_blockquote]:ps-3 [&_blockquote]:text-text-secondary [&_code]:rounded-md [&_code]:bg-background-secondary-default [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-body-2-regular [&_code]:break-words [&_code]:[overflow-wrap:anywhere] [&_h1]:text-title-3-semibold [&_h2]:text-headline-semibold [&_h3]:text-headline-medium [&_hr]:border-t [&_hr]:border-separator-border [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:ps-5 [&_pre]:overflow-x-auto [&_pre]:rounded-2lg [&_pre]:bg-background-secondary-default [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_table]:w-full [&_td]:border-t [&_td]:border-separator-border [&_td]:px-2 [&_td]:py-1 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:text-body-medium [&_ul]:list-disc [&_ul]:ps-5 [&_p]:text-pretty",
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
