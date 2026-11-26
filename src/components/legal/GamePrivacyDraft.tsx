import { CONTACT, OPERATOR, SITE } from "@/lib/legal-meta";

import { GAME_DRAFT_DATES, GAME_NAME } from "./GameTermsDraft";
import { LegalDocument, type LegalSection } from "./LegalDocument";

/**
 * The game's privacy notice, unpublished, like the game's terms. Every
 * field it names is one the world service, the bot or the Activity writes
 * today; changing what they keep means changing this file with it.
 */

const A = "text-accent underline underline-offset-2 hover:text-accent/80";

export const GAME_PRIVACY_DRAFT: LegalSection[] = [
  {
    id: "what-the-game-keeps",
    heading: "What the game keeps",
    body: (
      <>
        <p>
          This notice covers {GAME_NAME} (the "Game"), which {OPERATOR.legalName} runs in Discord.
          The Privacy Policy of {SITE.name} covers the site itself. When you play, the Game keeps:
        </p>
        <ol>
          <li>
            your Discord user id, and the ids of the Discord servers you play in and of the channels
            and roles their admins choose for the Game;
          </li>
          <li>
            your character and everything it does: where it goes, what it fights, makes, trades,
            stages and reports, as facts of the shared world;
          </li>
          <li>
            the words you type to the bot: names you give things, goals you post, notes and labels;
          </li>
          <li>
            when you open the Activity, the sign-in Discord gives it with the{" "}
            <strong>identify</strong> permission, which the Game uses only to know which character
            is yours.
          </li>
        </ol>
        <p>
          The Game never reads messages in your server's channels, and the bot asks Discord for no
          privileged access: it cannot see member lists, presence or message content. It does not
          keep your Discord username, avatar or email address.
        </p>
      </>
    ),
  },
  {
    id: "where-it-is-kept",
    heading: "Where it is kept",
    body: (
      <>
        <p>
          The world and everything in the list above are kept in the world service's database. Only
          the world service writes to it.
        </p>
        <p>
          The bot keeps short-lived working records in its own cache, keyed by your Discord user id:
          rate limits, the screens you have open, and what a character in the world last said to
          you. Each expires on its own, the longest after 90 days, and all of them are removed when
          you leave the Game.
        </p>
      </>
    ),
  },
  {
    id: "narration",
    heading: "Narration",
    body: (
      <>
        <p>
          When a server's admins switch narration on, some of the Game's text is written by Claude,
          a language model made by Anthropic. We reach it through Anthropic's own API, from an
          organization used for nothing else, with training on our data off and zero data retention
          requested.
        </p>
        <p>
          What is sent is what the text is about: facts the world recorded, the names of characters,
          places and things, and, when you speak to a character in the world, the words you typed to
          it. Your Discord user id, your server's ids and anything from your Discord account are
          never sent.
        </p>
      </>
    ),
  },
  {
    id: "analytics",
    heading: "Analytics",
    body: (
      <p>
        The world service sends product analytics about play, such as which kind of action was
        pressed and how long it took, to PostHog, the analytics processor the Privacy Policy of{" "}
        {SITE.name} names. These events are keyed by your character's id, never by your Discord user
        id, and carry no words you typed.
      </p>
    ),
  },
  {
    id: "server-admins",
    heading: "What server admins see",
    body: (
      <p>
        A server's admins and staff see what the Game shows everyone in their server, plus that
        server's log: the moderation actions, reports and staged events in their server, with the
        characters involved. They do not see your Discord data through the Game, and they see
        nothing of what happens only in other servers. Messages the Game has posted in a server's
        channels belong to that server and stay there under Discord's rules.
      </p>
    ),
  },
  {
    id: "retention",
    heading: "How long it is kept",
    body: (
      <>
        <p>
          The world is kept from season to season for as long as the Game runs, so what you did is
          kept as long as you play. Each server's log is kept with the world, so that its admins can
          review past moderation.
        </p>
        <p>
          Backups of the world are taken at least daily and deleted on a schedule: no backup is kept
          longer than 90 days. A backup taken before you left can therefore hold your Discord user
          id for at most 90 days after you leave, and is never used to bring your identity back.
        </p>
      </>
    ),
  },
  {
    id: "deletion",
    heading: "Deleting your game data",
    body: (
      <>
        <p>You can ask the Game to forget you in any of three ways:</p>
        <ol>
          <li>
            the <strong>/forget-me</strong> command in any server where the Game is installed;
          </li>
          <li>
            deleting your {SITE.name} account, or the game data control in its privacy settings;
          </li>
          <li>
            writing to{" "}
            <a href={`mailto:${CONTACT.privacy}`} className={A}>
              {CONTACT.privacy}
            </a>{" "}
            from an address we can match to your Discord account.
          </li>
        </ol>
        <p>
          <strong>What goes at once.</strong> Your Discord user id is removed from your character
          and from every server's log, the map's record of what your character saw is deleted, and
          the bot's working records for you are deleted. Your character's goods and coin leave it:
          goods go back to the place it last stood, coin out of circulation.
        </p>
        <p>
          <strong>What stays.</strong> The facts your character added to the shared world keep their
          effect, because other players' history rests on them, and they are shown as the deeds of
          "a traveller". Characters in the world remember a traveller, not you.
        </p>
        <p>
          Every request is complete within 7 days; through /forget-me or the site it is complete at
          once.
        </p>
      </>
    ),
  },
  {
    id: "recorded-play",
    heading: "Recorded play for tuning",
    body: (
      <p>
        To tune the Game's rules we export summaries of recorded play: the options a fight offered
        and the one taken, puzzle results, and each character's day in numbers. An export names
        characters, servers and the world only by pseudonyms made for that export, and holds no
        Discord id, no words you typed, no places and no keys. It cannot be traced back to you.
      </p>
    ),
  },
  {
    id: "rights",
    heading: "Your rights",
    body: (
      <p>
        Your rights over this information are the ones the Privacy Policy of {SITE.name} describes:
        to see it, correct it, delete it, object to its use and complain to a regulator. To see what
        the Game holds about you, write to{" "}
        <a href={`mailto:${CONTACT.privacy}`} className={A}>
          {CONTACT.privacy}
        </a>
        . Deletion is described above.
      </p>
    ),
  },
  {
    id: "contact",
    heading: "Contact",
    body: (
      <p>
        Privacy questions and requests go to{" "}
        <a href={`mailto:${CONTACT.privacy}`} className={A}>
          {CONTACT.privacy}
        </a>
        ; anything else about these documents to{" "}
        <a href={`mailto:${CONTACT.legal}`} className={A}>
          {CONTACT.legal}
        </a>
        .
      </p>
    ),
  },
];

export function GamePrivacyDraft() {
  return (
    <LegalDocument
      marker="§ Legal / Game privacy (draft)"
      title={`${GAME_NAME} privacy`}
      summary={`What ${GAME_NAME} keeps about you while you play, where it is kept, who sees it, and how to have it forgotten.`}
      dates={GAME_DRAFT_DATES}
      atAGlance={
        <>
          The game keeps your Discord user id, your character and what it does, and the words you
          type to the bot. It never reads your server's messages. Narration goes to Claude without
          your Discord id. Analytics name your character, not you. /forget-me removes your identity
          at once; your deeds stay as "a traveller", and backups roll off within 90 days.
        </>
      }
      sections={GAME_PRIVACY_DRAFT}
    />
  );
}
