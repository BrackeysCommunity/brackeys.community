import { type ComponentProps, forwardRef } from "react";

import { cn } from "@/lib/utils";

type QuoteSource = {
  author?: string;
  href?: string;
  label?: string;
};

type QuoteProps = Omit<ComponentProps<"figure">, "ref"> & {
  source?: QuoteSource;
};

const Quote = forwardRef<HTMLElement, QuoteProps>(
  ({ source, className, children, ...props }, ref) => {
    return (
      <figure ref={ref} data-slot="quote" className={cn("my-4", className)} {...props}>
        <blockquote className="border-l-2 border-accent pl-4 text-sm/relaxed text-foreground italic">
          {children}
        </blockquote>
        {source?.author && (
          <figcaption className="mt-2 pl-4 text-xs text-muted-foreground">
            <span>&mdash; {source.author}</span>
            {source.label && <span>, {source.label}</span>}
            {source.href && (
              <>
                {" "}
                <cite>
                  <a
                    href={source.href}
                    className="underline underline-offset-2 hover:text-foreground"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {source.label ? undefined : source.href}
                  </a>
                </cite>
              </>
            )}
          </figcaption>
        )}
      </figure>
    );
  },
);
Quote.displayName = "Quote";

export { Quote, type QuoteProps, type QuoteSource };
