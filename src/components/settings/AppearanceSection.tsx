import { Badge } from "@/components/ui/badge";
import { MicroLabel } from "@/components/ui/typography";
import { useAppTheme } from "@/lib/hooks/use-app-theme";
import type { Theme } from "@/lib/themes";

import { OptionCard, SettingsSection } from "./SettingsUI";

/** Accent ramp under each preview — the colors a theme is recognised by. */
const SWATCHES = ["--primary", "--accent", "--success", "--warning", "--destructive"];

/**
 * A miniature of the app rendered *in* the theme it offers. `data-theme`
 * plus `dark` is exactly the pair every theme file selects on
 * (`[data-theme="x"].dark`), so the block below inherits that theme's
 * custom properties without the theme being applied to the page.
 *
 * The colors are read through `var(--background)` directly rather than
 * Tailwind's `bg-background`: the utility resolves `--color-background`,
 * which is substituted once at `:root` and so would keep the *page's*
 * palette inside this subtree.
 */
function ThemePreview({ theme }: { theme: Theme }) {
  return (
    <span
      aria-hidden
      data-theme={theme.id}
      className="dark flex h-24 flex-col gap-1.5 overflow-hidden rounded p-2.5"
      style={{ background: "var(--background)" }}
    >
      {/* Title bar — brand dot, then a nav rule. */}
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--primary)" }} />
        <span className="h-1.5 flex-1 rounded-full" style={{ background: "var(--muted)" }} />
      </span>

      <span className="flex min-h-0 flex-1 gap-1.5">
        {/* A card with two lines of copy and a button. */}
        <span
          className="flex flex-1 flex-col justify-center gap-1 rounded border p-1.5"
          style={{ background: "var(--card)", borderColor: "var(--muted)" }}
        >
          <span
            className="h-1 w-2/3 rounded-full opacity-80"
            style={{ background: "var(--foreground)" }}
          />
          <span
            className="h-1 w-1/2 rounded-full opacity-60"
            style={{ background: "var(--muted-foreground)" }}
          />
          <span className="mt-0.5 h-2.5 w-9 rounded-sm" style={{ background: "var(--accent)" }} />
        </span>

        <span className="flex w-4 flex-col gap-1">
          {SWATCHES.map((token) => (
            <span
              key={token}
              className="flex-1 rounded-[2px]"
              style={{ background: `var(${token})` }}
            />
          ))}
        </span>
      </span>
    </span>
  );
}

/**
 * The theme gallery. Sixteen themes is more than a dropdown can carry —
 * here each one shows what it actually looks like before it's applied,
 * which is the whole reason the picker moved off the header cog.
 */
export function AppearanceSection() {
  const { themeId, setTheme, themes, sections } = useAppTheme();
  const active = themes.find((t) => t.id === themeId);

  return (
    <SettingsSection
      index="01"
      title="Theme"
      hint="Applies instantly and only to this browser — nothing here is saved to your account."
      action={
        active ? (
          <Badge size="label" variant="outline">
            {active.name.toUpperCase()}
          </Badge>
        ) : null
      }
    >
      <div className="flex flex-col gap-6">
        {sections.map((section) => (
          <div key={section.mode} className="flex flex-col gap-2.5">
            <MicroLabel as="p" bold className="uppercase">
              {section.label} · {section.themes.length}
            </MicroLabel>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {section.themes.map((theme) => (
                <OptionCard
                  key={theme.id}
                  active={theme.id === themeId}
                  title={theme.name}
                  description={theme.description}
                  onClick={() => setTheme(theme.id)}
                >
                  <ThemePreview theme={theme} />
                </OptionCard>
              ))}
            </div>
          </div>
        ))}
      </div>
    </SettingsSection>
  );
}
