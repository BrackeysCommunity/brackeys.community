import { Link } from "@tanstack/react-router";

interface FooterColumn {
  label: string;
  links: { label: string; to?: string; href?: string }[];
}

const COLUMNS: FooterColumn[] = [
  {
    label: "COMMUNITY",
    links: [
      { label: "Discord server", href: "https://discord.gg/brackeys" },
      { label: "Code of conduct", href: "#" },
      { label: "Membership", href: "#" },
      { label: "Become a host", href: "#" },
    ],
  },
  {
    label: "RESOURCES",
    links: [
      { label: "Knowledge base", href: "#" },
      { label: "Command reference", to: "/command-center" },
      { label: "Bot deploy guide", href: "#" },
      { label: "Press kit", href: "#" },
    ],
  },
  {
    label: "JAMS",
    links: [
      { label: "Full calendar", href: "#" },
      { label: "Theme archive", href: "#" },
      { label: "Judging rubric", href: "#" },
      { label: "Past entries", href: "#" },
    ],
  },
  {
    label: "ACCOUNT",
    links: [
      { label: "Your profile", to: "/profile" },
      { label: "Collab board", to: "/collab" },
      { label: "Notifications", href: "#" },
      { label: "Sign out", href: "#" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="mt-16 w-full border-t border-muted/40 bg-card px-4 pt-10 pb-10 text-card-foreground sm:px-6 lg:px-10 xl:px-14">
      <div className="mx-auto grid w-full max-w-6xl gap-10 md:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))]">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <div
              className="h-5 w-5"
              style={{
                maskImage: "url(/brackeys-logo.svg)",
                maskSize: "contain",
                maskRepeat: "no-repeat",
                maskPosition: "center",
                WebkitMaskImage: "url(/brackeys-logo.svg)",
                WebkitMaskSize: "contain",
                WebkitMaskRepeat: "no-repeat",
                WebkitMaskPosition: "center",
                background:
                  "linear-gradient(135deg, var(--color-brackeys-yellow), var(--color-brackeys-fuscia), var(--color-brackeys-purple))",
              }}
            />
            <span className="font-mono text-sm font-bold text-foreground">
              Brackeys
              <span className="bg-linear-to-r from-[var(--color-brackeys-yellow)] via-[var(--color-brackeys-fuscia)] to-[var(--color-brackeys-purple)] bg-clip-text text-transparent">
                Community
              </span>
            </span>
          </div>
          <p className="max-w-xs font-sans text-xs text-muted-foreground">
            A guild for indie game devs. Built, maintained, and moderated by the Brackeys community
            since 2012.
          </p>
          <div className="mt-2 flex items-center gap-1.5 font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            All systems nominal
          </div>
        </div>

        {COLUMNS.map((col) => (
          <div key={col.label} className="flex flex-col gap-3">
            <div className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
              § {col.label}
            </div>
            <ul className="flex flex-col gap-2">
              {col.links.map((link) =>
                link.to ? (
                  <li key={link.label}>
                    <Link
                      to={link.to}
                      className="font-sans text-sm text-foreground transition-colors hover:text-primary"
                    >
                      {link.label}
                    </Link>
                  </li>
                ) : (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      className="font-sans text-sm text-foreground transition-colors hover:text-primary"
                      {...(link.href?.startsWith("http")
                        ? { target: "_blank", rel: "noopener noreferrer" }
                        : {})}
                    >
                      {link.label}
                    </a>
                  </li>
                ),
              )}
            </ul>
          </div>
        ))}
      </div>

      <div className="mx-auto mt-12 flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 border-t border-muted/30 pt-4 font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
        <span>◇ Brackeys Community · Est. 2012</span>
        <span>v{__APP_VERSION__} · made by the community</span>
      </div>
    </footer>
  );
}
