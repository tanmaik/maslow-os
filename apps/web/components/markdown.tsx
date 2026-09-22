import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

const PLUGINS = [remarkGfm];

// Markdown rendered on the theme's tokens, read again only when its
// words change.
export const Markdown = memo(function Markdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "select-text max-w-2xl space-y-3 text-sm text-foreground [&_a]:underline [&_blockquote]:border-s-2 [&_blockquote]:border-border [&_blockquote]:ps-3 [&_blockquote]:text-muted-foreground [&_code]:rounded-md [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:break-words [&_code]:[overflow-wrap:anywhere] [&_h1]:text-lg font-semibold [&_h2]:text-base font-semibold [&_h3]:text-base font-medium [&_hr]:border-t [&_hr]:border-border [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:ps-5 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_table]:w-full [&_td]:border-t [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:text-sm font-medium [&_ul]:list-disc [&_ul]:ps-5 [&_p]:text-pretty",
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={PLUGINS}>{children}</ReactMarkdown>
    </div>
  );
});
