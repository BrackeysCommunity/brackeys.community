import { marked, type Tokens } from "marked";
import { type ComponentProps, Fragment, type ReactNode, forwardRef, useMemo } from "react";

import { InlineCode } from "@/components/ui/typography/inline-code";
import { cn } from "@/lib/utils";

type MarkedTextElement = "p" | "span" | "div" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6";

type MarkedTextProps = Omit<ComponentProps<"div">, "ref" | "children"> & {
  as?: MarkedTextElement;
  children: string;
  inline?: boolean;
};

type AnyToken = Tokens.Generic;

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function renderTokens(tokens: AnyToken[] | undefined): ReactNode {
  if (!tokens) return null;
  return tokens.map((t, i) => <Fragment key={i}>{renderToken(t)}</Fragment>);
}

function renderToken(t: AnyToken): ReactNode {
  switch (t.type) {
    case "space":
      return null;
    case "paragraph":
      return <p>{renderTokens(t.tokens as AnyToken[])}</p>;
    case "heading": {
      const depth = Math.min(6, Math.max(1, (t as Tokens.Heading).depth)) as 1 | 2 | 3 | 4 | 5 | 6;
      const Tag = `h${depth}` as const;
      return <Tag>{renderTokens(t.tokens as AnyToken[])}</Tag>;
    }
    case "list": {
      const list = t as Tokens.List;
      const items = list.items.map((item, i) => (
        <li key={i}>{renderTokens(item.tokens as AnyToken[])}</li>
      ));
      return list.ordered ? <ol>{items}</ol> : <ul>{items}</ul>;
    }
    case "blockquote":
      return <blockquote>{renderTokens(t.tokens as AnyToken[])}</blockquote>;
    case "code": {
      const block = t as Tokens.Code;
      return (
        <pre>
          <code>{block.text}</code>
        </pre>
      );
    }
    case "hr":
      return <hr />;
    case "br":
      return <br />;
    case "text": {
      const text = t as Tokens.Text;
      if (text.tokens) return <>{renderTokens(text.tokens as AnyToken[])}</>;
      return decodeEntities(text.text);
    }
    case "strong":
      return <strong>{renderTokens(t.tokens as AnyToken[])}</strong>;
    case "em":
      return <em>{renderTokens(t.tokens as AnyToken[])}</em>;
    case "del":
      return <del>{renderTokens(t.tokens as AnyToken[])}</del>;
    case "codespan": {
      const code = t as Tokens.Codespan;
      return <InlineCode className="translate-y-px">{decodeEntities(code.text)}</InlineCode>;
    }
    case "link": {
      const link = t as Tokens.Link;
      return (
        <a href={link.href} rel="noreferrer noopener" target="_blank">
          {renderTokens(link.tokens as AnyToken[])}
        </a>
      );
    }
    case "escape":
      return (t as Tokens.Escape).text;
    default:
      return null;
  }
}

const MarkedText = forwardRef<HTMLElement, MarkedTextProps>(
  ({ as: Tag = "div", children, inline, className, ...props }, ref) => {
    const rendered = useMemo(() => {
      if (inline) {
        const tokens = marked.Lexer.lexInline(children) as AnyToken[];
        return renderTokens(tokens);
      }
      const tokens = marked.lexer(children) as AnyToken[];
      return renderTokens(tokens);
    }, [children, inline]);

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
