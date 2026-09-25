import { TextFontIcon } from "@hugeicons/core-free-icons";

import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { MicroLabel } from "@/components/ui/typography";
import { useAppSettings } from "@/lib/hooks/use-app-settings";
import { useAppTheme } from "@/lib/hooks/use-app-theme";

import { OptionCard, SettingRow, SettingsSection } from "./SettingsUI";
import { ThemePreview } from "./ThemePreview";

/**
 * The theme gallery. Sixteen themes is more than a dropdown can carry —
 * here each one shows what it actually looks like before it's applied,
 * which is the whole reason the picker moved off the header cog.
 */
export function AppearanceSection() {
  return (
    <>
      <LanguageSection />
      <ThemePicker />
    </>
  );
}

function ThemePicker() {
  const { themeId, setTheme, themes, sections } = useAppTheme();
  const active = themes.find((t) => t.id === themeId);

  return (
    <SettingsSection
      index="02"
      title="Theme"
      hint="Applies instantly and, like the filter, only to this browser — nothing here is saved to your account."
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

/**
 * Strong language is written, stored and shown — the filter only decides
 * whether the viewer sees it spelled out. It used to refuse the write
 * instead, which meant a bio nobody could save rather than one somebody
 * could choose not to read.
 */
function LanguageSection() {
  const { censorProfanity, setCensorProfanity } = useAppSettings();

  return (
    <SettingsSection
      index="01"
      title="Language"
      hint="Stored only in this browser. It changes what you see, never what anyone wrote."
    >
      <SettingRow
        label="Hide profanity"
        hint={
          censorProfanity
            ? "Swearing in bios, posts and comments renders as asterisks."
            : "Bios, posts and comments render exactly as they were written."
        }
        icon={TextFontIcon}
        control={
          <Switch
            checked={censorProfanity}
            onCheckedChange={setCensorProfanity}
            aria-label="Hide profanity"
          />
        }
      />
    </SettingsSection>
  );
}
