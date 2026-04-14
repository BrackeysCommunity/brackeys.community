import DOMPurify from "dompurify";
import { marked } from "marked";
import { type ComponentProps, forwardRef, useMemo } from "react";

import { cn } from "@/lib/utils";

type MarkedTextElement = "p" | "span" | "div" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6";

type MarkedTextProps = Omit<ComponentProps<"div">, "ref" | "children"> & {
  as?: MarkedTextElement;
  children: string;
  inline?: boolean;
};

const MarkedText = forwardRef<HTMLElement, MarkedTextProps>(
  ({ as: Tag = "div", children, inline, className, ...props }, ref) => {
    const html = useMemo(() => {
      const raw = inline ? marked.parseInline(children) : marked.parse(children);
      return DOMPurify.sanitize(raw as string);
    }, [children, inline]);

    return (
      <Tag
        ref={ref as never}
        data-slot="marked-text"
        className={cn(
          // Apply prose-like styling to rendered markdown
          "text-sm/relaxed text-foreground",
          "[&_em]:italic [&_strong]:font-bold",
          "[&_a]:text-accent [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:text-accent/80",
          "[&_code]:rounded-sm [&_code]:border [&_code]:border-accent/20 [&_code]:bg-accent/10 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.9em] [&_code]:text-accent",
          "[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-border [&_pre]:bg-card [&_pre]:p-3 [&_pre]:text-xs",
          "[&_pre_code]:border-none [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-foreground [&_pre_code]:text-inherit",
          "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5",
          "[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5",
          "[&_li]:mb-1",
          "[&_p]:mb-2 [&_p:last-child]:mb-0",
          "[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-accent [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground [&_blockquote]:italic",
          inline && "[&_p]:mb-0 [&_p]:inline",
          className,
        )}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized by DOMPurify
        dangerouslySetInnerHTML={{ __html: html }}
        {...props}
      />
    );
  },
);
MarkedText.displayName = "MarkedText";

export { MarkedText, type MarkedTextProps };
