import {
  ApplicationCommandType,
  ContextMenuCommandBuilder,
  type RESTPostAPIApplicationCommandsJSONBody,
  SlashCommandBuilder,
  type SlashCommandBooleanOption,
  type SlashCommandStringOption,
} from "discord.js";

import { COLLAB_TYPES, ID_BOUNDS, JAM_ENTRY_SORTS, SEARCH_MAX } from "./custom-id.ts";
import { COMMAND, OPT, PROFILE_CONTEXT_MENU, SUB } from "./dispatch.ts";

/**
 * The command set, as the JSON Discord registers. Built once at boot and
 * diffed against the guild's current commands (`discord/register.ts`);
 * `bun run register` does the same on demand. Three top-level data
 * commands plus `/ping` and a context-menu entry — well under the 100 per
 * guild, and shaped so no option set outgrows a button's `custom_id`.
 */
interface Shareable {
  addBooleanOption(fn: (option: SlashCommandBooleanOption) => SlashCommandBooleanOption): unknown;
}

export function buildManifest(site: string): RESTPostAPIApplicationCommandsJSONBody[] {
  const jamOption = (o: SlashCommandStringOption, description: string) =>
    o
      .setName(OPT.jam)
      .setDescription(description)
      .setRequired(true)
      .setAutocomplete(true)
      .setMaxLength(300);
  const searchOption = (o: SlashCommandStringOption, description: string) =>
    o.setName(OPT.search).setDescription(description).setMaxLength(SEARCH_MAX);
  // Builders mutate in place, so this can hand back the same builder type.
  const shareOption = <T extends Shareable>(builder: T): T => {
    builder.addBooleanOption((o) =>
      o.setName(OPT.share).setDescription("Post the answer to the channel instead of just to you"),
    );
    return builder;
  };

  const jam = new SlashCommandBuilder()
    .setName(COMMAND.jam)
    .setDescription(`Game jams on ${site}`)
    .addSubcommand((sub) =>
      sub.setName(SUB.jam.now).setDescription("The current or next Brackeys jam"),
    )
    .addSubcommand((sub) =>
      shareOption(
        sub
          .setName(SUB.jam.info)
          .setDescription("Details for any jam")
          .addStringOption((o) => jamOption(o, "Jam title (autocompletes) or itch.io slug")),
      ),
    )
    .addSubcommand((sub) =>
      shareOption(
        sub
          .setName(SUB.jam.entries)
          .setDescription("Browse a jam's entries")
          .addStringOption((o) => jamOption(o, "Jam title (autocompletes) or itch.io slug"))
          .addStringOption((o) =>
            o
              .setName(OPT.sort)
              .setDescription("Order")
              .addChoices(...JAM_ENTRY_SORTS.map((s) => ({ name: s, value: s }))),
          )
          .addStringOption((o) => searchOption(o, "Filter by game title or author")),
      ),
    )
    .addSubcommand((sub) =>
      shareOption(
        sub
          .setName(SUB.jam.results)
          .setDescription("Top placements per criterion")
          .addStringOption((o) => jamOption(o, "Jam title (autocompletes) or itch.io slug")),
      ),
    );

  const collab = new SlashCommandBuilder()
    .setName(COMMAND.collab)
    .setDescription(`The collab board on ${site}`)
    .addSubcommand((sub) =>
      shareOption(
        sub
          .setName(SUB.collab.browse)
          .setDescription("Open collab posts, with filters")
          .addStringOption((o) =>
            o
              .setName(OPT.type)
              .setDescription("Paid work or hobby")
              .addChoices(...COLLAB_TYPES.map((t) => ({ name: t, value: t }))),
          )
          .addIntegerOption((o) =>
            o
              .setName(OPT.skill)
              .setDescription("Posts wanting this skill")
              .setAutocomplete(true)
              .setMinValue(1)
              .setMaxValue(ID_BOUNDS.skillId),
          )
          .addIntegerOption((o) =>
            o
              .setName(OPT.role)
              .setDescription("Posts hiring this role")
              .setAutocomplete(true)
              .setMinValue(1)
              .setMaxValue(ID_BOUNDS.roleId),
          )
          .addStringOption((o) =>
            o
              .setName(OPT.jam)
              .setDescription("Posts for this jam")
              .setAutocomplete(true)
              .setMaxLength(300),
          )
          .addStringOption((o) => searchOption(o, "Words in the title or description")),
      ),
    )
    .addSubcommand((sub) =>
      shareOption(
        sub
          .setName(SUB.collab.post)
          .setDescription("One post by its number")
          .addIntegerOption((o) =>
            o
              .setName(OPT.id)
              .setDescription("The number in the post's URL")
              .setRequired(true)
              .setMinValue(1),
          ),
      ),
    )
    .addSubcommand((sub) =>
      shareOption(sub.setName(SUB.collab.stats).setDescription("The board and teams at a glance")),
    );

  const member = shareOption(
    new SlashCommandBuilder()
      .setName(COMMAND.member)
      .setDescription(`A member's ${site} profile`)
      .addUserOption((o) => o.setName(OPT.user).setDescription("Mention a server member"))
      .addStringOption((o) =>
        o.setName(OPT.name).setDescription("…or type part of their site name").setMaxLength(100),
      ),
  );

  const team = shareOption(
    new SlashCommandBuilder()
      .setName(COMMAND.team)
      .setDescription(`A team on ${site}`)
      .addStringOption((o) =>
        o
          .setName(OPT.name)
          .setDescription("Team name (autocompletes)")
          .setRequired(true)
          .setAutocomplete(true)
          .setMaxLength(100),
      ),
  );

  const pingCmd = new SlashCommandBuilder()
    .setName(COMMAND.ping)
    .setDescription(`Is ${site} reachable, and how fast?`);

  const profileMenu = new ContextMenuCommandBuilder()
    .setName(PROFILE_CONTEXT_MENU)
    .setType(ApplicationCommandType.User);

  return [
    jam.toJSON(),
    collab.toJSON(),
    member.toJSON(),
    team.toJSON(),
    pingCmd.toJSON(),
    profileMenu.toJSON(),
  ];
}
