import * as api from "./api.ts";
import type { Card } from "./card.ts";
import { fields, type Id, integerTarget } from "./ids.ts";
import { capitalise, type Lexicon } from "./lexicon.ts";
import type { CommandName } from "./manifest.ts";
import { backCards } from "./screens/back.ts";
import { beatCard, downCard, fieldCard, resolvedCard, whyCard } from "./screens/fight.ts";
import { hubCard, recapCard, startCard, whereCard } from "./screens/hub.ts";
import {
  appraisalCard,
  characterCard,
  craftCard,
  type Draft,
  draftRecipe,
  itemCard,
  madeCard,
  marketCard,
  parseDraft,
  recipesCard,
} from "./screens/make.ts";
import { talkCard } from "./screens/talk.ts";
import { travelCard } from "./screens/travel.ts";
import { amount } from "./units.ts";
import type { World } from "./world.ts";

/**
 * The bot's whole behaviour as a pure function of a press: what to write
 * to the world and which card to show next. Nothing here sees discord.js,
 * so a scripted client and the tests drive exactly what players press.
 */

export interface Press {
  user: string;
  guild?: string;
  /** Discord's interaction id: the idempotency key of any write. */
  interaction: string;
  command?: string;
  id?: Id;
  values?: string[];
}

export interface Ctx {
  world: World;
  lex: Lexicon;
  /** The threat line routes stop before. */
  threatLine: number;
}

export interface Answer {
  card: Card;
  /** The character the answer is about, once there is one. */
  character?: string;
  /** A long action the press queued, for the completion notice. */
  long?: boolean;
}

export async function answer(ctx: Ctx, press: Press): Promise<Answer> {
  const { world } = ctx;
  const id = await world.player(press.user);
  if (!id) {
    if (press.id?.action === "start") return start(ctx, press, press.id.target);
    return { card: startCard(ctx.lex) };
  }
  const s = new Session(ctx, press, id);
  if (press.command) return s.command(press.command as CommandName);
  if (press.id) return s.button(press.id, press.values ?? []);
  return s.hub();
}

async function start(ctx: Ctx, press: Press, choice: string): Promise<Answer> {
  const res = await ctx.world.act({
    interactionId: press.interaction,
    discordId: press.user,
    kind: api.ActCreate,
    version: 0,
    option: choice,
    server: press.guild,
  });
  if (!res.ok) {
    if (res.refusal.code === api.CodeSecondPC) {
      const id = await ctx.world.player(press.user);
      if (id) return new Session(ctx, press, id).hub();
    }
    const card = startCard(ctx.lex);
    card.title = capitalise(res.refusal.message);
    return { card };
  }
  const s = new Session(ctx, press, res.reply.character.id);
  return s.hub(`You take the ${choice}. The road is yours.`);
}

class Session {
  constructor(
    private readonly ctx: Ctx,
    private readonly press: Press,
    readonly character: string,
  ) {}

  private get lex() {
    return this.ctx.lex;
  }
  private get world() {
    return this.ctx.world;
  }

  private async load() {
    const [o, here] = await Promise.all([
      this.world.options(this.character),
      this.world.here(this.character),
    ]);
    return { o, here };
  }

  /** A write keyed on this press, at the card's version. */
  private async act(kind: string, version: number, fields: Partial<api.ActionRequest> = {}) {
    return this.world.act({
      interactionId: this.press.interaction,
      characterId: this.character,
      version,
      kind,
      ...fields,
    });
  }

  private done(card: Card, long = false): Answer {
    return { card, character: this.character, long };
  }

  /** An answer whose card's title is replaced, when there is one. */
  private retitled(a: Answer, title?: string): Answer {
    if (title) a.card.title = title;
    return a;
  }

  /** The hub after a press that queues a long action, unless it was refused. */
  private async longAnswer(notice: string, why?: string): Promise<Answer> {
    return { ...(await this.hub(why ?? notice)), long: !why };
  }

  async command(name: CommandName): Promise<Answer> {
    switch (name) {
      case "character":
        return this.character_();
      case "recipes":
        return this.recipes();
      case "map":
        return this.travel();
      case "play":
      default:
        return this.open();
    }
  }

  /** /play with a character: since you left when something happened, else the hub. */
  async open(): Promise<Answer> {
    const { o, here } = await this.load();
    const recap = await this.world.recap(this.character);
    const look = await this.act(api.ActLook, o.version);
    if (recap.lines.length === 0) return this.hub();
    const version = look.ok ? look.reply.character.version : o.version;
    return this.done(recapCard({ ...o, version }, here, recap, this.lex, peopleOf(here)));
  }

  async hub(notice?: string): Promise<Answer> {
    const { o, here } = await this.load();
    const sheet = await this.world.sheet(this.character);
    if (o.conditions.includes(api.CondDown) && !o.long && !notice)
      return this.done(downCard(o, here, this.lex));
    return this.done(hubCard(o, here, sheet, this.lex, notice));
  }

  async travel(notice?: string): Promise<Answer> {
    const { o, here } = await this.load();
    const map = await this.world.map(this.character);
    return this.retitled(
      this.done(travelCard(o, map, here, this.lex, this.ctx.threatLine)),
      notice,
    );
  }

  async character_(): Promise<Answer> {
    const { o, here } = await this.load();
    return this.done(characterCard(o, here, await this.world.sheet(this.character), this.lex));
  }

  async recipes(): Promise<Answer> {
    const { o, here } = await this.load();
    return this.done(recipesCard(o, here, await this.world.recipes(this.character), this.lex));
  }

  async fight(last?: api.ActionReply): Promise<Answer> {
    const { o, here } = await this.load();
    if (o.fight)
      return this.done(
        beatCard(o, here, this.lex, last && { pressed: last.pressed ?? [], facts: last.facts }),
      );
    if (last) return this.done(resolvedCard(o, here, this.lex, last.pressed ?? [], last.facts));
    return this.hub();
  }

  async craft(d: Draft): Promise<Answer> {
    const { o, here } = await this.load();
    const [sheet, recipes] = await Promise.all([
      this.world.sheet(this.character),
      this.world.recipes(this.character),
    ]);
    return this.done(craftCard(o, here, sheet, recipes, this.lex, d));
  }

  async market(notice?: string): Promise<Answer> {
    const { o, here } = await this.load();
    return this.done(marketCard(o, here, await this.world.sheet(this.character), this.lex, notice));
  }

  async item(itemId: string): Promise<Answer> {
    const { o, here } = await this.load();
    const sheet = await this.world.sheet(this.character);
    const it = [...sheet.kit, ...sheet.pack].find((x) => x.id === itemId);
    if (!it) return this.done(characterCard(o, here, sheet, this.lex));
    const deckHeld = sheet.kit.some((x) => x.worn === "off-hand" && x.deck);
    return this.done(itemCard(o, here, it, this.lex, deckHeld));
  }

  async talk(npc: string, said?: string): Promise<Answer> {
    const o = await this.world.options(this.character);
    const conv = await this.world.npc(this.character, npc);
    if (!conv.ok) return this.where(conv.refusal.message);
    return this.done(talkCard(o, conv.reply, said));
  }

  async where(notice?: string): Promise<Answer> {
    const { o, here } = await this.load();
    return this.retitled(this.done(whereCard(o, here, this.lex)), notice);
  }

  /** A write, then the card it leads to; a refusal shows its reason on that card. */
  private async write(
    kind: string,
    v: number,
    fields: Partial<api.ActionRequest>,
    then: (reply: api.ActionReply | null, refusal?: string) => Promise<Answer>,
  ): Promise<Answer> {
    const res = await this.act(kind, v, fields);
    if (!res.ok) {
      const why =
        res.refusal.code === api.CodeStale
          ? "The world moved on: here is the card as it stands."
          : res.refusal.message;
      return then(null, capitalise(why));
    }
    return then(res.reply);
  }

  async button(id: Id, values: string[]): Promise<Answer> {
    const v = id.version;
    const value = values[0] ?? "";
    const isPair =
      id.action === "sell" ||
      id.action === "buy" ||
      id.action === "equip" ||
      id.action === "pick" ||
      id.action === "gather" ||
      id.action === "consent";
    const pair = isPair ? fields(id.target, ":", 2) : null;
    if (isPair && !pair) return backCards.unknown(this.character);
    const [a, b] = pair ?? ["", ""];
    const quantity = integerTarget(b!);
    if (
      (id.action === "buy" ||
        id.action === "sell" ||
        id.action === "gather" ||
        id.action === "consent") &&
      quantity === undefined
    )
      return backCards.unknown(this.character);
    switch (id.action) {
      case "hub":
        return this.hub();
      case "where":
        return this.where();
      case "travel":
        return this.travel();
      case "field": {
        const { o, here } = await this.load();
        return this.done(fieldCard(o, here, this.lex));
      }
      case "craft":
        return this.craft({});
      case "craft-p":
        return this.craft({ process: value });
      case "craft-m":
        return this.craft({ ...parseDraft(id.target), method: value });
      case "craft-s":
        return this.craft({ ...parseDraft(id.target), slot: value });
      case "craft-i":
        return this.craft({ ...parseDraft(id.target), material: value });
      case "craft-q": {
        const d = parseDraft(id.target);
        const { o, here } = await this.load();
        const ap = await this.world.appraise({
          characterId: this.character,
          recipe: draftRecipe(d),
        });
        if (!ap.ok) return this.retitled(await this.craft({}), capitalise(ap.refusal.message));
        return this.done(appraisalCard(o, here, ap.reply, this.lex, d));
      }
      case "craft-go":
        return this.write(
          api.ActCraft,
          v,
          { recipe: draftRecipe(parseDraft(id.target)) },
          async (r, why) => {
            if (!r) return this.retitled(await this.craft({}), why);
            const { o, here } = await this.load();
            return this.done(madeCard(o, here, r.facts, this.lex));
          },
        );
      case "market":
        return this.market();
      case "sell":
        return this.write(api.ActSell, v, { material: a, units: quantity }, (r, why) =>
          this.market(why ?? (r ? `Sold: ${amount(r.character.coin, "coin")} in hand` : undefined)),
        );
      case "buy":
        return this.write(api.ActBuy, v, { asset: a, units: quantity }, (_, why) =>
          this.market(why),
        );
      case "feed":
        return this.write(api.ActFeed, v, {}, (_, why) => this.market(why));
      case "character":
        return this.character_();
      case "item":
        return this.item(value || id.target);
      case "equip":
        return this.write(api.ActEquip, v, { item: a, slot: b }, async (_, why) =>
          why ? this.retitled(await this.item(a!), why) : this.character_(),
        );
      case "repair":
        return this.write(api.ActRepair, v, { item: id.target }, async (_, why) =>
          this.retitled(await this.item(id.target), why),
        );
      case "pick":
        return this.write(api.ActPick, v, { item: a, option: b }, async (_, why) =>
          this.retitled(await this.item(a!), why),
        );
      case "recipes":
        return this.recipes();
      case "recap": {
        const { o, here } = await this.load();
        const recap = await this.world.recap(this.character);
        return this.done(recapCard(o, here, recap, this.lex, peopleOf(here)));
      }
      case "step":
        return this.write(api.ActStep, v, { dir: Number(id.target) }, async (_, why) =>
          this.travel(why ?? "On your way"),
        );
      case "goto":
      case "follow": {
        const coords = fields(value || id.target, ",", 2);
        const q = integerTarget(coords?.[0] ?? "");
        const r = integerTarget(coords?.[1] ?? "");
        if (q === undefined || r === undefined) return backCards.unknown(this.character);
        return this.write(
          api.ActTravel,
          v,
          { to: { q, r }, stop: { threat: this.ctx.threatLine } },
          async (_, why) => {
            const ans = await this.travel(why ?? "On your way");
            return { ...ans, long: !why };
          },
        );
      }
      case "cancel":
        return this.write(api.ActCancel, v, {}, (_, why) =>
          this.hub(why ?? "You stop where you are"),
        );
      case "explore":
        return this.write(api.ActExplore, v, {}, async (_, why) => {
          const { o, here } = await this.load();
          if (!why && o.fight) return this.done(beatCard(o, here, this.lex));
          return this.retitled(
            this.done(fieldCard(o, here, this.lex)),
            why ?? "The herd here is thin: nothing shows itself",
          );
        });
      case "fight":
        return this.fight();
      case "press":
        return this.write(api.ActPress, v, { option: id.target }, async (r, why) => {
          if (!r) return this.retitled(await this.fight(), why);
          return this.fight(r);
        });
      case "why": {
        const { o, here } = await this.load();
        return this.done(whyCard(o, here, this.lex, id.target === "options" ? "options" : "moves"));
      }
      case "crawl":
        return this.write(api.ActCrawl, v, {}, (_, why) =>
          this.longAnswer("You start crawling out", why),
        );
      case "rest":
        return this.write(api.ActRest, v, {}, (_, why) => this.longAnswer("You rest", why));
      case "gather":
        return this.write(api.ActGather, v, { material: a, ticks: quantity }, (_, why) =>
          this.longAnswer("You set to gathering", why),
        );
      case "forage":
        return this.write(api.ActForage, v, { ticks: Number(id.target) }, (_, why) =>
          this.longAnswer("You forage", why),
        );
      case "talk":
        return this.write(api.ActTalk, v, { npc: id.target }, async (_, why) =>
          why ? this.where(why) : this.talk(id.target),
        );
      case "choose": {
        const choice = fields(id.target, "/", 3);
        if (!choice) return backCards.unknown(this.character);
        const [npc, topic, option] = choice;
        return this.write(api.ActChoose, v, { npc, option: `${topic}/${option}` }, async (_, why) =>
          this.talk(npc!, why),
        );
      }
      case "search":
        return this.write(api.ActSearch, v, {}, async (_, why) =>
          this.where(why ?? "You find what was hidden"),
        );
      case "consent":
        return this.write(api.ActConsent, v, { option: a, units: quantity }, async (_, why) =>
          this.retitled(await this.character_(), why),
        );
      case "start":
        return this.hub();
      default:
        return backCards.unknown(this.character);
    }
  }
}

function peopleOf(here: api.Here): Map<string, string> {
  return new Map(here.people.map((p) => [p.id, p.name]));
}
