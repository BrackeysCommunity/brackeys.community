import type { Button, Modal } from "../../../../packages/discord-kit/src/index.ts";
import type { Card } from "../card.ts";
import { COLOUR } from "../card.ts";
import { encodeId } from "../ids.ts";
import { capitalise } from "../lexicon.ts";
import type { NameOffer, NameSubject } from "../narration/names.ts";
import { btn, buttonLabel, PRIVATE } from "./common.ts";
import { NAME_INPUT, NAME_MOST } from "./emergence.ts";

/**
 * The naming card (GDD 9.10, 15.2): one for a kind made first, a
 * promotion its first may rename, and a dungeon its first slayers name.
 * It offers three suggestions when there are any, the plain name kept,
 * or the player's own in a modal. A suggestion is sent as the player's
 * own would be; keeping the plain name sends nothing.
 */

/** What is named, and its row: a kind id, a promotion id or a dungeon's "q,r". */
export interface NameTarget {
  subject: NameSubject;
  row: string;
}

const LETTER: Record<NameSubject, string> = { kind: "k", promotion: "p", dungeon: "d" };
const SUBJECT: Record<string, NameSubject> = { k: "kind", p: "promotion", d: "dungeon" };
/** A pick's name follows its target after this; no name holds it. */
const PICK_SEP = "/";

/** A target as ids carry it: k:<kind>, p:<promotion>, d:<hex>. */
export function nameTarget(t: NameTarget): string {
  return `${LETTER[t.subject]}:${t.row}`;
}

export function parseNameTarget(raw: string): NameTarget | null {
  const at = raw.indexOf(":");
  const subject = SUBJECT[raw.slice(0, at)];
  const row = raw.slice(at + 1);
  if (at < 0 || !subject || !row || row.includes(PICK_SEP) || row.includes("|")) return null;
  return { subject, row };
}

/** A suggestion pressed carries its name; the keep button carries none. */
export function parsePick(raw: string): { t: NameTarget; name?: string } | null {
  const cut = raw.lastIndexOf(PICK_SEP);
  const t = parseNameTarget(cut < 0 ? raw : raw.slice(0, cut));
  if (!t) return null;
  if (cut < 0) return { t };
  const name = raw.slice(cut + 1).trim();
  return name ? { t, name } : null;
}

/** The longest dungeon name the world takes. */
export const DUNGEON_NAME_MOST = 40;

/** The longest name each subject's modal takes, as the world takes it. */
export function nameMost(subject: NameSubject): number {
  return subject === "dungeon" ? DUNGEON_NAME_MOST : NAME_MOST;
}

/** The button that opens the naming card. */
export function nameItButton(t: NameTarget, label: string, version: number): Button {
  return btn(buttonLabel(label), "kn-name", nameTarget(t), version, { style: "success" });
}

/** A suggestion's button, or null when its id would not fit. */
function pickButton(t: NameTarget, name: string, version: number): Button | null {
  try {
    return btn(buttonLabel(name), "kn-pick", `${nameTarget(t)}${PICK_SEP}${name}`, version, {
      style: "primary",
    });
  } catch {
    return null;
  }
}

const AUTHOR: Record<NameSubject, string> = {
  kind: "Naming · a kind you made first",
  promotion: "Naming · something you were first of",
  dungeon: "Naming · a dungeon your party cleared first",
};

/** What a thing is called, its suggestions and its description, and the three ways to answer. */
export function namingCard(
  version: number,
  t: NameTarget,
  plain: string,
  offer: NameOffer | null,
  notice?: string,
): Card {
  const picks = (offer?.names ?? [])
    .map((n) => pickButton(t, n, version))
    .filter((b): b is Button => b !== null);
  return {
    context: PRIVATE,
    author: AUTHOR[t.subject],
    title: (notice ?? `Name it: ${capitalise(plain)}`).slice(0, 256),
    description: picks.length
      ? "Pick a name, give your own, or keep the plain one. A name is given once and kept for good."
      : "Give it your own name, or keep the plain one. A name is given once and kept for good.",
    picture: "form",
    fields: offer?.description ? [{ name: "What it is", value: offer.description }] : [],
    footer: "Every name a player gives is read against the world's word list.",
    rows: [
      ...(picks.length ? [{ buttons: picks }] : []),
      {
        buttons: [
          btn("Keep the plain name", "kn-pick", nameTarget(t), version),
          btn("Your own…", "kn-own", nameTarget(t), version, { style: "success" }),
        ],
      },
    ],
    colour: COLOUR.hazard,
  };
}

const MODAL_TITLE: Record<NameSubject, string> = {
  kind: "Name the kind: once, and for good",
  promotion: "Name it: once, and for good",
  dungeon: "Name the dungeon: once, and for good",
};

/** The own-name modal, built from its target alone; it submits as kn-named. */
export function ownNameModal(raw: string, version: number): Modal | null {
  const t = parseNameTarget(raw);
  if (!t) return null;
  return {
    customId: encodeId("kn-named", nameTarget(t), version),
    title: MODAL_TITLE[t.subject],
    inputs: [{ id: NAME_INPUT, label: "Name", max: nameMost(t.subject), required: true }],
  };
}

/** The title a card takes when the screen holds a typed name. */
export const HELD_NOTICE = "Held: a person reads that name before the world takes it";
