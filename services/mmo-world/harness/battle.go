package harness

import (
	"fmt"
	"os"
	"slices"
	"strings"
	"time"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/puzzle"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tags"
	"jams.team/mmo-world/sim/world"
)

// The Battle run: a matrix of tier, level, archetype and loadout, with
// thousands of seeded encounters a cell and several policies; growth
// from play; and the puzzle model (GDD 18.4).
const (
	battleSamples   = 12000 // recipes sampled for the reference gear
	battleRefDecile = 0.9   // reference gear is the sampled top decile
	firstTrials     = 200
	dailyTrials     = 30
	dailyDayCap     = 400
	pressCap        = 40
	secondsInMinute = 60
)

// Policy picks an option. It sees the options with their odds, the
// encounter, and what the character has done in it.
type Policy struct {
	Name string
	Pick func(b *battle, opts []fight.Option, e *fight.Encounter, cast bool, who string) string
}

type battle struct {
	p    *Play
	pick *draw.Drawer
	// ref is the reference gear per tier and slot.
	ref map[string]*item.Kind
	// exploits by state.
	exploits  map[string]*item.Kind
	creatures map[string]*sheets.Creature
	n         int
	// mates are battles like this one, for running cells side by side.
	mates []*battle
}

func chanceOf(b *battle, o fight.Option, e *fight.Encounter) fixed.F {
	if o.Puzzle {
		s := b.p.Fight.Situation(e, "")
		return b.p.Puzzles.SolveRate(s.Puzzle, b.puzzlePractice(e.Creature.Tier), s.Level, e.Creature.Tier, 1)
	}
	return o.Chance
}

func bestWin(b *battle, opts []fight.Option, e *fight.Encounter) (string, fixed.F) {
	id, best, score := "", fixed.F(-1), int64(-1)
	for _, o := range opts {
		if o.Kind != fight.Win {
			continue
		}
		c := chanceOf(b, o, e)
		if c > best || (c == best && o.Score > score) {
			id, best, score = o.ID, c, o.Score
		}
	}
	return id, best
}

func optionOf(opts []fight.Option, kind string) (fight.Option, bool) {
	for _, o := range opts {
		if o.Kind == kind {
			return o, true
		}
	}
	return fight.Option{}, false
}

var policies = []Policy{
	{"best", func(b *battle, opts []fight.Option, e *fight.Encounter, cast bool, who string) string {
		win, wc := bestWin(b, opts, e)
		if c, ok := optionOf(opts, fight.Cast); ok && !cast && !e.Final() && c.Chance >= wc {
			return c.ID
		}
		hold, _ := optionOf(opts, fight.Careful)
		if win == "" || (!e.Final() && hold.Chance > wc) {
			return hold.ID
		}
		return win
	}},
	{"bold", func(b *battle, opts []fight.Option, e *fight.Encounter, cast bool, who string) string {
		id, score := "", int64(-1)
		for _, o := range opts {
			if o.Kind == fight.Win && o.Score > score {
				id, score = o.ID, o.Score
			}
		}
		if id == "" {
			hold, _ := optionOf(opts, fight.Careful)
			return hold.ID
		}
		return id
	}},
	{"cautious", func(b *battle, opts []fight.Option, e *fight.Encounter, cast bool, who string) string {
		win, _ := bestWin(b, opts, e)
		hold, _ := optionOf(opts, fight.Careful)
		if e.Final() && win != "" {
			return win
		}
		return hold.ID
	}},
	{"random", func(b *battle, opts []fight.Option, e *fight.Encounter, cast bool, who string) string {
		var ids []string
		for _, o := range opts {
			if o.Kind != fight.WayOut {
				ids = append(ids, o.ID)
			}
		}
		if len(ids) == 0 && len(opts) > 0 {
			return opts[0].ID
		}
		return ids[b.pick.Below(uint64(len(ids)), "battle.random", draw.Str(e.ID), draw.Int(int64(e.At)), draw.Int(e.Press), draw.Str(who))]
	}},
}

// Loadout is a kit template: reference gear for a tier, with tags a
// milestone or a material would give, and maybe a loaded deck.
type Loadout struct {
	Name    string
	Hand    []tags.Tag
	Body    []tags.Tag
	Charm   []tags.Tag
	Exploit string // state of the exploit the deck holds
}

var loadouts = []Loadout{
	{Name: "plain"},
	{Name: "edge-and-ember", Hand: []tags.Tag{"keen"}, Charm: []tags.Tag{"warm"}},
	{Name: "storm-blade", Hand: []tags.Tag{"conductive"}, Exploit: "charged"},
	{Name: "shatter", Hand: []tags.Tag{"heavy"}, Exploit: "brittle"},
	{Name: "smoke-and-knife", Hand: []tags.Tag{"quick-drawn"}, Exploit: "hidden"},
	{Name: "wildfire", Hand: []tags.Tag{"reaching"}, Exploit: "burning"},
	{Name: "bulwark", Hand: []tags.Tag{"braced-grip"}, Body: []tags.Tag{"thick"}},
}

func newBattle(b *sheets.Book, n int) (*battle, error) {
	k := keys.Throwaway("battle-run")
	p, err := NewPlay(b, k)
	if err != nil {
		return nil, err
	}
	bt := &battle{p: p, pick: draw.NewDrawer(k.Roll), ref: map[string]*item.Kind{}, exploits: map[string]*item.Kind{},
		creatures: sheets.Lookup(b.Creatures), n: n}
	s := newSampler(b, p.Deriver, k)
	by := map[string][]*item.Kind{}
	for i := range battleSamples {
		kd := s.one(i)
		if kd == nil || kd.Failed || kd.Slot == "" || kd.Recipe.Process == item.Inscribe || len(kd.Traits) > 0 {
			continue
		}
		key := cellKey(kd.Tier, kd.Slot)
		by[key] = append(by[key], kd)
	}
	for key, ks := range by {
		slices.SortFunc(ks, func(a, c *item.Kind) int {
			if a.Vec.TopTwo() != c.Vec.TopTwo() {
				return int(a.Vec.TopTwo() - c.Vec.TopTwo())
			}
			return strings.Compare(a.ID, c.ID)
		})
		bt.ref[key] = ks[int(float64(len(ks)-1)*battleRefDecile)]
	}
	smelt, err := p.Deriver.Derive(item.Recipe{Process: item.Alloy, Method: "slow-cool", Inputs: []item.Input{{Kind: "copper-ore", Qty: 2}, {Kind: "bog-iron", Qty: 1}}}, craftStation)
	if err != nil {
		return nil, err
	}
	for state, inputs := range map[string][]string{
		"burning": {"ember-salt", "reed-ash"},
		"charged": {smelt.ID, "marsh-amber", "saltglass"},
		"brittle": {"saltglass", "river-clay"},
		"hidden":  {"reed-ash", "feathers"},
		"wet":     {"river-clay", "reedflax"},
	} {
		r := item.Recipe{Process: item.Compose, Method: "ordered"}
		for _, in := range inputs {
			r.Inputs = append(r.Inputs, item.Input{Kind: in, Qty: 1})
		}
		kd, err := p.Deriver.Derive(r, craftStation)
		if err != nil {
			return nil, err
		}
		bt.exploits[state] = kd
	}
	return bt, nil
}

func (b *battle) puzzlePractice(tier int64) int64 {
	pz := b.p.Puzzles
	return pz.Param("expected-practice-base") + pz.Param("expected-practice-per-tier")*(tier-1)
}

// variant freezes a copy of a reference kind with extra tags.
func (b *battle) variant(k *item.Kind, extra []tags.Tag) *item.Kind {
	if len(extra) == 0 {
		return k
	}
	v := *k
	v.ID = k.ID + "+" + string(extra[0])
	v.Tags = slices.Clone(k.Tags)
	for _, t := range extra {
		if !slices.Contains(v.Tags, t) {
			v.Tags = append(v.Tags, t)
		}
	}
	slices.Sort(v.Tags)
	return b.p.Deriver.Reg.Freeze(&v)
}

// character builds a fresh character with a loadout's gear at a level.
func (b *battle) character(id string, l Loadout, tier, level, practice int64, hand string) *char.Character {
	c := char.New(id, hex.Hex{})
	put := func(slot string, kind *item.Kind, lvl int64) *item.Instance {
		in := item.NewInstance(id+"-"+slot, kind, "")
		in.Level = lvl
		c.Carry(slot, 0, in)
		return in
	}
	put(char.Hand, b.variant(b.ref[cellKey(tier, hand)], l.Hand), level)
	put(char.Body, b.variant(b.ref[cellKey(tier, "plate")], l.Body), level)
	if len(l.Charm) > 0 {
		in := item.NewInstance(id+"-charm", b.variant(b.ref[cellKey(tier, "charm")], l.Charm), "")
		in.Level = level
		c.Carry(char.Charm, 0, in)
	}
	if l.Exploit != "" {
		deck := put(char.OffHand, b.ref[cellKey(tier, "focus")], level)
		ex := item.NewInstance(id+"-exploit", b.exploits[l.Exploit], "")
		ex.Level = level
		deck.Exploit = ex
	}
	for _, skill := range []string{"fight", "travel", "gather", "lockpick"} {
		c.Practice = append(c.Practice, char.Skill{ID: skill, Level: practice})
	}
	for _, f := range b.p.Book.PuzzleFamilies {
		c.Practice = append(c.Practice, char.Skill{ID: f.ID, Level: b.puzzlePractice(tier)})
	}
	slices.SortFunc(c.Practice, func(a, x char.Skill) int { return strings.Compare(a.ID, x.ID) })
	return c
}

// site is where encounter i against a creature happens: its biome's
// terrain tags, sometimes troubled.
func (b *battle) site(id string, arch string, troubledPct int64) fight.Site {
	a := b.creatures[arch]
	var ts []tags.Tag
	if len(a.Biomes) > 0 {
		for i := range b.p.Book.Terrain {
			if t := &b.p.Book.Terrain[i]; t.ID == a.Biomes[b.pick.Below(uint64(len(a.Biomes)), "battle.biome", draw.Str(id))] {
				ts = append(ts, world.TerrainTags(t)...)
			}
		}
	} else {
		ts = append(ts, "dungeon")
	}
	troubled := int64(b.pick.Below(100, "battle.troubled", draw.Str(id))) < troubledPct
	return fight.Site{ID: id, Tags: ts, Party: 1, Troubled: troubled}
}

// fightOne runs one encounter to its end with a policy and reports its
// result and presses.
func (b *battle) fightOne(c *char.Character, site fight.Site, arch string, pol Policy, sit situation) (*fight.Encounter, int, error) {
	f := b.p.Fight
	cr := f.Spawn(arch, nil, site.Tags, site.Measures)
	e := f.Assemble(site, cr)
	cast := false
	presses := 0
	for !e.Over && presses < pressCap {
		s, kit, opts := f.Choices(e, c, b.kitOf(c, e, sit), 0)
		pick := pol.Pick(b, opts, e, cast, c.ID)
		m := &fight.Member{Ch: c, Kit: b.kitOf(c, e, sit), Pick: pick}
		o, _ := fight.OptionByID(opts, pick)
		if o.Puzzle {
			res := f.ModelPuzzle(s, kit, 1, fight.Roll{Who: c.ID, Encounter: e.ID, Beat: int64(e.At)})
			m.Puzzle = &res
		}
		if o.Kind == fight.Cast {
			cast = true
		}
		if _, _, err := f.Press(e, []*fight.Member{m}, 0); err != nil {
			return e, presses, err
		}
		presses++
	}
	return e, presses, nil
}

type tally struct {
	won, n, presses int
	results         map[string]int
}

func (t *tally) add(e *fight.Encounter, presses int) {
	if t.results == nil {
		t.results = map[string]int{}
	}
	t.n++
	t.presses += presses
	t.results[e.Result]++
	if e.Result == fight.Won {
		t.won++
	}
}

func (t tally) rate() float64 { return float64(t.won) / float64(max(t.n, 1)) }

// cell runs n encounters of one archetype with one loadout and policy,
// as a class build in a situation if one is given.
func (b *battle) cell(name, arch string, l Loadout, level, practice int64, pol Policy, n int, as *classBuild, sit situation) (tally, error) {
	tier := b.creatures[arch].Tier
	var t tally
	for i := range n {
		id := fmt.Sprintf("%s-%s-%d", name, arch, i)
		c := b.character("c-"+id, l, tier, level, practice, "blade")
		b.classed(c, as)
		e, presses, err := b.fightOne(c, b.site(id, arch, 0), arch, pol, sit)
		if err != nil {
			return t, err
		}
		t.add(e, presses)
	}
	return t, nil
}

// spreadCell is a cell over players within the sheet's spread of an
// expected practice, n encounters in all.
func (b *battle) spreadCell(name, arch string, l Loadout, level, expected int64, pol Policy, n int, as *classBuild, sit situation) (tally, error) {
	spread := sheets.IntParam(b.p.Book.FightParams, "even-spread")
	var all tally
	for pr := max(0, expected-spread); pr <= expected+spread; pr++ {
		t, err := b.cell(fmt.Sprintf("%s-%d", name, pr), arch, l, level, pr, pol, max(1, n/int(2*spread+1)), as, sit)
		if err != nil {
			return all, err
		}
		all.won += t.won
		all.n += t.n
		all.presses += t.presses
	}
	return all, nil
}

// BattleRun is the Battle run.
func BattleRun(b *sheets.Book, out string, n int) ([]Measured, error) {
	if n == 0 {
		n = int(sheets.IntParam(b.FightParams, "battle-runs"))
	}
	only := os.Getenv("BATTLE_ONLY")
	start := time.Now()
	bt, err := newBattle(b, n)
	if err != nil {
		return nil, err
	}
	var doc lineDoc
	pr := doc.p
	pr("# Battle run")
	pr("")
	pr("%s encounters a cell. Reference gear is the sampled top decile of each tier and slot among kinds with no trait, so loadouts differ only by what they add (%s recipes). Throwaway key `battle-run`.", comma(int64(n)), comma(battleSamples))
	pr("")
	var readings []Measured
	// Dungeon guardians are party content (GDD 7.9), so the solo even
	// fight leaves them out; the matrix keeps them.
	byTier := map[int64][]string{}
	for _, a := range b.Creatures {
		if !slices.Contains(a.Tags, "guardian") {
			byTier[a.Tier] = append(byTier[a.Tier], a.ID)
		}
	}

	pr("## Reference kit")
	pr("")
	pr("| Tier | Blade (edge, weight, flex, conduct, heat, ward, reach, bond) | Plate | Level | Practice | Strike score | Hold score | Base difficulty |")
	pr("| --- | --- | --- | --- | --- | --- | --- | --- |")
	for _, ft := range b.FightTiers {
		c := bt.character("ref", loadouts[0], ft.Tier, ft.ExpectedLevel, ft.ExpectedPractice, "blade")
		var arch string
		for _, a := range b.Creatures {
			if a.Tier == ft.Tier && arch == "" {
				arch = a.ID
			}
		}
		cr := bt.p.Fight.Spawn(arch, nil, nil, nil)
		opts := bt.p.Fight.Options(fight.Situation{Encounter: "ref", Kind: "clash", Creature: &cr, Party: 1}, bt.p.Fight.KitOf(c))
		strike, _ := fight.OptionByID(opts, "strike")
		hold, _ := fight.OptionByID(opts, "hold")
		pr("| tier %d | %v | %v | %d | %d | %d | %d | %d |", ft.Tier, bt.ref[cellKey(ft.Tier, "blade")].Vec, bt.ref[cellKey(ft.Tier, "plate")].Vec,
			ft.ExpectedLevel, ft.ExpectedPractice, strike.Score, hold.Score, ft.BaseDifficulty)
	}
	pr("")

	solo := map[int64]float64{}
	if only != "matrix" {
		// Even fights at equal tier, every policy.
		pr("## Even fights at equal tier")
		pr("")
		pr("Characters at each tier's expected gear level, and at practice within `even-spread` of its expected practice (`fights.tiers`), against every archetype of that tier but dungeon guardians, which are party content.")
		pr("")
		pr("| Tier | Level | Practice | Policy | Won | Held | Left or escaped | Lost | Presses an encounter |")
		pr("| --- | --- | --- | --- | --- | --- | --- | --- | --- |")
		evenOK := true
		var evenNotes []string
		target, tol := sheets.IntParam(b.FightParams, "even-target"), sheets.IntParam(b.FightParams, "even-tolerance")
		for _, ft := range b.FightTiers {
			for _, pol := range policies {
				var all tally
				spread := sheets.IntParam(b.FightParams, "even-spread")
				for _, arch := range byTier[ft.Tier] {
					for pr := max(0, ft.ExpectedPractice-spread); pr <= ft.ExpectedPractice+spread; pr++ {
						t, err := bt.cell(fmt.Sprintf("even-%s-%d", pol.Name, pr), arch, loadouts[0], ft.ExpectedLevel, pr, pol, max(1, n/int(2*spread+1)), nil, situation{})
						if err != nil {
							return nil, err
						}
						all.won += t.won
						all.n += t.n
						all.presses += t.presses
						for k, v := range t.results {
							if all.results == nil {
								all.results = map[string]int{}
							}
							all.results[k] += v
						}
					}
				}
				r := all.results
				pr("| tier %d | %d | %d | %s | %.1f%% | %.1f%% | %.1f%% | %.1f%% | %.1f |", ft.Tier, ft.ExpectedLevel, ft.ExpectedPractice, pol.Name,
					pct(all.won, all.n), pct(r[fight.Held], all.n), pct(r[fight.Left]+r[fight.Escaped], all.n), pct(r[fight.Lost], all.n), float64(all.presses)/float64(max(all.n, 1)))
				if pol.Name == "best" {
					rate := pct(all.won, all.n)
					evenNotes = append(evenNotes, fmt.Sprintf("tier %d %.1f%%", ft.Tier, rate))
					solo[ft.Tier] = rate
					if rate < float64(target-tol) || rate > float64(target+tol) {
						evenOK = false
					}
				}
			}
		}
		pr("")
		readings = append(readings, Measured{Target: "even-fight", Value: strings.Join(evenNotes, ", ") + " (best policy)", Holds: evenOK})
		if only == "even" {
			return readings, doc.save(out, "battle.md")
		}
		parties, err := bt.partySections(pr, b, byTier, solo, n)
		if err != nil {
			return nil, err
		}
		readings = append(readings, parties...)
		if only == "party" {
			return readings, doc.save(out, "battle.md")
		}

	}
	// The matchup matrix: which loadout wins each archetype and level,
	// and which class does on the plain kit.
	cells, err := bt.matrix(b, n)
	if err != nil {
		return nil, err
	}
	pr("## Matchup matrix")
	pr("")
	pr("Win rate with the best policy, by loadout, for every archetype at three gear levels, over players within `even-spread` of the tier's expected practice. The cell's winner is the loadout with the highest rate; the plain kit wins ties. The class columns are the plain kit carried by each class on its own (see Classes below), and the last column is the winner with those counted.")
	pr("")
	header := "| Archetype | Level |"
	sep := "| --- | --- |"
	for _, l := range loadouts {
		header += " " + l.Name + " |"
		sep += " --- |"
	}
	header += " Winner |"
	sep += " --- |"
	for _, c := range b.Classes {
		header += " " + c.ID + " |"
		sep += " --- |"
	}
	pr("%s With classes |", header)
	pr("%s --- |", sep)
	wins := map[string]int{}
	for _, c := range cells {
		row := fmt.Sprintf("| %s | %d |", c.arch, c.level)
		for _, r := range c.loadout {
			row += fmt.Sprintf(" %.1f%% |", 100*r)
		}
		best := c.winner()
		wins[best]++
		row += " " + best + " |"
		for _, r := range c.class {
			row += fmt.Sprintf(" %.1f%% |", 100*r)
		}
		pr("%s %s |", row, c.classWinner(b))
	}
	pr("")
	limit := sheets.IntParam(b.FightParams, "pairing-share-max")
	worst, worstShare := "", 0.0
	pr("| Loadout | Cells won | Share |")
	pr("| --- | --- | --- |")
	for _, l := range loadouts {
		share := pct(wins[l.Name], len(cells))
		pr("| %s | %d | %.1f%% |", l.Name, wins[l.Name], share)
		if l.Name != "plain" && share > worstShare {
			worst, worstShare = l.Name, share
		}
	}
	pr("")
	readings = append(readings, Measured{Target: "tag-pairing-share", Value: fmt.Sprintf("top pairing %s wins %.1f%% of %d cells", worst, worstShare, len(cells)), Holds: worstShare <= float64(limit)})
	share, err := bt.classSections(pr, b, cells, n)
	if err != nil {
		return nil, err
	}
	readings = append(readings, share)
	if only == "matrix" {
		return readings, doc.save(out, "battle.md")
	}

	// Growth from play.
	first, err := bt.firstTool()
	if err != nil {
		return nil, err
	}
	g := bt.p.Growth
	pr("## Growth")
	pr("")
	pr("A first tool, tier 1, level 1, practice 0, fighting tier-1 encounters with the best policy at %d s a press: minutes to level %d over %d trials: median %.1f, p90 %.1f.",
		g.Param("seconds-per-beat"), g.Param("first-level"), firstTrials, percentile(first, 50), percentile(first, 90))
	readings = append(readings, Measured{Target: "first-tool-level-5", Value: fmt.Sprintf("median %.1f min, p90 %.1f min", percentile(first, 50), percentile(first, 90)), Holds: percentile(first, 50) <= float64(g.Param("first-minutes"))})
	days, err := bt.tierTwoDays()
	if err != nil {
		return nil, err
	}
	lo, hi := g.Param("tier-2-days-min"), g.Param("tier-2-days-max")
	med := percentile(days, 50)
	pr("")
	pr("A tier-2 blade from level 1, %d encounters a world day at tier 2 (%d%% troubled), practice from the tier's expected and rising: world days to level 20 over %d trials: median %d, range %d to %d.",
		g.Param("daily-encounters"), g.Param("daily-troubled"), dailyTrials, med, days[0], days[len(days)-1])
	readings = append(readings, Measured{Target: "tier-2-level-20", Value: fmt.Sprintf("median %d world days (%d to %d)", med, days[0], days[len(days)-1]), Holds: med >= lo && med <= hi})
	pr("")

	// Puzzles.
	rate, rows := bt.puzzleRate()
	pr("## Puzzles")
	pr("")
	pr("The solve-rate model for a party of 2 to 4, over all %d families, every tier and dungeon floor 1 to %d, at the tier's expected practice and at practice 0 to %d in steps of %d. The target reads the expected rows.",
		len(b.PuzzleFamilies), bt.p.Puzzles.Param("floors"), sheets.IntParam(b.GrowthParams, "practice-max"), puzzlePracticeStep)
	pr("")
	pr("| Tier | Practice | Mean solve rate |")
	pr("| --- | --- | --- |")
	for _, r := range rows {
		pr("| tier %d | %d%s | %.1f%% |", r.tier, r.practice, either(r.expected, ", expected", ""), 100*r.rate)
	}
	pr("")
	pz := bt.p.Puzzles
	readings = append(readings, Measured{Target: "puzzle-solve-rate", Value: fmt.Sprintf("%.1f%% over every cell", 100*rate),
		Holds: rate*100 >= float64(pz.Param("solve-target-min")) && rate*100 <= float64(pz.Param("solve-target-max"))})
	pr("Took %s.", time.Since(start).Round(time.Second))
	if err := doc.save(out, "battle.md"); err != nil {
		return nil, err
	}
	return readings, nil
}

// firstTool: minutes for a new character's first tool to reach the
// first milestone level.
func (b *battle) firstTool() ([]float64, error) {
	g := b.p.Growth
	var out []float64
	archs := []string{}
	for _, a := range b.p.Book.Creatures {
		if a.Tier == 1 {
			archs = append(archs, a.ID)
		}
	}
	for trial := range firstTrials {
		c := b.character(fmt.Sprintf("first-%d", trial), loadouts[0], 1, 1, 0, "tool")
		c.Practice = nil
		hand := c.In(char.Hand, 0)
		presses := 0
		for i := 0; hand.Level < g.Param("first-level") && i < pressCap*pressCap; i++ {
			arch := archs[i%len(archs)]
			id := fmt.Sprintf("first-%d-%d", trial, i)
			c.Conditions = nil
			hand.Repair()
			_, n, err := b.fightOne(c, b.site(id, arch, 0), arch, policies[0], situation{})
			if err != nil {
				return nil, err
			}
			presses += n
		}
		out = append(out, float64(presses)*float64(g.Param("seconds-per-beat"))/secondsInMinute)
	}
	slices.Sort(out)
	return out, nil
}

// tierTwoDays: world days of daily play for a tier-2 item to reach its
// level cap.
func (b *battle) tierTwoDays() ([]int64, error) {
	g := b.p.Growth
	var archs []string
	for _, a := range b.p.Book.Creatures {
		if a.Tier == 2 {
			archs = append(archs, a.ID)
		}
	}
	ft := b.p.Fight.Tier(2)
	var out []int64
	for trial := range dailyTrials {
		c := b.character(fmt.Sprintf("daily-%d", trial), loadouts[0], 2, 1, ft.ExpectedPractice, "blade")
		hand := c.In(char.Hand, 0)
		var day int64
		for day = 1; day <= dailyDayCap; day++ {
			for i := range g.Param("daily-encounters") {
				arch := archs[int(i)%len(archs)]
				id := fmt.Sprintf("daily-%d-%d-%d", trial, day, i)
				c.Conditions = nil
				hand.Repair()
				c.In(char.Body, 0).Repair()
				if _, _, err := b.fightOne(c, b.site(id, arch, g.Param("daily-troubled")), arch, policies[0], situation{}); err != nil {
					return nil, err
				}
			}
			if hand.Level >= g.Cap(2) {
				break
			}
		}
		out = append(out, day)
	}
	slices.Sort(out)
	return out, nil
}

type puzzleRow struct {
	tier, practice int64
	expected       bool
	rate           float64
}

// puzzlePracticeStep is how far apart the puzzle table's practice levels
// are.
const puzzlePracticeStep = 4

// puzzleRate is the mean party solve rate at the expected practice over
// every family, tier, floor and party size of 2 to 4, and the table's
// rows: per tier, that practice and every step of practice up to the cap.
func (b *battle) puzzleRate() (float64, []puzzleRow) {
	top := sheets.IntParam(b.p.Book.GrowthParams, "practice-max")
	var sum float64
	var n int
	var rows []puzzleRow
	for _, ft := range b.p.Book.FightTiers {
		want := b.puzzlePractice(ft.Tier)
		levels := []int64{want}
		for pr := int64(0); pr <= top; pr += puzzlePracticeStep {
			if pr != want {
				levels = append(levels, pr)
			}
		}
		slices.Sort(levels)
		for _, pr := range levels {
			ts, tn := b.puzzleCells(ft.Tier, pr)
			rows = append(rows, puzzleRow{tier: ft.Tier, practice: pr, expected: pr == want, rate: ts / float64(tn)})
			if pr == want {
				sum += ts
				n += tn
			}
		}
	}
	return sum / float64(n), rows
}

// puzzleCells sums the model's solve rate over a tier's cells at one
// practice, and counts them.
func (b *battle) puzzleCells(tier, practice int64) (float64, int) {
	pz := b.p.Puzzles
	var sum float64
	var n int
	for _, f := range b.p.Book.PuzzleFamilies {
		for floor := int64(1); floor <= pz.Param("floors"); floor++ {
			w := puzzle.Where{Place: fmt.Sprintf("floor:battle/%d", floor), Beat: tier}
			lvl := pz.Level(f.ID, tier, floor, w)
			for party := int64(2); party <= 4; party++ {
				sum += float64(pz.SolveRate(f.ID, practice, lvl, tier, party)) / float64(fixed.Scale)
				n++
			}
		}
	}
	return sum, n
}
