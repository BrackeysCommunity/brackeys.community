import { marked, type Tokens } from "marked";
import { type ComponentProps, Fragment, type ReactNode, forwardRef, useMemo } from "react";

import { useCensorNodes } from "@/components/ui/typography/censored";
import { InlineCode } from "@/components/ui/typography/inline-code";
import { useCensorFn } from "@/lib/hooks/use-censored";
import { cn } from "@/lib/utils";

type MarkedTextElement = "p" | "span" | "div" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6";

type MarkedTextProps = Omit<ComponentProps<"div">, "ref" | "children"> & {
  as?: MarkedTextElement;
  children: string;
  inline?: boolean;
  /** Opt out of the viewer's profanity censor. For an author looking at a
   * preview of their own draft — censoring what someone is in the middle
   * of writing is worse than refusing it outright. */
  censor?: boolean;
};

type AnyToken = Tokens.Generic;

/** Applied to every text leaf on the way out. Identity when the viewer
 * has the censor off, which is the common case for the app's own copy.
 * `nodes` marks censored runs for the hover; `plain` is for attributes. */
type Censor = { nodes: (text: string) => ReactNode; plain: (text: string) => string };

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function renderTokens(tokens: AnyToken[] | undefined, censor: Censor): ReactNode {
  if (!tokens) return null;
  return tokens.map((t, i) => <Fragment key={i}>{renderToken(t, censor)}</Fragment>);
}

/** A table cell's own tokens, so a bolded or linked cell keeps its markup. */
function renderCells(cells: Tokens.TableCell[], Tag: "th" | "td", censor: Censor): ReactNode {
  return cells.map((cell, i) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length row
    <Tag key={i} style={cell.align ? { textAlign: cell.align } : undefined}>
      {renderTokens(cell.tokens as AnyToken[], censor)}
    </Tag>
  ));
}

function renderToken(t: AnyToken, censor: Censor): ReactNode {
  switch (t.type) {
    case "space":
      return null;
    case "paragraph":
      return <p>{renderTokens(t.tokens as AnyToken[], censor)}</p>;
    case "heading": {
      const depth = Math.min(6, Math.max(1, (t as Tokens.Heading).depth)) as 1 | 2 | 3 | 4 | 5 | 6;
      const Tag = `h${depth}` as const;
      return <Tag>{renderTokens(t.tokens as AnyToken[], censor)}</Tag>;
    }
    case "list": {
      const list = t as Tokens.List;
      const items = list.items.map((item, i) => (
        <li key={i}>{renderTokens(item.tokens as AnyToken[], censor)}</li>
      ));
      return list.ordered ? <ol start={list.start || undefined}>{items}</ol> : <ul>{items}</ul>;
    }
    case "table": {
      const table = t as Tokens.Table;
      // The wrapper is what makes a wide table survivable: the bio editor
      // renders this inside a flyout, and an unwrapped 6-column table
      // pushes the whole panel sideways.
      return (
        <div data-slot="marked-table">
          <table>
            <thead>
              <tr>{renderCells(table.header, "th", censor)}</tr>
            </thead>
            <tbody>
              {table.rows.map((row, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static render of an immutable string
                <tr key={i}>{renderCells(row, "td", censor)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    case "blockquote":
      return <blockquote>{renderTokens(t.tokens as AnyToken[], censor)}</blockquote>;
    case "code": {
      const block = t as Tokens.Code;
      return (
        <pre>
          <code>{censor.nodes(block.text)}</code>
        </pre>
      );
    }
    case "hr":
      return <hr />;
    case "br":
      return <br />;
    case "text": {
      const text = t as Tokens.Text;
      if (text.tokens) return <>{renderTokens(text.tokens as AnyToken[], censor)}</>;
      return censor.nodes(decodeEntities(text.text));
    }
    case "strong":
      return <strong>{renderTokens(t.tokens as AnyToken[], censor)}</strong>;
    case "em":
      return <em>{renderTokens(t.tokens as AnyToken[], censor)}</em>;
    case "del":
      return <del>{renderTokens(t.tokens as AnyToken[], censor)}</del>;
    case "codespan": {
      const code = t as Tokens.Codespan;
      return (
        <InlineCode className="translate-y-px">
          {censor.nodes(decodeEntities(code.text))}
        </InlineCode>
      );
    }
    case "link": {
      const link = t as Tokens.Link;
      return (
        <a
          href={link.href}
          rel="noreferrer noopener"
          target="_blank"
          title={link.title ?? undefined}
        >
          {renderTokens(link.tokens as AnyToken[], censor)}
        </a>
      );
    }
    case "image": {
      const image = t as Tokens.Image;
      // Alt text is the author's own words, so it goes through the censor
      // like any other leaf. The `src` never does — mangling a URL breaks
      // the image instead of cleaning it.
      return (
        <img
          src={image.href}
          alt={censor.plain(image.text ?? "")}
          title={image.title ?? undefined}
          loading="lazy"
          decoding="async"
        />
      );
    }
    case "escape":
      return censor.nodes((t as Tokens.Escape).text);
    // `html` stays dropped on purpose: this renderer's whole safety story
    // is that it never emits markup the author wrote.
    default:
      return null;
  }
}

const MarkedText = forwardRef<HTMLElement, MarkedTextProps>(
  ({ as: Tag = "div", children, inline, censor = true, className, ...props }, ref) => {
    const plain = useCensorFn();
    const nodes = useCensorNodes();
    const apply = useMemo<Censor>(
      () => (censor ? { nodes, plain } : { nodes: (text) => text, plain: (text) => text }),
      [censor, nodes, plain],
    );

    const rendered = useMemo(() => {
      if (inline) {
        const tokens = marked.Lexer.lexInline(children) as AnyToken[];
        return renderTokens(tokens, apply);
      }
      const tokens = marked.lexer(children) as AnyToken[];
      return renderTokens(tokens, apply);
    }, [children, inline, apply]);

    return (
      <Tag
        ref={ref as never}
        data-slot="marked-text"
        className={cn(
          "text-sm/relaxed text-foreground",
          "[&_em]:italic [&_strong]:font-bold",
          "[&_a]:text-accent [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:text-accent/80",
          "[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-border [&_pre]:bg-card [&_pre]:p-3 [&_pre]:text-xs",
          "[&_pre_code]:border-none [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-foreground [&_pre_code]:text-inherit",
          "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5",
          "[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5",
          "[&_li]:mb-1",
          "[&_p]:mb-2 [&_p:last-child]:mb-0",
          "[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-accent [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground [&_blockquote]:italic",
          "[&_img]:my-3 [&_img]:h-auto [&_img]:max-h-96 [&_img]:max-w-full [&_img]:rounded",
          "[&_[data-slot=marked-table]]:my-3 [&_[data-slot=marked-table]]:overflow-x-auto",
          "[&_table]:w-full [&_table]:border-collapse [&_table]:text-xs",
          "[&_th]:border [&_th]:border-border [&_th]:bg-card [&_th]:p-2 [&_th]:text-left [&_th]:font-semibold",
          "[&_td]:border [&_td]:border-border [&_td]:p-2 [&_td]:align-top",
          inline && "[&_p]:mb-0 [&_p]:inline",
          className,
        )}
        {...props}
      >
        {rendered}
      </Tag>
    );
  },
);
MarkedText.displayName = "MarkedText";

export { MarkedText, type MarkedTextProps };
