import { Section, SectionAction } from "@/components/ui/section";
import { MicroLabel, Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { allBotCommands, marcoMacros, PROTOCOL_COUNT } from "@/data/commands";

/**
 * Rows built, not rows shown. The panel is clipped to the height of the
 * section beside it, so what this controls is how far the list can run
 * before the fade takes over — deliberately more than can ever fit, so
 * the cut lands mid-list and reads as "there is more".
 *
 * Slash commands lead and macros top the list up, rather than each kind
 * getting a fixed share: the registry is only a handful of slash commands
 * against fifty-odd macros, so a fixed split left the panel two-thirds
 * empty under a fade advertising more.
 */
const SAMPLE_COUNT = 24;

/**
 * The command center, in the size it deserves on a landing page: a count
 * and a run of real commands. The old node card advertised a hard-coded
 * "58 protocols" next to four invented command names.
 */
export function CommandCenterTeaser() {
  const samples = [
    // `cmd` already carries its leading slash, the same way the command
    // center's own terminal renders it.
    ...allBotCommands.map((c) => ({ key: c.id, label: c.cmd, description: c.description })),
    ...marcoMacros.map((m) => ({
      key: `macro:${m.name}`,
      label: `[]${m.name}`,
      description: m.description.split("\n")[0]!,
    })),
  ].slice(0, SAMPLE_COUNT);

  return (
    <Section
      id="protocols"
      title="COMMAND CENTER"
      size="sm"
      blurb={`${PROTOCOL_COUNT} protocols across the Brackeys bots.`}
      action={<SectionAction to="/command-center">OPEN TERMINAL</SectionAction>}
    >
      {/* The panel is sized by its *neighbour*, not its contents. The well
          is taken out of flow (`absolute inset-0`) so the list can't push
          the shared grid row taller — otherwise a 28-row list simply wins
          the row and nothing ever clips. What's left in flow is this box:
          `flex-1` to fill whatever height the row gives the section, and
          `min-h-36` — the four rows the panel used to be — as the floor
          when the signup list beside it is short.

          Clipped rather than scrolled: a nested scroller inside an
          already-scrolling page swallows the wheel, and the overflow is
          here to send people to the terminal. */}
      <div className="relative min-h-36 flex-1">
        <Well className="absolute inset-0 overflow-hidden">
          <ul className="divide-y divide-muted/20">
            {samples.map((s) => (
              <li key={s.key} className="flex items-baseline gap-3 px-3 py-2">
                <MicroLabel variant="accent" className="shrink-0">
                  {s.label}
                </MicroLabel>
                <Text as="div" size="sm" variant="muted" ellipsis className="min-w-0 flex-1">
                  {s.description}
                </Text>
              </li>
            ))}
          </ul>

          {/* The "more below" tell. `pointer-events-none` so the rows it
              covers stay clickable if they ever become links. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-linear-to-t from-card via-card/80 to-transparent"
          />
        </Well>
      </div>
    </Section>
  );
}
