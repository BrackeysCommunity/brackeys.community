import { Link } from "@tanstack/react-router";

import { BrackeysMark } from "@/components/ui/brackeys-mark";
import { MicroLabel } from "@/components/ui/typography";

/**
 * Every entry here resolves to something real: an app route, the Discord,
 * or itch.io (where the jams the site tracks actually live).
 */
interface FooterLink {
  label: string;
  to?: string;
  href?: string;
}

interface FooterColumn {
  label: string;
  links: FooterLink[];
}

const COLUMNS: FooterColumn[] = [
  {
    label: "COMMUNITY",
    links: [
      { label: "Discord server", href: "https://discord.gg/brackeys" },
      { label: "Member directory", to: "/members" },
      { label: "Teams", to: "/teams" },
      { label: "Collab board", to: "/collab" },
      { label: "Post a collab", to: "/collab/new" },
    ],
  },
  {
    label: "JAMS",
    links: [
      { label: "Jam board", to: "/jams" },
      { label: "Full calendar", to: "/jams/calendar" },
      { label: "Archive", to: "/jams/archive" },
      { label: "Brackeys Game Jam", href: "https://itch.io/jam/brackeys-15" },
      { label: "Jam entries", href: "https://itch.io/jam/brackeys-15/entries" },
    ],
  },
  {
    label: "ITCH.IO",
    links: [
      { label: "Browse all jams", href: "https://itch.io/jams" },
      { label: "Upcoming jams", href: "https://itch.io/jams/upcoming" },
      { label: "Jams in progress", href: "https://itch.io/jams/in-progress" },
      { label: "Past jams", href: "https://itch.io/jams/past/sort-date" },
      { label: "itch.io home", href: "https://itch.io" },
    ],
  },
  {
    label: "ACCOUNT",
    links: [
      { label: "Your profile", to: "/profile" },
      { label: "Notifications", to: "/notifications" },
      { label: "Command center", to: "/command-center" },
      { label: "Game lobby", to: "/game" },
    ],
  },
];

const LEGAL_LINKS: FooterLink[] = [
  { label: "Terms of Service", to: "/terms" },
  { label: "Privacy Policy", to: "/privacy" },
];

const LINK_CLASS = "font-sans text-sm text-foreground transition-colors hover:text-primary";

function FooterLinkItem({
  link,
  className = LINK_CLASS,
}: {
  link: FooterLink;
  className?: string;
}) {
  if (link.to) {
    return (
      <Link to={link.to} className={className}>
        {link.label}
      </Link>
    );
  }
  return (
    <a
      href={link.href}
      className={className}
      {...(link.href?.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {link.label}
    </a>
  );
}

export function SiteFooter() {
  return (
    <footer className="w-full border-muted/40 bg-linear-to-b from-transparent to-background to-25% px-4 pt-10 pb-10 text-card-foreground sm:px-6 lg:px-10 xl:px-14">
      <div className="mx-auto grid w-full max-w-7xl gap-10 md:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))]">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <BrackeysMark className="h-5 w-5" />
            <span className="font-display text-sm font-bold text-foreground">
              Brackeys
              <span className="bg-linear-to-r from-[var(--color-brackeys-yellow)] via-[var(--color-brackeys-fuscia)] to-[var(--color-brackeys-purple)] bg-clip-text text-transparent">
                Community
              </span>
            </span>
          </div>
          <p className="max-w-xs font-sans text-xs text-muted-foreground">
            A Discord server for indie game devs. Built, maintained, and moderated by the Brackeys
            community.
          </p>
          <p className="max-w-xs font-sans text-xs text-muted-foreground">
            Jams run on{" "}
            <a
              href="https://itch.io/jams"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent underline underline-offset-2 hover:text-accent/80"
            >
              itch.io
            </a>{" "}
            — we track them, you ship on them.
          </p>

          <nav className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
            {LEGAL_LINKS.map((link) => (
              <FooterLinkItem key={link.label} link={link} />
            ))}
          </nav>
        </div>

        {COLUMNS.map((col) => (
          <div key={col.label} className="flex flex-col gap-3">
            <MicroLabel as="div" className="uppercase">
              § {col.label}
            </MicroLabel>
            <ul className="flex flex-col gap-2">
              {col.links.map((link) => (
                <li key={link.label}>
                  <FooterLinkItem link={link} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="mx-auto mt-12 flex w-full max-w-7xl flex-wrap items-center justify-between gap-3 border-t border-muted/30 pt-4">
        <MicroLabel>© {new Date().getFullYear()} · made by the community</MicroLabel>

        <MicroLabel>v{__APP_VERSION__}</MicroLabel>
      </div>
    </footer>
  );
}
