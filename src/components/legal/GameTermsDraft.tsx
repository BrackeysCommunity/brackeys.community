import { CONTACT, OPERATOR, SITE } from "@/lib/legal-meta";

import { LegalDocument, type LegalSection } from "./LegalDocument";

/**
 * The game's terms, unpublished. No route, sitemap entry or footer links
 * this, and the published Terms do not include it: the owner reviews it and
 * moves it into the published documents, with their dates, in one step.
 * Every claim matches what the world service and the bot do today.
 */

/** The game's working title, until a name search clears it. */
export const GAME_NAME = "Wirelands";

/** What a draft shows where a published document shows its dates. */
export const GAME_DRAFT_DATES = ["Draft, not in force", "Drafted 26 November 2026"];

const A = "text-accent underline underline-offset-2 hover:text-accent/80";

export const GAME_TERMS_DRAFT: LegalSection[] = [
  {
    id: "game-and-operator",
    heading: "The game and who runs it",
    body: (
      <>
        <p>
          {GAME_NAME} (the "Game") is a role-playing game played through a bot and an Activity in
          Discord servers. It is run by {OPERATOR.legalName} ("we", "us", or "our"), who also run{" "}
          {SITE.domain}. These terms add to the Terms of Service of {SITE.name}: where the two
          differ about the Game, these terms govern.
        </p>
        <p>
          The Game is free to play. Nothing in it is sold, and nothing in it has a value outside it.
        </p>
      </>
    ),
  },
  {
    id: "shared-world",
    heading: "A shared, persistent world",
    body: (
      <>
        <p>
          Every server that installs the Game plays in the same world, and the world keeps moving
          whether or not you are playing. What your character does is recorded as facts of that
          world: a holding taken, a kind of item first made and named, a trade, a fight. Other
          players' characters, the world's factions and its storylines build on those facts.
        </p>
        <p>
          Because the world is shared, your deeds outlive your account. If you leave, your Discord
          identity is removed, but the facts that shaped the world keep their effect and are shown
          as the deeds of "a traveller". The section on leaving says exactly what goes and what
          stays.
        </p>
      </>
    ),
  },
  {
    id: "discord",
    heading: "Discord accounts and servers",
    body: (
      <>
        <p>
          You play with your Discord account, and one Discord account holds one character. Discord's
          own terms and community guidelines apply to everything you do in Discord, including the
          Game. We do not run Discord and cannot act on your Discord account.
        </p>
        <p>
          A server's owner chooses to install the Game. Each server keeps its own settings,
          channels, roles and events, and nothing one server sets reaches another server.
        </p>
      </>
    ),
  },
  {
    id: "conduct",
    heading: "Conduct",
    body: (
      <>
        <p>While you play, you agree not to:</p>
        <ol>
          <li>
            buy, sell or offer anything from the Game for real money or anything else of value
            outside it, including characters, items, coin and services;
          </li>
          <li>
            play through automation: no bots, scripts, macros or tools that press for you, and no
            second Discord account used to give your character an edge;
          </li>
          <li>
            harass, threaten or demean other players, in names you give things, in text you type to
            the bot, or anywhere else the Game shows your words;
          </li>
          <li>
            look for, use or share a fault in the Game instead of reporting it to us (a fault you
            report in good faith is never held against you);
          </li>
          <li>try to reach the world's service, its data or its keys by any way but playing.</li>
        </ol>
      </>
    ),
  },
  {
    id: "server-staff",
    heading: "Servers' staff and admins",
    body: (
      <>
        <p>
          Each server's admins and the staff they choose run the Game in that server: they set its
          channels and roles, may set house rules of their own, and may moderate players there.
          Moderation in a server acts within that server, and every action is written to that
          server's log, which its admins can read.
        </p>
        <p>
          A server's house rules bind you in that server alongside these terms. Where they conflict
          with these terms, these terms govern. A server's admins are not acting for us, and we are
          not responsible for how they run their server.
        </p>
      </>
    ),
  },
  {
    id: "staged-events",
    heading: "Staged events",
    body: (
      <p>
        A server's staff may stage events in their server from a pool of points: creatures, troubles
        and occasions that play out by the same rules as everything else. What a staged event gives
        stays in the server that staged it, and the world's rules cap what staff can stage. Staff
        may not stage events to favour themselves or particular players, and an event staged to do
        so may be undone.
      </p>
    ),
  },
  {
    id: "narration",
    heading: "Narration",
    body: (
      <>
        <p>
          Some of the Game's text, such as the chronicle and what characters in the world say, may
          be written by a language model from what the world recorded, when the narration is
          switched on for a server. The model never decides an outcome, a price or whether a goal
          was met: rules and numbers decide everything, and the numbers are always shown beside the
          prose.
        </p>
        <p>
          Narrated text can be wrong or odd. Where it disagrees with the numbers on a card, the
          numbers are what happened.
        </p>
      </>
    ),
  },
  {
    id: "rules-epochs",
    heading: "Changes to the rules",
    body: (
      <>
        <p>
          We tune the Game's rules over time. A change to the rules takes effect only at the
          boundary between two seasons, and the cards in each server say what changed when it does.
        </p>
        <p>
          What already exists keeps its numbers. An item made before a change keeps the stats it was
          made with, and the parts of the world already drawn stay as they are. A change to the
          rules is not a reason for a refund or a restore, because nothing in the Game was bought.
        </p>
      </>
    ),
  },
  {
    id: "faults-and-restores",
    heading: "Faults and restores",
    body: (
      <>
        <p>
          The Game is offered as it is. It can stop, lose time or have faults, and we do not promise
          that it will be available at any particular moment. When the world stops, it catches up on
          the time it missed once it starts again.
        </p>
        <p>
          If a fault damages the world, we may restore it from a backup. Anything that happened
          after that backup may then be lost, and we do not compensate for it. We may also correct a
          character's holdings to undo the effect of a fault, and every correction is recorded.
        </p>
      </>
    ),
  },
  {
    id: "bans",
    heading: "Bans",
    body: (
      <>
        <p>
          We may stop a character from playing, for a time or for good, if you break these terms. A
          server's staff may do the same within their server. A banned character's past deeds stay
          in the world.
        </p>
        <p>
          If you think a ban was a mistake, write to{" "}
          <a href={`mailto:${CONTACT.abuse}`} className={A}>
            {CONTACT.abuse}
          </a>{" "}
          with your Discord user id and what happened. A server's own ban is for that server's
          admins to review.
        </p>
      </>
    ),
  },
  {
    id: "leaving",
    heading: "Leaving the Game",
    body: (
      <>
        <p>You may leave at any time, in any of three ways:</p>
        <ol>
          <li>
            the <strong>/forget-me</strong> command in any server where the Game is installed;
          </li>
          <li>deleting your {SITE.name} account, which also asks the world to forget you;</li>
          <li>
            writing to{" "}
            <a href={`mailto:${CONTACT.privacy}`} className={A}>
              {CONTACT.privacy}
            </a>{" "}
            from an address we can match to your Discord account.
          </li>
        </ol>
        <p>
          Your Discord identity is removed from the world at once, and in every case within 7 days.
          Your character's goods and coin leave it and return to the world, and its past deeds stay,
          shown as "a traveller". You cannot get a forgotten character back. If you play again
          later, you start a new character.
        </p>
      </>
    ),
  },
  {
    id: "contact",
    heading: "Contact",
    body: (
      <p>
        Questions about these terms go to{" "}
        <a href={`mailto:${CONTACT.legal}`} className={A}>
          {CONTACT.legal}
        </a>
        . Reports about players or servers, and appeals, go to{" "}
        <a href={`mailto:${CONTACT.abuse}`} className={A}>
          {CONTACT.abuse}
        </a>
        .
      </p>
    ),
  },
  {
    id: "changes",
    heading: "Changes to these terms",
    body: (
      <p>
        We may change these terms. A change in substance is announced in the Game's channels and on{" "}
        {SITE.domain} before it takes effect, and the date above changes with it. If you keep
        playing after a change takes effect, the changed terms apply to you.
      </p>
    ),
  },
];

export function GameTermsDraft() {
  return (
    <LegalDocument
      marker="§ Legal / Game terms (draft)"
      title={`${GAME_NAME} terms`}
      summary={`The rules for playing ${GAME_NAME}, the game ${SITE.name} runs in Discord: a shared world, how to behave in it, and how to leave it.`}
      dates={GAME_DRAFT_DATES}
      atAGlance={
        <>
          One world, shared by every server that plays it and kept from season to season. No
          real-money trading, no automation, no harassment. Each server's staff run the game there.
          Rules change only between seasons, and what you made keeps its numbers. Leave whenever you
          like with /forget-me: your Discord identity goes at once and your deeds stay as "a
          traveller".
        </>
      }
      sections={GAME_TERMS_DRAFT}
    />
  );
}
