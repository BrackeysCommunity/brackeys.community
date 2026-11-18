package harness

import (
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/world"
)

const (
	spikeBHorizon = 30 // discovered: regions within this many tiles of the first starting settlement
	daysPerWeek   = 7  // the chronicle folds a faction's expansions by the week
)

type runB struct {
	w     *gen.Area
	s     *world.State
	log   *fact.Mem
	daily threatTrace
}

func runWorldB(b *sheets.Book, seed int) (*runB, error) {
	g, s, err := newWorld(b, fmt.Sprintf("spike-b-%d", seed))
	if err != nil {
		return nil, err
	}
	w := g.Discovered(g.Settlement(0).Hex, spikeBHorizon)
	r := &runB{w: w, s: s, log: &fact.Mem{}}
	// Discovered: the regions whose centres lie within the horizon of the
	// first settlement; the world wakes the regions round them.
	for _, reg := range w.Regions {
		if err := s.Discover(r.log, reg.Base.Centre, fact.Ref{Kind: "harness", ID: "spike-b"}); err != nil {
			return nil, err
		}
	}
	r.daily.snap(s)
	for range worldDays {
		if err := s.AdvanceDay(r.log); err != nil {
			return nil, err
		}
		r.daily.snap(s)
	}
	return r, nil
}

func spikeB(b *sheets.Book, out string, n int) error {
	if n == 0 {
		n = 50
	}
	variant := os.Getenv("SPIKE_B_VARIANT")
	switch variant {
	case "":
	case "spill-only-when-overrun":
		// Neighbours push threat only once a region is overrun.
		for i := range b.GaugeLines {
			if b.GaugeLines[i].ID == "threat-spills" {
				b.GaugeLines[i].AtLeast = 900
			}
		}
	case "pull-15":
		for i := range b.Gauges {
			b.Gauges[i].PullPercent = 15
		}
	default:
		return fmt.Errorf("unknown SPIKE_B_VARIANT %q", variant)
	}
	main, err := runWorldB(b, 0)
	if err != nil {
		return err
	}
	again, err := runWorldB(b, 0)
	if err != nil {
		return err
	}
	d1, err := world.Digest(main.s, main.log)
	if err != nil {
		return err
	}
	d2, err := world.Digest(again.s, again.log)
	if err != nil {
		return err
	}

	names := newNamer(b)
	var w strings.Builder
	p := func(f string, a ...any) { fmt.Fprintf(&w, f+"\n", a...) }
	p("# Spike B: gauges and factions for %d world days, no players", worldDays)
	p("")
	p("World 0 of %d (the regions within %d tiles of the first starting settlement discovered, and the horizon round them awake: %d regions, %d factions, %d open starting settlement of the %d lattice points there). Throwaway keys `spike-b-<n>`. Weather, creatures and notables run (MM1). Variant: %q.", n, spikeBHorizon, len(main.s.Regions), len(main.s.Factions), main.s.Opened, len(main.w.Settlements()), variant)
	p("")
	p("Replay: two runs of world 0 give state-and-ledger digest `%s` and `%s`: %s.", d1.String()[:16], d2.String()[:16], map[bool]string{true: "identical", false: "DIFFERENT"}[d1 == d2])
	p("")
	p("## The factions after %d days", worldDays)
	p("")
	for _, f := range main.s.Factions {
		var ns []string
		for _, nb := range f.Notables {
			dead := ""
			if nb.Dead {
				dead = ", dead"
			}
			ns = append(ns, fmt.Sprintf("%s %s (%s%s)", nb.Given, nb.Family, nb.Role, dead))
		}
		p("- **%s**, %s, seated at %s. %s.", names.faction(main.s, f.ID), names.archetype(f.Archetype), names.region(f.Seat), strings.Join(ns, ", "))
	}
	p("")
	cut := sheets.IntParam(b.StoryParams, "chronicle-min-weight")
	p("## The chronicle: facts at weight %d and above", cut)
	p("")
	all := main.log.Since(0)
	for _, line := range names.chronicle(main.s, all, cut) {
		p("- %s", line)
	}
	p("")
	caused, chronicled, betrayals, tied, vengeance := 0, 0, 0, 0, 0
	for _, f := range all {
		switch f.Kind {
		case "holding.fell", "faction.fell", "notable.died", "faction.betrayed":
			chronicled++
			if len(f.Causes) > 0 {
				caused++
			}
		}
		switch f.Kind {
		case "faction.betrayed":
			betrayals++
			if len(f.Causes) > 0 {
				tied++
			}
		case "faction.raided", "faction.besieged":
			if len(f.Causes) > 0 {
				vengeance++
			}
		}
	}
	p("Losses (holdings and factions falling, notables dying, betrayals) naming a cause: %d of %d. Betrayals naming the friendship they broke: %d of %d. Raids and sieges answering a betrayal: %d.", caused, chronicled, tied, betrayals, vengeance)
	p("")
	p("## Counts")
	p("")
	kinds := map[string]int{}
	for _, f := range all {
		kinds[f.Kind]++
	}
	p("| Fact kind | World 0 | Weight |")
	p("| --- | --- | --- |")
	weights := fact.NewWeights(b.FactWeights)
	for _, k := range slices.Sorted(maps.Keys(kinds)) {
		p("| %s | %d | %d |", k, kinds[k], weights[k])
	}
	p("")
	p("Facts in %d days: %s; at weight %d and above: %d (%.1f a day).", worldDays, comma(int64(len(all))), cut, countAtLeast(all, cut), float64(countAtLeast(all, cut))/worldDays)
	p("")

	// Many worlds.
	type agg struct {
		chronicle, holdingsFell, factionsFell, settlementsFell, overruns, starving int
		overrunAtEnd, surges, betrayals, movingLate, regions                       int
		threatEnd                                                                  []int64
		moves                                                                      map[string]int
	}
	var ag []agg
	for seed := range n {
		r := main
		if seed > 0 {
			if r, err = runWorldB(b, seed); err != nil {
				return err
			}
		}
		a := agg{moves: map[string]int{}}
		for _, f := range r.log.Since(0) {
			if f.Weight >= cut {
				a.chronicle++
			}
			switch f.Kind {
			case "holding.fell":
				if d, _ := f.Get("settlement"); d.N == 1 {
					a.settlementsFell++
				} else {
					a.holdingsFell++
				}
			case "faction.fell":
				a.factionsFell++
			case "region.overrun":
				a.overruns++
			case "faction.starving":
				a.starving++
			}
			if strings.HasPrefix(f.Kind, "faction.") || f.Kind == "region.surge" {
				a.moves[f.Kind]++
			}
		}
		a.threatEnd = r.daily[len(r.daily)-1]
		a.overrunAtEnd = overrunAtEnd(b, r.s)
		a.surges = a.moves["region.surge"]
		a.betrayals = a.moves["faction.betrayed"]
		a.regions = len(r.s.Regions)
		a.movingLate = r.daily.moving(worldLate, worldMoving)
		ag = append(ag, a)
	}
	p("## Across %d worlds", n)
	p("")
	col := func(get func(agg) int) (int, int, int) {
		var xs []int
		for _, a := range ag {
			xs = append(xs, get(a))
		}
		slices.Sort(xs)
		return xs[0], xs[len(xs)/2], xs[len(xs)-1]
	}
	p("| Per world, %d days | Min | Median | Max |", worldDays)
	p("| --- | --- | --- | --- |")
	for _, row := range []struct {
		name string
		get  func(agg) int
	}{
		{"Chronicle facts (weight 60 and above)", func(a agg) int { return a.chronicle }},
		{"Regions overrun", func(a agg) int { return a.overruns }},
		{"Faction holdings fallen", func(a agg) int { return a.holdingsFell }},
		{"Starting settlements fallen", func(a agg) int { return a.settlementsFell }},
		{"Factions fallen", func(a agg) int { return a.factionsFell }},
		{"Factions starving", func(a agg) int { return a.starving }},
		{fmt.Sprintf("Regions overrun on day %d", worldDays), func(a agg) int { return a.overrunAtEnd }},
		{"Surges", func(a agg) int { return a.surges }},
		{"Betrayals", func(a agg) int { return a.betrayals }},
		{fmt.Sprintf("Regions whose threat still spans %d or more over days %d to %d", worldMoving, worldDays-worldLate, worldDays), func(a agg) int { return a.movingLate }},
		{"Regions", func(a agg) int { return a.regions }},
	} {
		lo, mid, hi := col(row.get)
		p("| %s | %d | %d | %d |", row.name, lo, mid, hi)
	}
	p("")
	moves := map[string]int{}
	for _, a := range ag {
		for k, v := range a.moves {
			moves[k] += v
		}
	}
	p("Faction facts over all worlds: %s.", mapList(moves))
	p("")
	// The World run's target: no collapse, no stasis.
	collapse, stasis, quiet, fell := 0, 0, 0, 0
	for _, a := range ag {
		if a.overrunAtEnd > worldOverrun {
			collapse++
		}
		if a.movingLate*2 < a.regions {
			stasis++
		}
		if a.overruns == 0 && a.holdingsFell == 0 {
			quiet++
		}
		fell += a.settlementsFell
	}
	p("## No collapse, no stasis")
	p("")
	p("| Target, per world | Worlds failing | Holds |")
	p("| --- | --- | --- |")
	p("| At most %d regions overrun on day %d (no collapse) | %d of %d | %s |", worldOverrun, worldDays, collapse, n, yesNo(collapse == 0))
	p("| At least half the regions' threat spans %d or more over days %d to %d (no stasis) | %d of %d | %s |", worldMoving, worldDays-worldLate, worldDays, stasis, n, yesNo(stasis == 0))
	p("| Something is lost in %d days: an overrun or a fallen holding (pressure exists) | %d of %d quiet | %s |", worldDays, quiet, n, yesNo(quiet*10 <= n))
	p("| Every starting settlement stands on day %d | %d fell | %s |", worldDays, fell, yesNo(fell == 0))
	p("")
	p("## Threat over time, world 0")
	p("")
	p("| Day | Min threat | Median threat | Max threat | Regions at 600 or more | Regions at 900 or more |")
	p("| --- | --- | --- | --- | --- | --- |")
	for _, day := range []int{0, 10, 20, 30, 45, 60, 75, 90} {
		t := slices.Clone(main.daily[day])
		slices.Sort(t)
		p("| %d | %d threat | %d threat | %d threat | %d | %d |", day, t[0], t[len(t)/2], t[len(t)-1], atLeast(t, 600), atLeast(t, 900))
	}
	p("")
	if err := os.WriteFile(filepath.Join(out, "spike-b.md"), []byte(w.String()), 0o644); err != nil {
		return err
	}
	var full strings.Builder
	for _, f := range all {
		fmt.Fprintf(&full, "%s\n", names.line(main.s, f))
	}
	return os.WriteFile(filepath.Join(out, "spike-b-ledger.txt"), []byte(full.String()), 0o644)
}

func countAtLeast(fs []fact.Fact, w int64) int {
	c := 0
	for _, f := range fs {
		if f.Weight >= w {
			c++
		}
	}
	return c
}

func atLeast(xs []int64, v int64) int {
	c := 0
	for _, x := range xs {
		if x >= v {
			c++
		}
	}
	return c
}

// namer turns ids into the setting pack's names; region names are drawn
// from the pack's parts by a throwaway key.
type namer struct {
	b     *sheets.Book
	d     *draw.Drawer
	names map[string]string
}

func newNamer(b *sheets.Book) *namer {
	return &namer{b: b, d: draw.NewDrawer(keys.Throwaway("spike-b-names").Generation), names: nameIndex(b)}
}

func (n *namer) part(list string, id int64, purpose string) string {
	var ps []string
	for _, p := range n.b.NameParts {
		if p.List == list {
			ps = append(ps, p.Text)
		}
	}
	return ps[n.d.Below(uint64(len(ps)), draw.Purpose(purpose), draw.Int(id))]
}

func (n *namer) region(r int) string {
	return n.part("region-head", int64(r), "name.region.head") + n.part("region-tail", int64(r), "name.region.tail")
}

func (n *namer) archetype(a string) string { return n.names["factions.archetypes:"+a] }

func (n *namer) faction(s *world.State, f int) string {
	return "the " + s.Factions[f].Head + " " + n.archetype(s.Factions[f].Archetype)
}

// plural: the pack names some archetypes as a plural ("Scav Clans"); a
// faction so named takes plural verbs.
func (n *namer) plural(s *world.State, f int) bool {
	a := s.Factions[f].Archetype
	for _, row := range n.b.Names {
		if row.Ref == "factions.archetypes:"+a {
			return row.Plural != "" && row.Plural == row.Name
		}
	}
	return false
}

// verb picks the singular or plural form for a fact's first subject.
func (n *namer) verb(s *world.State, f fact.Fact, one, many string) string {
	if len(f.Subjects) > 0 && f.Subjects[0].Kind == "faction" {
		id, _ := world.RefIndex(f.Subjects[0])
		if n.plural(s, id) {
			return many
		}
	}
	return one
}

// chronicle renders the facts at or above the cut, folding a faction's
// expansions within one week into one line.
func (n *namer) chronicle(s *world.State, all []fact.Fact, cut int64) []string {
	var out []string
	for i := 0; i < len(all); i++ {
		f := all[i]
		if f.Weight < cut {
			continue
		}
		if f.Kind != "faction.expanded" {
			out = append(out, n.line(s, f))
			continue
		}
		week := f.Tick / sheets.TicksPerDay / daysPerWeek
		places := []string{n.regionOf(f)}
		for j := i + 1; j < len(all); j++ {
			g := all[j]
			if g.Tick/sheets.TicksPerDay/daysPerWeek != week {
				break
			}
			if g.Kind == "faction.expanded" && g.Subjects[0] == f.Subjects[0] {
				if place := n.regionOf(g); !slices.Contains(places, place) {
					places = append(places, place)
				}
				all = append(all[:j:j], all[j+1:]...)
				j--
			}
		}
		if len(places) == 1 {
			out = append(out, n.line(s, f))
			continue
		}
		list := strings.Join(places[:len(places)-1], ", ") + " and " + places[len(places)-1]
		out = append(out, fmt.Sprintf("Week of day %d · %s %s %d regions: %s.", week*daysPerWeek+1, capital(n.ref(s, f.Subjects[0])), n.verb(s, f, "takes", "take"), len(places), list))
	}
	return out
}

// regionOf names a fact's region, or says where it fell outside one: a
// dormant region's facts carry a lattice ref.
func (n *namer) regionOf(f fact.Fact) string {
	if region, ok := world.ParseRegionRef(f.Region); ok {
		return n.region(region)
	}
	if f.Region == "" {
		return "somewhere"
	}
	return "beyond the horizon (" + f.Region + ")"
}

func (n *namer) ref(s *world.State, r fact.Ref) string {
	id, _ := world.RefIndex(r)
	switch r.Kind {
	case "faction":
		return n.faction(s, id)
	case "notable":
		for _, f := range s.Factions {
			for _, nb := range f.Notables {
				if nb.ID == id {
					return nb.Given + " " + nb.Family
				}
			}
		}
		return fmt.Sprintf("notable %d", id)
	}
	return r.String()
}

func (n *namer) line(s *world.State, f fact.Fact) string {
	where := n.regionOf(f)
	day := f.Tick / sheets.TicksPerDay
	who := func(i int) string {
		if i < len(f.Subjects) {
			return n.ref(s, f.Subjects[i])
		}
		return "someone"
	}
	get := func(k string) fact.Datum { d, _ := f.Get(k); return d }
	v := func(one, many string) string { return n.verb(s, f, one, many) }
	because := ""
	if len(f.Causes) > 0 {
		because = fmt.Sprintf(" (after fact #%d)", f.Causes[0])
	}
	var text string
	switch f.Kind {
	case "region.surge":
		text = fmt.Sprintf("Something comes out of the wild into %s (+%d threat).", where, get("threat").N)
	case "region.ambushes":
		text = fmt.Sprintf("%s grows dangerous: ambushes on its edges (%d threat).", where, get("threat").N)
	case "region.raids":
		text = fmt.Sprintf("Raiders come out of %s (%d threat).", where, get("threat").N)
	case "region.overrun":
		text = fmt.Sprintf("%s is overrun (%d threat).", where, get("threat").N)
	case "region.overrun-ended":
		text = fmt.Sprintf("%s is no longer overrun (%d threat).", where, get("threat").N)
	case "region.worked-out":
		text = fmt.Sprintf("%s is worked out; yields halve (%d scarcity).", where, get("scarcity").N)
	case "region.unrest":
		text = fmt.Sprintf("Fire and panic in %s (%d unrest).", where, get("unrest").N)
	case "region.corruption-spreads":
		text = fmt.Sprintf("Corruption spreads from %s (%d corruption).", where, get("corruption").N)
	case "region.prospers":
		text = fmt.Sprintf("%s prospers; caravans come (%d prosperity).", where, get("prosperity").N)
	case "holding.fell":
		what := "the holding at " + where
		if get("settlement").N == 1 {
			what = "the settlement at " + where
		} else if len(f.Subjects) > 0 {
			what = possessive(who(len(f.Subjects)-1)) + " holding at " + where
		}
		text = fmt.Sprintf("%s falls (%s).", capital(what), strings.ReplaceAll(get("cause").S, ".", " "))
	case "faction.fell":
		text = fmt.Sprintf("%s %s no more; %s last holding, %s, is gone.", capital(who(0)), v("is", "are"), v("its", "their"), where)
	case "notable.died":
		text = fmt.Sprintf("%s, %s of %s, dies at %s.", who(0), get("role").S, who(1), where)
	case "notable.promoted":
		text = fmt.Sprintf("%s rises to lead %s.", who(0), who(1))
	case "faction.expanded":
		text = fmt.Sprintf("%s %s %s.", capital(who(0)), v("takes", "take"), where)
	case "faction.fortified":
		text = fmt.Sprintf("%s %s %s (%d defence).", capital(who(0)), v("fortifies", "fortify"), where, get("defence").N)
	case "faction.patrolled":
		text = fmt.Sprintf("%s %s %s.", capital(who(0)), v("patrols", "patrol"), where)
	case "faction.raided":
		text = fmt.Sprintf("%s %s %s at %s and %s off %d goods.", capital(who(0)), v("raids", "raid"), who(1), where, v("carries", "carry"), get("loot").N)
	case "faction.besieged":
		text = fmt.Sprintf("%s %s %s at %s (%d goods taken).", capital(who(0)), v("besieges", "besiege"), who(1), where, get("loot").N)
	case "faction.betrayed":
		text = fmt.Sprintf("%s %s on %s friend %s at %s (%d goods taken).", capital(who(0)), v("turns", "turn"), v("its", "their"), who(1), where, get("loot").N)
	case "faction.traded":
		text = fmt.Sprintf("%s %s with %s (%d goods each).", capital(who(0)), v("trades", "trade"), who(1), get("goods").N)
	case "faction.courted":
		text = fmt.Sprintf("%s %s %s.", capital(who(0)), v("courts", "court"), who(1))
	case "faction.withdrew":
		text = fmt.Sprintf("%s %s %s.", capital(who(0)), v("abandons", "abandon"), where)
	case "faction.culled":
		text = fmt.Sprintf("%s %s out corruption in %s.", capital(who(0)), v("burns", "burn"), where)
	case "faction.migrated":
		text = fmt.Sprintf("%s %s %s seat to %s.", capital(who(0)), v("moves", "move"), v("its", "their"), where)
	case "faction.starving":
		text = fmt.Sprintf("%s %s out of stores.", capital(who(0)), v("runs", "run"))
	default:
		text = f.Kind
	}
	return fmt.Sprintf("Day %d · %s%s `fact #%d, weight %d`", day, text, because, f.ID, f.Weight)
}

func possessive(s string) string {
	if strings.HasSuffix(s, "s") {
		return s + "'"
	}
	return s + "'s"
}

func capital(s string) string {
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}
