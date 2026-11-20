package game

import (
	"slices"
	"strings"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/class"
	"jams.team/mmo-world/sim/craft"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/guild"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tags"
)

// Commands of classes (GDD 5.8, 5.9).
const (
	ChooseClass = "class-choose" // make an earned class active, at a settlement
	TakeAbility = "class-take"   // take an ability from an active class's open tier
	MarkPrey    = "mark"         // a Stalker names the creature tag it hunts today
)

// Deeds a class threshold counts, kept on the character.
const (
	DeedHoldWon   = "hold-won"
	DeedRuns      = "runs-landed"
	DeedFloors    = "floors"
	DeedHauled    = "hauled"
	DeedForOthers = "goals-for-others"
	DeedPledged   = "pledged"
)

// DeedGiven is the reference value of all a character has given to guilds,
// which stays on its record when it leaves one.
const DeedGiven = "given"

// structural: the skill meeting others' goals practises, which a Reeve's
// level follows.
const practiceGoals = "goals"

// Deeds are every deed a class threshold may count.
var Deeds = []string{DeedHoldWon, DeedRuns, DeedFloors, DeedHauled, DeedForOthers, DeedPledged}

// Skills are every skill the game practises.
var Skills = []string{"fight", "travel", "gather", "lockpick", "puzzle", practiceCraft, practiceGoals}

// reader is a character as a class's thresholds read it.
type reader struct{ c *char.Character }

func (r reader) Level(skill string) int64    { return r.c.Level(skill) }
func (r reader) Deed(id string) int64        { return r.c.Deeds.Get(id) }
func (r reader) Crafts(process string) int64 { return r.c.Crafts.Get(process) }
func readerOf(c *Char) class.Reader          { return reader{c.C} }
func (g *Game) classRow(id string) *sheets.Class {
	i := slices.IndexFunc(g.r.Book.Classes, func(c sheets.Class) bool { return c.ID == id })
	if i < 0 {
		return nil
	}
	return &g.r.Book.Classes[i]
}

// ClassLevel is a character's level in an earned class.
func (g *Game) ClassLevel(c *Char, id string) int64 {
	row := g.classRow(id)
	if row == nil || !c.C.Classes.Has(id) {
		return 0
	}
	return class.Level(row, readerOf(c), g.r.Class)
}

// charTags are what the rules see of a character's classes and today's
// mark.
func (g *Game) charTags(c *Char) []tags.Tag {
	return c.C.Classes.Tags(g.r.Book.Classes, g.r.Book.Abilities)
}

// charScale is a game measure for a character after its abilities' rules
// (GDD 5.9): base scaled and added to by every rule its tags fire.
func (g *Game) charScale(c *Char, measure string, base int64) int64 {
	if len(c.C.Classes.Abilities) == 0 {
		return base
	}
	subject := tags.Plain(tags.Source{Note: "character:" + c.C.ID}, append([]tags.Tag{tags.Character}, g.charTags(c)...)...)
	return tags.Adjust(g.r.rules, subject, tags.Context{}, measure, base)
}

// classesFor checks a character's thresholds after it acts: each class it
// has newly crossed is earned, a fact, and the first in the world is
// recorded as such.
func (g *Game) classesFor(c *Char, tick int64) error {
	for i := range g.r.Book.Classes {
		row := &g.r.Book.Classes[i]
		if c.C.Classes.Has(row.ID) || !class.Unlocked(row, readerOf(c)) {
			continue
		}
		first := !slices.Contains(g.FirstClasses, row.ID)
		if first {
			g.FirstClasses = append(g.FirstClasses, row.ID)
		}
		c.C.Classes.Earned = append(c.C.Classes.Earned, class.Earned{ID: row.ID, Tick: tick, First: first})
		if int64(len(c.C.Classes.Active)) < g.r.Class.Active {
			c.C.Classes.Active = append(c.C.Classes.Active, row.ID)
		}
		data := []fact.Datum{fact.S("class", row.ID)}
		if first {
			data = append(data, fact.S("first", "world"))
		}
		if _, err := g.fact(c, "class.unlocked", tick, data...); err != nil {
			return err
		}
	}
	return nil
}

func (g *Game) classAct(c *Char, cmd Command) error {
	switch cmd.Kind {
	case ChooseClass:
		if _, ok := g.SettlementAt(c.C.At); !ok {
			return refuse(NotHere, "a class is chosen at a settlement")
		}
		if err := c.C.Classes.Choose(cmd.Option, g.r.Class); err != nil {
			return refuse(BadArgs, "%v", err)
		}
		_, err := g.fact(c, "class.chosen", g.Tick(), fact.S("class", cmd.Option))
		return err
	case TakeAbility:
		i := slices.IndexFunc(g.r.Book.Abilities, func(a sheets.Ability) bool { return a.ID == cmd.Option })
		if i < 0 {
			return refuse(BadArgs, "no ability %q", cmd.Option)
		}
		a := &g.r.Book.Abilities[i]
		if err := c.C.Classes.Take(a, g.ClassLevel(c, a.Class), g.r.Book.Abilities, g.r.Class); err != nil {
			return refuse(BadArgs, "%v", err)
		}
		_, err := g.fact(c, "ability.taken", g.Tick(), fact.S("ability", a.ID), fact.S("class", a.Class))
		return err
	case MarkPrey:
		if !g.marksPrey(c) {
			return refuse(BadArgs, "only a Stalker with Mark prey names prey")
		}
		if !g.isCreatureTag(cmd.Option) {
			return refuse(BadArgs, "%q names no kind of creature", cmd.Option)
		}
		c.C.Prey = char.Prey{Tag: cmd.Option, Day: g.World.Day}
		_, err := g.fact(c, "prey.marked", g.Tick(), fact.S("tag", cmd.Option))
		return err
	}
	return refuse(BadArgs, "unknown command %q", cmd.Kind)
}

// structural: the abilities the game reads by name, where the ability is
// an act rather than a measure.
const abilityMarkPrey = "mark-prey"

// isCreatureTag reports whether a tag tells some creatures from others:
// an archetype carries it and another does not.
func (g *Game) isCreatureTag(t string) bool {
	has := func(c sheets.Creature) bool { return slices.Contains(c.Tags, t) }
	lacks := func(c sheets.Creature) bool { return !has(c) }
	return slices.ContainsFunc(g.r.Book.Creatures, has) && slices.ContainsFunc(g.r.Book.Creatures, lacks)
}

func (g *Game) marksPrey(c *Char) bool {
	return slices.Contains(g.charTags(c), tags.Tag(abilityMarkPrey))
}

// PreyTags are the creature tags a character may mark as prey, in sheet
// order; none without Mark prey.
func (g *Game) PreyTags(c *Char) []string {
	if !g.marksPrey(c) {
		return nil
	}
	var out []string
	for _, a := range g.r.Book.Creatures {
		for _, t := range a.Tags {
			if !slices.Contains(out, t) && g.isCreatureTag(t) {
				out = append(out, t)
			}
		}
	}
	return out
}

// PreyToday is the creature tag a character marked today, or "".
func (g *Game) PreyToday(c *Char) string {
	if c.C.Prey.Day != g.World.Day {
		return ""
	}
	return c.C.Prey.Tag
}

// EvenShares reports whether a character may post a pooled goal that pays
// everyone the same.
func (g *Game) EvenShares(c *Char) bool { return g.charScale(c, "even-shares", 0) > 0 }

// fightTags are what a character's kit carries into a beat besides its
// gear, in the situation the game finds it in.
func (g *Game) fightTags(c *Char, e *fight.Encounter) []tags.Tag {
	p := c.C.Prey
	return c.C.Classes.FightTags(g.r.Book.Classes, g.r.Book.Abilities, class.Situation{
		Opening:  e.At == 0,
		Ambushed: c.Fight != nil && c.Fight.Ambush,
		Preyed:   p.Tag != "" && p.Day == g.World.Day && slices.Contains(e.Creature.Tags, tags.Tag(p.Tag)),
		Walled:   g.walled(c.C.At),
	})
}

// deeds counts what a pressed beat adds to a character's thresholds: a
// won Hold, a landed cast.
func (g *Game) deeds(c *Char, pressed []fight.Pressed) {
	if len(pressed) == 0 || !pressed[0].Outcome.Success {
		return
	}
	switch o := pressed[0].Option; {
	case o.Verb == fightHold:
		c.C.Deeds.Bump(DeedHoldWon, 1)
	case o.Kind == fight.Cast:
		c.C.Deeds.Bump(DeedRuns, 1)
	}
}

// structural: the option verb a Warden's threshold counts.
const fightHold = "hold"

func joinTags(ts []tags.Tag) string { return strings.Join(tagStrings(ts), ",") }

// structural: halving.
const halved = 2

// feeFor is the station fee a character pays for a kind, after a Smith's
// Thrift and Signature (on the first kind it discovered) and a stoked
// forge's work at its settlement (GDD 4.14, 5.9).
func (g *Game) feeFor(c *Char, st Station, kind string) int64 {
	fee, _, _ := g.feeSaved(c, st, kind)
	return fee
}

// feeSaved is feeFor, the stoked forge that spared some of it and how
// much.
func (g *Game) feeSaved(c *Char, st Station, kind string) (fee int64, w *guild.Work, saved int64) {
	fee = g.charScale(c, "station-fee", g.StationFee(st))
	if len(c.C.Discovered) > 0 && c.C.Discovered[0] == kind {
		fee = g.charScale(c, "signature-fee", fee)
	}
	row, w := g.workHere(c, guild.GivesStationFee, false)
	if w != nil {
		saved = spared(row, w, fee)
		fee -= saved
	}
	return max(0, fee), w, saved
}

// narrowed is an appraisal as a Steady hand sees it: each range shrunk
// toward its middle by the ability's share.
func (g *Game) narrowed(c *Char, rg craft.Ranges) craft.Ranges {
	pct := g.charScale(c, "appraisal-width", fixed.Hundredths)
	if pct >= fixed.Hundredths || rg.Known {
		return rg
	}
	for i := range rg.Lo {
		mid := (rg.Lo[i] + rg.Hi[i]) / halved
		half := fixed.PercentFloor(rg.Hi[i]-rg.Lo[i], pct) / halved
		rg.Lo[i], rg.Hi[i] = mid-half, mid+half
	}
	return rg
}

// ClassReader is a character as class thresholds read it.
func (g *Game) ClassReader(c *Char) class.Reader { return readerOf(c) }
