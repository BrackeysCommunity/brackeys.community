package harness

import (
	"fmt"
	"math"
	"slices"
	"strings"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/party"
	"jams.team/mmo-world/sim/puzzle"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tags"
)

// The Battle run's parties (GDD 7.5, 7.11): the even fight at every party
// size, each party ability carried alone, and the party machines, from
// their own solvers.

// measurePartySize is the site measure a shared encounter carries, as the
// game sets it, so a behaviour that reads the party's size reads it here.
const measurePartySize = "party-size"

// partyMachineLevels are the levels a party version's solver is timed at.
const partyMachineLevels = 12

// partyPick is the best policy for one member of a party: a machine is
// weighed at the party's own solve rate.
func (b *battle) partyPick(opts []fight.Option, e *fight.Encounter, size int64) string {
	win, wc, score := "", fixed.F(-1), int64(-1)
	for _, o := range opts {
		if o.Kind != fight.Win {
			continue
		}
		c := o.Chance
		if o.Puzzle {
			s := b.p.Fight.Situation(e, "")
			c = b.p.Puzzles.SolveRate(s.Puzzle, b.puzzlePractice(e.Creature.Tier), s.Level, e.Creature.Tier, size)
		}
		if c > wc || (c == wc && o.Score > score) {
			win, wc, score = o.ID, c, o.Score
		}
	}
	hold, _ := optionOf(opts, fight.Careful)
	if win == "" || (!e.Final() && hold.Chance > wc) {
		return hold.ID
	}
	return win
}

// partyFight runs one shared encounter to its end: each member picks for
// itself; when the first member up picks the machine, the party works it
// together and every member up moves on it.
func (b *battle) partyFight(cs []*char.Character, site fight.Site, arch string, sit situation) (*fight.Encounter, error) {
	f := b.p.Fight
	size := int64(len(cs))
	site.Party = size
	site.Measures = append(site.Measures, tags.Measure{ID: measurePartySize, Value: size})
	e := f.Assemble(site, f.Spawn(arch, nil, site.Tags, site.Measures))
	for presses := 0; !e.Over && presses < pressCap; presses++ {
		var ms []*fight.Member
		var movers []string
		machine := false
		var first fight.Situation
		var firstKit fight.Kit
		for _, c := range cs {
			kit := b.kitOf(c, e, sit)
			m := &fight.Member{Ch: c, Kit: kit}
			ms = append(ms, m)
			if slices.Contains(e.Down, c.ID) || slices.Contains(e.Gone, c.ID) {
				continue
			}
			s, k, opts := f.Choices(e, c, kit, 0)
			m.Pick = b.partyPick(opts, e, size)
			movers = append(movers, c.ID)
			if o, _ := fight.OptionByID(opts, m.Pick); o.Puzzle && len(movers) == 1 {
				machine, first, firstKit = true, s, k
			}
		}
		var err error
		if machine {
			res := f.ModelPuzzle(first, firstKit, int64(len(movers)), fight.Roll{Who: movers[0], Encounter: e.ID, Beat: int64(e.At)})
			_, _, err = f.PressMachine(e, ms, res, movers, 0)
		} else {
			for _, m := range ms {
				if o, ok := b.optionFor(e, m); ok && o.Puzzle {
					m.Pick = b.nonMachine(e, m)
				}
			}
			_, _, err = f.Press(e, ms, 0)
		}
		if err != nil {
			return e, err
		}
	}
	return e, nil
}

// optionFor is the option a member's pick names on the beat.
func (b *battle) optionFor(e *fight.Encounter, m *fight.Member) (fight.Option, bool) {
	if m.Pick == "" {
		return fight.Option{}, false
	}
	_, _, opts := b.p.Fight.Choices(e, m.Ch, m.Kit, 0)
	return fight.OptionByID(opts, m.Pick)
}

// nonMachine is a member's best pick that is not the machine: a machine
// is the party's to work, and only the first member up starts it.
func (b *battle) nonMachine(e *fight.Encounter, m *fight.Member) string {
	_, _, opts := b.p.Fight.Choices(e, m.Ch, m.Kit, 0)
	var rest []fight.Option
	for _, o := range opts {
		if !o.Puzzle {
			rest = append(rest, o)
		}
	}
	return b.partyPick(rest, e, 1)
}

// partyTally is a party cell's encounters: those won, and the members
// still down at their end.
type partyTally struct {
	won, n, down int
}

func (t *partyTally) add(e *fight.Encounter) {
	t.n++
	t.down += len(e.Down)
	if e.Result == fight.Won {
		t.won++
	}
}

func (t partyTally) rate() float64 { return float64(t.won) / float64(max(t.n, 1)) }

// partyCell runs n shared encounters of one archetype for a party of size
// at a tier's expected gear level and one practice; ability, when set, is
// carried alone by the first member.
func (b *battle) partyCell(name, arch string, size int, level, practice int64, n int, ability *classBuild, floor int64) (partyTally, error) {
	tier := b.creatures[arch].Tier
	var t partyTally
	for i := range n {
		id := fmt.Sprintf("%s-%s-%d", name, arch, i)
		var cs []*char.Character
		for s := range size {
			c := b.character(fmt.Sprintf("c-%s-%d", id, s), loadouts[0], tier, level, practice, "blade")
			if s == 0 {
				b.classed(c, ability)
			}
			cs = append(cs, c)
		}
		site := b.site(id, arch, 0)
		site.Floor = floor
		e, err := b.partyFight(cs, site, arch, situation{})
		if err != nil {
			return t, err
		}
		t.add(e)
	}
	return t, nil
}

// partyEvenJob is one cell of the even fight at party sizes: a tier, a
// size, an archetype and a practice.
type partyEvenJob struct {
	tier          int64
	size          int
	arch          string
	practice      int64
	t             partyTally
	level, trials int
}

// partySections writes the Battle run's parties and returns their
// readings. solo is the best policy's even-fight rate at each tier.
func (b *battle) partySections(pr func(string, ...any), book *sheets.Book, byTier map[int64][]string, solo map[int64]float64, n int) ([]Measured, error) {
	var readings []Measured
	most := int(sheets.IntParam(book.FightParams, "party-size-max"))
	spread := sheets.IntParam(book.FightParams, "even-spread")
	tol := float64(sheets.IntParam(book.FightParams, "even-tolerance"))
	target := float64(sheets.IntParam(book.FightParams, "even-target"))
	var jobs []*partyEvenJob
	for _, ft := range book.FightTiers {
		for size := party.MinSize; size <= most; size++ {
			for _, arch := range byTier[ft.Tier] {
				for p := max(0, ft.ExpectedPractice-spread); p <= ft.ExpectedPractice+spread; p++ {
					jobs = append(jobs, &partyEvenJob{tier: ft.Tier, size: size, arch: arch, practice: p, level: int(ft.ExpectedLevel), trials: max(1, n/int(2*spread+1))})
				}
			}
		}
	}
	if err := b.each(len(jobs), func(x *battle, i int) error {
		j := jobs[i]
		t, err := x.partyCell(fmt.Sprintf("party-%d-%d", j.size, j.practice), j.arch, j.size, int64(j.level), j.practice, j.trials, nil, 0)
		j.t = t
		return err
	}); err != nil {
		return nil, err
	}
	sum := func(tier int64, size int) (t partyTally) {
		for _, j := range jobs {
			if j.tier == tier && j.size == size {
				t.won, t.n, t.down = t.won+j.t.won, t.n+j.t.n, t.down+j.t.down
			}
		}
		return t
	}
	pr("## Parties")
	pr("")
	pr("### Even fights at party sizes")
	pr("")
	pr("Parties of %d to %d, every member at the tier's expected gear level and the same practice within `even-spread` of the tier's expected, in one shared encounter against every archetype of that tier but dungeon guardians, with the best policy. Each member picks for itself and the beat is won when half of those up win (GDD 7.5); a machine the first member up picks is worked by every member up, at the party's solve rate. A party column holds when it is within `even-tolerance` (%.0f points) of the solo column at the same tier; the absolute 50 ± 5 is claimed only where solo holds it.", party.MinSize, most, tol)
	pr("")
	header, sep := "| Tier | Solo |", "| --- | --- |"
	for size := party.MinSize; size <= most; size++ {
		header += fmt.Sprintf(" Party of %d | Down at the end |", size)
		sep += " --- | --- |"
	}
	pr("%s", header)
	pr("%s", sep)
	notes := map[int][]string{}
	ok := map[int]bool{}
	for size := party.MinSize; size <= most; size++ {
		ok[size] = true
	}
	for _, ft := range book.FightTiers {
		row := fmt.Sprintf("| tier %d | %.1f%% |", ft.Tier, solo[ft.Tier])
		for size := party.MinSize; size <= most; size++ {
			t := sum(ft.Tier, size)
			rate := 100 * t.rate()
			diff := rate - solo[ft.Tier]
			row += fmt.Sprintf(" %.1f%% (%+.1f) | %.2f |", rate, diff, float64(t.down)/float64(max(t.n, 1)))
			soloHolds := math.Abs(solo[ft.Tier]-target) <= tol
			abs := ""
			if soloHolds {
				abs = fmt.Sprintf(", 50 ± 5 %s", either(math.Abs(rate-target) <= tol, "holds", "fails"))
			}
			notes[size] = append(notes[size], fmt.Sprintf("tier %d %.1f%% (solo %.1f%%, %+.1f%s)", ft.Tier, rate, solo[ft.Tier], diff, abs))
			if math.Abs(diff) > tol {
				ok[size] = false
			}
		}
		pr("%s", row)
	}
	pr("")
	for size := party.MinSize; size <= most; size++ {
		readings = append(readings, Measured{Target: fmt.Sprintf("even-fight-party-%d", size), Value: strings.Join(notes[size], ", "), Holds: ok[size]})
	}

	if err := b.partyAbilities(pr, book, n, most); err != nil {
		return nil, err
	}
	readings = append(readings, b.partyMachines(pr, book)...)
	return readings, nil
}

// partyAbilityRead reports whether an ability is a party ability fights
// read: its rule reads a party member, or a floor a fights param names.
// The floor is that param's value, 0 for none.
func partyAbilityRead(book *sheets.Book, a *sheets.Ability) (bool, int64) {
	if !fightRead(a) {
		return false, 0
	}
	for _, p := range book.FightParams {
		if strings.HasSuffix(p.ID, "-floor") && strings.Contains(a.Reads, p.ID) {
			return true, sheets.IntParam(book.FightParams, p.ID)
		}
	}
	return strings.Contains(a.Reads, "party"), 0
}

// partyTrial is one party ability carried alone by the first member of a
// party, or none, against one archetype.
type partyTrial struct {
	ability *sheets.Ability
	floor   int64
	arch    string
	t       partyTally
}

// partyAbilities writes each party ability's lift alone: a party of the
// largest size, one member carrying it, against every archetype at its
// tier's expected level and practice, beside the same party without it.
func (b *battle) partyAbilities(pr func(string, ...any), book *sheets.Book, n, size int) error {
	classes := sheets.Lookup(book.Classes)
	var trials []*partyTrial
	floors := map[int64]bool{}
	for i := range book.Abilities {
		a := &book.Abilities[i]
		read, floor := partyAbilityRead(book, a)
		if !read {
			continue
		}
		floors[floor] = true
		for _, arch := range book.Creatures {
			trials = append(trials, &partyTrial{ability: a, floor: floor, arch: arch.ID})
		}
	}
	for floor := range floors {
		for _, arch := range book.Creatures {
			trials = append(trials, &partyTrial{floor: floor, arch: arch.ID})
		}
	}
	slices.SortFunc(trials, func(x, y *partyTrial) int { return strings.Compare(trialKey(x), trialKey(y)) })
	if err := b.each(len(trials), func(x *battle, i int) error {
		tr := trials[i]
		ft := x.p.Fight.Tier(x.creatures[tr.arch].Tier)
		var as *classBuild
		if tr.ability != nil {
			as = &classBuild{row: classes[tr.ability.Class], only: tr.ability.ID}
		}
		t, err := x.partyCell(fmt.Sprintf("party-ability-%d", tr.floor), tr.arch, size, ft.ExpectedLevel, ft.ExpectedPractice, max(1, n/trialShare), as, tr.floor)
		tr.t = t
		return err
	}); err != nil {
		return err
	}
	sum := func(a *sheets.Ability, floor int64) (t partyTally) {
		for _, tr := range trials {
			if tr.ability == a && tr.floor == floor {
				t.won, t.n, t.down = t.won+tr.t.won, t.n+tr.t.n, t.down+tr.t.down
			}
		}
		return t
	}
	pr("### Party abilities alone")
	pr("")
	pr("Each ability whose rule reads a party member, or a floor a `fights.params` cell names, carried alone by the first member of a party of %d, against every archetype at its tier's expected level and practice, beside the same party with no class. A floor ability fights on that floor. Down at the end is members a party encounter ends with down: Stand over keeps them, and Unmoved and Deep breath turn a downing failure into a wound.", size)
	pr("")
	pr("| Ability | Class | Tier | Floor | Won without | Won with | Lift | Down at the end, without | With |")
	pr("| --- | --- | --- | --- | --- | --- | --- | --- | --- |")
	for i := range book.Abilities {
		a := &book.Abilities[i]
		read, floor := partyAbilityRead(book, a)
		if !read {
			continue
		}
		with, without := sum(a, floor), sum(nil, floor)
		pr("| %s | %s | %d | %s | %.1f%% | %.1f%% | %+.1f points | %.2f | %.2f |", a.ID, a.Class, a.Tier, either(floor > 0, fmt.Sprint(floor), "open ground"),
			100*without.rate(), 100*with.rate(), 100*(with.rate()-without.rate()),
			float64(without.down)/float64(max(without.n, 1)), float64(with.down)/float64(max(with.n, 1)))
	}
	pr("")
	return nil
}

func trialKey(t *partyTrial) string {
	id := ""
	if t.ability != nil {
		id = t.ability.ID
	}
	return fmt.Sprintf("%s/%d/%s", id, t.floor, t.arch)
}

// versionRate is the model's solve rate for a party version at a cell:
// the family's party rate with the version's own measured help in place
// of party-help, and the decoys the version adds past two seats, kept
// inside the model's bounds.
func versionRate(pz *puzzle.Puzzles, row *sheets.PartyVersion, practice, level, tier, seats int64) float64 {
	rate := float64(pz.SolveRate(row.Family, practice, level, tier, seats)) / float64(fixed.Scale)
	adj := (row.Rate-pz.Param("party-help"))*(seats-1) + pz.Param("solve-per-decoy")*row.Decoys*(seats-party.MinSize)
	rate += float64(adj) / float64(fixed.Hundredths)
	lo, hi := float64(pz.Param("solve-min"))/float64(fixed.Hundredths), float64(pz.Param("solve-max"))/float64(fixed.Hundredths)
	return math.Max(lo, math.Min(hi, rate))
}

// partyHelp is a version's measured help at one cell: the share of its
// countdown a seat past the first saves, in percent, against the family's
// own solver alone at the level.
func partyHelp(pz *puzzle.Puzzles, row *sheets.PartyVersion, level, seats int64) float64 {
	w := puzzle.Where{Place: "battle/party-help", Beat: level}
	solo := puzzle.Spec{Family: row.Family, Level: level, Tier: 1, Place: w.Place, Beat: w.Beat}
	merged := solo
	merged.Party, merged.Seats = row.ID, seats
	soloMs := pz.Solve(pz.Make(solo)).Stop()
	mergedMs := pz.PartySolve(pz.Make(merged)).Stop()
	countdown := pz.PartyCountdown(merged, 0)
	return float64((soloMs-mergedMs)*fixed.Hundredths) / float64(countdown) / float64(seats-1)
}

// partyMachines writes every party version's solve rate and measured
// help, and returns party-solve-rate-<version> and party-help-measured.
func (b *battle) partyMachines(pr func(string, ...any), book *sheets.Book) []Measured {
	pz := b.p.Puzzles
	most := sheets.IntParam(book.FightParams, "party-size-max")
	lo, hi := float64(pz.Param("solve-target-min")), float64(pz.Param("solve-target-max"))
	var rows []*sheets.PartyVersion
	for i := range book.PartyVersions {
		if r := &book.PartyVersions[i]; r.Family != "" {
			rows = append(rows, r)
		}
	}
	pr("### Party machines")
	pr("")
	pr("The solve rate is the model's for a party at the tier's expected practice over every tier, dungeon floor 1 to %d and 2 to %d seats, with the version's own `rate` in place of `party-help` and the decoys it adds past two seats. The measured help is, for 2 to %d seats and levels 1 to %d at tier 1, the countdown share (percent) the version's merged solve saves on the family's own solve alone, per seat past the first: `(solo ms − merged ms) × 100 / countdown / (seats − 1)`, averaged. `party-help` and each row's `rate` should be that reading, rounded down (never below 0).",
		pz.Param("floors"), most, most, partyMachineLevels)
	pr("")
	pr("| Version | Family | Solve rate | 2 seats | 3 seats | 4 seats | Measured help | Sheet rate |")
	pr("| --- | --- | --- | --- | --- | --- | --- | --- |")
	var out []Measured
	var all []float64
	rateOK := true
	var off []string
	for _, row := range rows {
		bySeats := map[int64][2]float64{}
		var helps []float64
		for seats := int64(party.MinSize); seats <= most; seats++ {
			for level := int64(1); level <= partyMachineLevels; level++ {
				helps = append(helps, partyHelp(pz, row, level, seats))
			}
			for _, ft := range book.FightTiers {
				practice := b.puzzlePractice(ft.Tier)
				for floor := int64(1); floor <= pz.Param("floors"); floor++ {
					w := puzzle.Where{Place: fmt.Sprintf("floor:battle/%d", floor), Beat: ft.Tier}
					lvl := pz.Level(row.Family, ft.Tier, floor, w)
					got := bySeats[seats]
					got[0] += versionRate(pz, row, practice, lvl, ft.Tier, seats)
					got[1]++
					bySeats[seats] = got
				}
			}
		}
		var sum, cells float64
		cols := ""
		for seats := int64(party.MinSize); seats <= most; seats++ {
			got := bySeats[seats]
			sum, cells = sum+got[0], cells+got[1]
			cols += fmt.Sprintf(" %.1f%% |", 100*got[0]/math.Max(got[1], 1))
		}
		rate := 100 * sum / math.Max(cells, 1)
		help := mean(helps)
		all = append(all, helps...)
		want := max(0, int64(math.Floor(help)))
		if row.Rate != want {
			rateOK = false
			off = append(off, fmt.Sprintf("%s %d (measured %.1f)", row.ID, row.Rate, help))
		}
		pr("| %s | %s | %.1f%% |%s %.1f%% | %d%% |", row.ID, row.Family, rate, cols, help, row.Rate)
		out = append(out, Measured{Target: "party-solve-rate-" + row.ID, Value: fmt.Sprintf("%.1f%% over every cell (%s)", rate, strings.TrimSpace(strings.ReplaceAll(cols, " |", ","))),
			Holds: rate >= lo && rate <= hi})
	}
	pr("")
	measured := mean(all)
	want := max(0, int64(math.Floor(measured)))
	sheet := pz.Param("party-help")
	pr("Over every version: measured help %.2f%% a seat past the first; `party-help` is %d%%, the reading gives %d%%.", measured, sheet, want)
	pr("")
	value := fmt.Sprintf("measured %.2f%% a seat; party-help %d (wants %d)", measured, sheet, want)
	if len(off) > 0 {
		value += "; rates off: " + strings.Join(off, ", ")
	}
	out = append(out, Measured{Target: "party-help-measured", Value: value, Holds: sheet == want && rateOK})
	return out
}

func mean(xs []float64) float64 {
	if len(xs) == 0 {
		return 0
	}
	var s float64
	for _, x := range xs {
		s += x
	}
	return s / float64(len(xs))
}
