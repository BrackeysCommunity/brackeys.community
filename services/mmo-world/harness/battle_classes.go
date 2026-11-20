package harness

import (
	"fmt"
	"slices"
	"strings"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/class"
	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/sheets"
)

// situation is what a fight's place and start add to a classed fighter's
// tags, for the abilities whose rules read them.
type situation struct {
	ambush, walled, prey bool
}

// classBuild is a class as a fighter carries it: active, with the
// abilities fights read from each tier its level opens.
type classBuild struct {
	row *sheets.Class
	// variant picks between two such abilities of one tier, a bit a tier.
	variant int
	// only is one ability carried alone, whatever the class level.
	only string
}

// fighter is a battle character as class levels read it.
type fighter struct{ c *char.Character }

func (f fighter) Level(skill string) int64 { return f.c.Level(skill) }
func (f fighter) Deed(string) int64        { return 0 }
func (f fighter) Crafts(string) int64      { return 0 }

// fightRead reports whether fights read an ability yet.
func fightRead(a *sheets.Ability) bool {
	return a.Waits == "" && strings.Contains(a.Reads, "fight:")
}

// tierChoices are the abilities of one tier of a class that fights read.
func tierChoices(b *sheets.Book, id string, tier int64) []string {
	var out []string
	for i := range b.Abilities {
		if a := &b.Abilities[i]; a.Class == id && a.Tier == tier && fightRead(a) {
			out = append(out, a.ID)
		}
	}
	return out
}

// abilities are what a build takes at a class level.
func (b *battle) abilities(as *classBuild, level int64) []string {
	if as.only != "" {
		return []string{as.only}
	}
	var out []string
	bit := 0
	for _, tier := range class.Tiers(level, class.ParamsOf(b.p.Book.ClassParams)) {
		switch c := tierChoices(b.p.Book, as.row.ID, tier); len(c) {
		case 0:
		case 1:
			out = append(out, c[0])
		default:
			out = append(out, c[(as.variant>>bit)&1])
			bit++
		}
	}
	return out
}

// variants is how many builds a class has: two for each tier with two
// abilities fights read.
func variants(b *sheets.Book, row *sheets.Class) int {
	n := 1
	for _, tier := range class.AllTiers(class.ParamsOf(b.ClassParams)) {
		if len(tierChoices(b, row.ID, tier)) > 1 {
			n *= 2
		}
	}
	return n
}

// classed gives a character a build: the class earned and active, at the
// level its practice brings, level 1 below the unlock.
func (b *battle) classed(c *char.Character, as *classBuild) {
	if as == nil {
		return
	}
	level := class.Level(as.row, fighter{c}, class.ParamsOf(b.p.Book.ClassParams))
	c.Classes = class.State{Earned: []class.Earned{{ID: as.row.ID}}, Active: []string{as.row.ID}, Abilities: b.abilities(as, level)}
}

// kitOf is a character's kit on a beat, with what its classes and the
// situation add, as the game's fights add them.
func (b *battle) kitOf(c *char.Character, e *fight.Encounter, sit situation) fight.Kit {
	k := b.p.Fight.KitOf(c)
	if len(c.Classes.Active) == 0 {
		return k
	}
	k.Self = append(k.Self, c.Classes.FightTags(b.p.Book.Classes, b.p.Book.Abilities,
		class.Situation{Opening: e.At == 0, Ambushed: sit.ambush, Preyed: sit.prey, Walled: sit.walled})...)
	return k
}

// fights reports whether a class can change a fight at all: an ability
// fights read, or a rule that names its tag. One that cannot fights as
// the plain kit does, encounter for encounter.
func fights(b *sheets.Book, row *sheets.Class) bool {
	for i := range b.Abilities {
		if a := &b.Abilities[i]; a.Class == row.ID && fightRead(a) {
			return true
		}
	}
	return slices.ContainsFunc(b.Rules, func(r sheets.RuleRow) bool {
		return slices.Contains(slices.Concat(r.Subject, r.Other, r.Place, r.Anywhere, r.Lacks), row.Tag)
	})
}

// matrixCell is one archetype at one gear level: each loadout's win rate
// and each class's on the plain kit.
type matrixCell struct {
	arch           string
	level          int64
	loadout, class []float64
}

// winner is the loadout with the highest rate; the plain kit wins ties.
func (c matrixCell) winner() string {
	best := 0
	for i, r := range c.loadout {
		if r > c.loadout[best] {
			best = i
		}
	}
	return loadouts[best].Name
}

// classWinner is the winner with the classes counted: a class wins only
// by beating every loadout and every class before it.
func (c matrixCell) classWinner(b *sheets.Book) string {
	best, rate := c.winner(), slices.Max(c.loadout)
	for i, r := range c.class {
		if r > rate {
			best, rate = b.Classes[i].ID, r
		}
	}
	return best
}

// mate is a battle like b with fight rules of its own and b's reference
// gear and exploits frozen into its registry, so it need not sample them
// again.
func (b *battle) mate() (*battle, error) {
	p, err := NewPlay(b.p.Book, b.p.Keys)
	if err != nil {
		return nil, err
	}
	m := &battle{p: p, pick: draw.NewDrawer(b.p.Keys.Roll), ref: map[string]*item.Kind{}, exploits: map[string]*item.Kind{}, creatures: b.creatures, n: b.n}
	for key, k := range b.ref {
		v := *k
		m.ref[key] = p.Deriver.Reg.Freeze(&v)
	}
	for state, k := range b.exploits {
		v := *k
		m.exploits[state] = p.Deriver.Reg.Freeze(&v)
	}
	return m, nil
}

// crew is b and enough mates to run want jobs at once. Every draw is
// keyed, so a job gives the same result whichever of them runs it.
func (b *battle) crew(want int) (chan *battle, error) {
	for len(b.mates)+1 < min(workers(), want) {
		m, err := b.mate()
		if err != nil {
			return nil, err
		}
		b.mates = append(b.mates, m)
	}
	free := make(chan *battle, len(b.mates)+1)
	free <- b
	for _, m := range b.mates {
		free <- m
	}
	return free, nil
}

// each runs jobs over the crew.
func (b *battle) each(jobs int, f func(x *battle, i int) error) error {
	free, err := b.crew(jobs)
	if err != nil {
		return err
	}
	return runParallel(jobs, func(i int) error {
		x := <-free
		defer func() { free <- x }()
		return f(x, i)
	})
}

// matrix fills the matchup matrix: every archetype at three gear levels.
func (b *battle) matrix(book *sheets.Book, n int) ([]matrixCell, error) {
	var cells []matrixCell
	for _, a := range book.Creatures {
		ft := b.p.Fight.Tier(a.Tier)
		for _, lvl := range []int64{max(1, ft.ExpectedLevel/2), ft.ExpectedLevel, ft.ExpectedLevel * 3 / 2} {
			cells = append(cells, matrixCell{arch: a.ID, level: lvl})
		}
	}
	return cells, b.each(len(cells), func(x *battle, i int) error { return x.fill(&cells[i], n) })
}

// fill runs one cell: each loadout, then each class on the plain kit, at
// its best build. A Stalker has marked what it fights.
func (b *battle) fill(c *matrixCell, n int) error {
	book := b.p.Book
	ft := b.p.Fight.Tier(b.creatures[c.arch].Tier)
	name := fmt.Sprintf("m%d", c.level)
	for _, l := range loadouts {
		t, err := b.spreadCell(name, c.arch, l, c.level, ft.ExpectedPractice, policies[0], n/2, nil, situation{})
		if err != nil {
			return err
		}
		c.loadout = append(c.loadout, t.rate())
	}
	for i := range book.Classes {
		row := &book.Classes[i]
		rate := c.loadout[0]
		if fights(book, row) {
			rate = 0
			for v := range variants(book, row) {
				t, err := b.spreadCell(name, c.arch, loadouts[0], c.level, ft.ExpectedPractice, policies[0], n/2, &classBuild{row: row, variant: v}, situation{prey: true})
				if err != nil {
					return err
				}
				rate = max(rate, t.rate())
			}
		}
		c.class = append(c.class, rate)
	}
	return nil
}

// trial is one ability carried alone in the situation its rules read, on
// a kit, against one archetype; a nil build is the kit without it.
type trial struct {
	ability *sheets.Ability
	kit     Loadout
	sit     situation
	arch    string
	t       tally
}

// structural: an ability's trial runs this share of the encounters a
// cell is asked for; a matrix cell runs half.
const trialShare = 4

// classSections writes what classes do to fights and returns the class
// share reading.
func (b *battle) classSections(pr func(string, ...any), book *sheets.Book, cells []matrixCell, n int) (Measured, error) {
	pr("## Classes")
	pr("")
	pr("A class column of the matrix is the plain kit carried by a character with that class active and, from every tier its class level opens, the ability fights read today (its `reads` cell names a fight, and it waits on no later milestone); where a tier has two, the class takes the better build. Class level follows the cell's practice in the class's skill, level 1 below the unlock. The encounters are met, not ambushes, and away from any wall; a Stalker with Mark prey has marked the creature. A class no fight reads fights as the plain kit does and wins nothing. A class wins a cell when its column beats every loadout's and every other class's.")
	pr("")
	pr("| Class | Abilities fights read | Cells won | Share | Cells better than the plain kit | Mean lift over the plain kit |")
	pr("| --- | --- | --- | --- | --- | --- |")
	limit := sheets.IntParam(book.ClassParams, "class-share-max")
	top, topShare := "none", 0.0
	tiers := class.AllTiers(class.ParamsOf(book.ClassParams))
	for i, row := range book.Classes {
		var names []string
		for _, tier := range tiers {
			if c := tierChoices(book, row.ID, tier); len(c) > 0 {
				names = append(names, fmt.Sprintf("%d: %s", tier, strings.Join(c, " or ")))
			}
		}
		won, better := 0, 0
		var lift float64
		for _, c := range cells {
			if c.classWinner(book) == row.ID {
				won++
			}
			if c.class[i] > c.loadout[0] {
				better++
			}
			lift += 100 * (c.class[i] - c.loadout[0])
		}
		share := pct(won, len(cells))
		if share > topShare {
			top, topShare = row.ID, share
		}
		pr("| %s | %s | %d | %.1f%% | %d | %+.1f points |", row.ID, either(len(names) > 0, strings.Join(names, "; "), "none"), won, share, better, lift/float64(max(len(cells), 1)))
	}
	pr("")

	rules := sheets.Lookup(book.Rules)
	var deck Loadout
	if i := slices.IndexFunc(loadouts, func(l Loadout) bool { return l.Exploit != "" }); i >= 0 {
		deck = loadouts[i]
	}
	var trials []*trial
	var kits []Loadout
	for i := range book.Abilities {
		a := &book.Abilities[i]
		if !fightRead(a) {
			continue
		}
		var subject []string
		for _, id := range a.Rules {
			if r := rules[id]; r != nil {
				subject = append(subject, r.Subject...)
			}
		}
		// An ability whose rule moves no option's band moves a measure of
		// the kit: it is tried with a deck, whose states it may lengthen.
		kit := loadouts[0]
		if !slices.Contains(subject, "option") {
			kit = deck
		}
		if !slices.ContainsFunc(kits, func(l Loadout) bool { return l.Name == kit.Name }) {
			kits = append(kits, kit)
		}
		sit := situation{ambush: slices.Contains(subject, string(class.TagAmbushed)), walled: slices.Contains(subject, string(class.TagWalled)), prey: slices.Contains(subject, string(class.TagPreyed))}
		for _, arch := range book.Creatures {
			trials = append(trials, &trial{ability: a, kit: kit, sit: sit, arch: arch.ID})
		}
	}
	for _, kit := range kits {
		for _, arch := range book.Creatures {
			trials = append(trials, &trial{kit: kit, arch: arch.ID})
		}
	}
	classes := sheets.Lookup(book.Classes)
	if err := b.each(len(trials), func(x *battle, i int) error {
		tr := trials[i]
		ft := x.p.Fight.Tier(x.creatures[tr.arch].Tier)
		var as *classBuild
		if tr.ability != nil {
			as = &classBuild{row: classes[tr.ability.Class], only: tr.ability.ID}
		}
		t, err := x.spreadCell("ability", tr.arch, tr.kit, ft.ExpectedLevel, ft.ExpectedPractice, policies[0], n/trialShare, as, tr.sit)
		tr.t = t
		return err
	}); err != nil {
		return Measured{}, err
	}
	sum := func(a *sheets.Ability, kit string) (t tally) {
		for _, tr := range trials {
			if tr.ability == a && tr.kit.Name == kit {
				t.won += tr.t.won
				t.n += tr.t.n
			}
		}
		return t
	}
	pr("### Abilities in their situations")
	pr("")
	pr("Each ability fights read, carried alone, against every archetype at its tier's expected level, in the situation its rule asks for: the first beat of any encounter needs none, an ambush, marked prey and a wall are given. An ability that moves no option's band is tried on the %s kit, whose exploit states it may lengthen.", deck.Name)
	pr("")
	pr("| Ability | Class | Tier | Situation | Kit | Won without | Won with | Lift |")
	pr("| --- | --- | --- | --- | --- | --- | --- | --- |")
	for i := range book.Abilities {
		a := &book.Abilities[i]
		j := slices.IndexFunc(trials, func(tr *trial) bool { return tr.ability == a })
		if j < 0 {
			continue
		}
		tr := trials[j]
		var where []string
		for _, s := range []struct {
			on   bool
			text string
		}{{tr.sit.ambush, "an ambush"}, {tr.sit.prey, "marked prey"}, {tr.sit.walled, "behind a wall"}} {
			if s.on {
				where = append(where, s.text)
			}
		}
		with, without := sum(a, tr.kit.Name), sum(nil, tr.kit.Name)
		pr("| %s | %s | %d | %s | %s | %.1f%% | %.1f%% | %+.1f points |", a.ID, a.Class, a.Tier, either(len(where) > 0, strings.Join(where, ", "), "any"), tr.kit.Name,
			100*without.rate(), 100*with.rate(), 100*(with.rate()-without.rate()))
	}
	pr("")
	return Measured{Target: "class-share", Value: fmt.Sprintf("top class %s wins %.1f%% of %d cells", top, topShare, len(cells)), Holds: topShare <= float64(limit)}, nil
}
