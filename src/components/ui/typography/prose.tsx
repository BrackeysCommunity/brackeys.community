import { type ComponentProps, forwardRef } from "react";

import { cn } from "@/lib/utils";

type ProseProps = Omit<ComponentProps<"div">, "ref">;

const Prose = forwardRef<HTMLDivElement, ProseProps>(({ className, ...props }, ref) => {
  return (
    <div
      ref={ref}
      data-slot="prose"
      className={cn(
        // Base typography
        "text-sm/relaxed text-foreground",

        // Headings
        "[&_h1]:mt-8 [&_h1]:mb-4 [&_h1]:text-3xl [&_h1]:font-bold [&_h1]:tracking-tight",
        "[&_h2]:mt-6 [&_h2]:mb-3 [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:tracking-tight",
        "[&_h3]:mt-5 [&_h3]:mb-2 [&_h3]:text-xl [&_h3]:font-bold [&_h3]:tracking-tight",
        "[&_h4]:mt-4 [&_h4]:mb-2 [&_h4]:text-lg [&_h4]:font-bold [&_h4]:tracking-tight",
        "[&_h5]:mt-3 [&_h5]:mb-1 [&_h5]:text-base [&_h5]:font-bold",
        "[&_h6]:mt-3 [&_h6]:mb-1 [&_h6]:text-sm [&_h6]:font-bold",

        // Paragraphs
        "[&_p]:mb-3 [&_p]:text-pretty",

        // Lists
        "[&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-5",
        "[&_ol]:mb-3 [&_ol]:list-decimal [&_ol]:pl-5",
        "[&_li]:mb-1",

        // Links
        "[&_a]:text-accent [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:text-accent/80",

        // Inline code
        "[&_code]:rounded-sm [&_code]:border [&_code]:border-accent/20 [&_code]:bg-accent/10 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.9em] [&_code]:text-accent",

        // Pre blocks (reset nested code)
        "[&_pre]:mb-3 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-border [&_pre]:bg-card [&_pre]:p-3 [&_pre]:text-xs",
        "[&_pre_code]:border-none [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-foreground [&_pre_code]:text-inherit",

        // Blockquote
        "[&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-accent [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground [&_blockquote]:italic",

        // Horizontal rule
        "[&_hr]:my-6 [&_hr]:border-border",

        // Strong / em
        "[&_strong]:font-bold",
        "[&_em]:italic",

        // First/last child margin reset
        "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",

        className,
      )}
      {...props}
    />
  );
});
Prose.displayName = "Prose";

export { Prose, type ProseProps };
