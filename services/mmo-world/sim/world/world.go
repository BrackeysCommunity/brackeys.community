// Package world advances a world by world days with nobody playing:
// region gauges drift, cross their lines and pull back to baseline, and
// factions score their moves and take the best (GDD 4.3, 4.5). Everything
// that happens is a fact.
//
// The move-scoring terms are provisional: the GDD gives the formula's
// shape, and the numbers are sheet cells marked provisional.
package world

import (
	"fmt"
	"slices"

	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/sheets"
)

// structural: percentages are hundredths; a world day is 144 ticks.
const (
	percent     = 100
	ticksPerDay = 144
	none        = -1
)

type Region struct {
	ID         int     `json:"id"`
	Gauge      []int64 `json:"gauge"`
	Base       []int64 `json:"base"`
	Active     []bool  `json:"active"` // per gauge line
	Holder     int     `json:"holder"` // faction, or none
	Defence    int64   `json:"defence"`
	Settlement bool    `json:"settlement"` // a starting settlement nobody holds
	Patrolled  bool    `json:"patrolled"`
	RaidFact   fact.ID `json:"raidFact"` // the fact that opened the raid line, while it holds
	// SurgeFact is the surge behind the region's threat, until threat falls
	// back under the ambush line; line facts name it as their cause.
	SurgeFact  fact.ID `json:"surgeFact"`
	Neighbours []int   `json:"neighbours"`
	Tiles      int     `json:"tiles"`
	Tier       int64   `json:"tier"` // from the nearest open starting settlement
}

type Notable struct {
	ID     int    `json:"id"`
	Given  string `json:"given"`
	Family string `json:"family"`
	Role   string `json:"role"`
	Dead   bool   `json:"dead"` // a dead notable stays dead, and stays named
}

type Faction struct {
	ID          int     `json:"id"`
	Archetype   string  `json:"archetype"`
	Head        string  `json:"head"` // name part
	Seat        int     `json:"seat"`
	Stock       int64   `json:"stock"`
	Starving    bool    `json:"starving"`
	Disposition []int64 `json:"disposition"` // toward each faction
	// Grudge is days left, per faction, during which this faction will not
	// trade with or court it and seeks to raid it. Wrong is the betrayal
	// behind each grudge; Ties is the last trade or courtship with each
	// faction, which a betrayal names as the friendship it broke.
	Grudge       []int64   `json:"grudge"`
	Wrong        []fact.ID `json:"wrong"`
	Ties         []fact.ID `json:"ties"`
	LastBetrayed int64     `json:"lastBetrayed"` // the day this faction last betrayed anyone, or 0
	Notables     []Notable `json:"notables"`
	Fallen       bool      `json:"fallen"`
}

type State struct {
	Day         int64     `json:"day"`
	Regions     []Region  `json:"regions"`
	Factions    []Faction `json:"factions"`
	NextNotable int       `json:"nextNotable"`
	// Opened counts the starting settlements open, nearest the origin
	// first; Opening counts those asked for, which open at the next day.
	Opened  int `json:"opened"`
	Opening int `json:"opening"`

	w       *gen.Area
	b       *sheets.Book
	d       *draw.Drawer
	weights map[string]int64
	moves   map[string]*sheets.MoveWeight
}

// Roles a notable can hold, by rank.
var roles = []string{"leader", "captain", "factor"}

func (s *State) p(id string) int64 { return sheets.IntParam(s.b.FactionParams, id) }
func (s *State) wp(id string) int64 {
	return sheets.IntParam(s.b.WorldParams, id)
}

// New seeds region gauges and places factions on the discovered regions
// of a world: the bounded area the horizon holds. The first starting
// settlement is open.
func New(b *sheets.Book, w *gen.Area, key draw.Key) (*State, error) {
	s := &State{w: w, b: b, d: draw.NewDrawer(key), weights: map[string]int64{}, moves: map[string]*sheets.MoveWeight{}, Opened: 1}
	for _, fw := range b.FactWeights {
		s.weights[fw.Kind] = fw.Weight
	}
	for i := range b.MoveWeights {
		mw := &b.MoveWeights[i]
		s.moves[mw.Archetype+"/"+mw.Move] = mw
	}
	lo, hi, corruptionHi := s.wp("baseline-min"), s.wp("baseline-max"), s.wp("corruption-baseline-max")
	settled := map[int]bool{}
	for _, h := range w.Homes {
		if h.N < s.Opened {
			settled[w.TileRegion[w.Index(h.Hex)]] = true
		}
	}
	for _, r := range w.Regions {
		reg := Region{ID: r.ID, Holder: none, Neighbours: r.Neighbours, Tiles: len(r.Tiles), Active: make([]bool, len(b.GaugeLines)), Tier: w.RegionTier(r.ID, s.Opened)}
		for gi, g := range b.Gauges {
			top := hi
			if g.ID == "corruption" {
				top = corruptionHi
			}
			v := lo + int64(s.d.Below(uint64(top-lo+1), "world.baseline", draw.Int(int64(r.ID)), draw.Int(int64(gi))))
			reg.Gauge = append(reg.Gauge, v)
			reg.Base = append(reg.Base, v)
		}
		if settled[r.ID] {
			reg.Settlement = true
			reg.Defence = s.p("holding-defence")
		}
		s.Regions = append(s.Regions, reg)
	}
	return s, s.placeFactions(w)
}

func (s *State) placeFactions(w *gen.Area) error {
	per := s.p("regions-per-faction")
	n := int64(len(s.Regions)) / per
	spacing := s.p("seat-spacing")
	order := s.d.Shuffle(len(s.Regions), "world.seats")
	var seats []int
	centre := func(r int) gen.Hex { return w.Regions[r].Base.Centre }
	for _, r := range order {
		if int64(len(seats)) == n {
			break
		}
		if s.Regions[r].Settlement || !passable(w, r) {
			continue
		}
		ok := true
		for _, x := range seats {
			if gen.Distance(centre(r), centre(x)) < spacing {
				ok = false
			}
		}
		if ok {
			seats = append(seats, r)
		}
	}
	heads := s.parts("faction-head")
	for i, seat := range seats {
		arch := s.b.Archetypes[s.d.Below(uint64(len(s.b.Archetypes)), "world.archetype", draw.Int(int64(i)))].ID
		f := Faction{
			ID: i, Archetype: arch, Seat: seat, Stock: s.p("start-stock"),
			Head:        heads[s.d.Below(uint64(len(heads)), "world.faction-name", draw.Int(int64(i)))],
			Disposition: make([]int64, len(seats)),
			Grudge:      make([]int64, len(seats)),
			Wrong:       make([]fact.ID, len(seats)),
			Ties:        make([]fact.ID, len(seats)),
		}
		s.Regions[seat].Holder, s.Regions[seat].Defence = i, s.p("holding-defence")
		for k := range s.p("notables-per-faction") {
			f.Notables = append(f.Notables, s.notable(roles[min(int(k), len(roles)-1)]))
		}
		s.Factions = append(s.Factions, f)
	}
	if len(seats) == 0 {
		return fmt.Errorf("world: no room for a faction seat")
	}
	return nil
}

func passable(w *gen.Area, r int) bool {
	for _, t := range w.Regions[r].Tiles {
		if w.Passable(t) {
			return true
		}
	}
	return false
}

func (s *State) parts(list string) []string {
	var out []string
	for _, p := range s.b.NameParts {
		if p.List == list {
			out = append(out, p.Text)
		}
	}
	return out
}

func (s *State) notable(role string) Notable {
	id := s.NextNotable
	s.NextNotable++
	given, family := s.parts("notable-given"), s.parts("notable-family")
	n := Notable{
		ID:     id,
		Given:  given[s.d.Below(uint64(len(given)), "notable.given", draw.Int(int64(id)))],
		Family: family[s.d.Below(uint64(len(family)), "notable.family", draw.Int(int64(id)))],
		Role:   role,
	}
	return n
}

// living returns the first living notable, or -1.
func (f *Faction) living() int {
	return slices.IndexFunc(f.Notables, func(n Notable) bool { return !n.Dead })
}

// ---- the day ----

type day struct {
	s   *State
	log fact.Log
	err error
}

func (d *day) emit(kind, region string, subjects []fact.Ref, causes []fact.ID, data ...fact.Datum) fact.ID {
	if d.err != nil {
		return 0
	}
	w, ok := d.s.weights[kind]
	if !ok {
		d.err = fmt.Errorf("world: no weight for fact kind %s", kind)
		return 0
	}
	id, err := d.log.Append(fact.Fact{Tick: d.s.Day * ticksPerDay, Kind: kind, Region: region, Subjects: subjects, Causes: causes, Data: data, Weight: w})
	if err != nil {
		d.err = err
	}
	return id
}

func regionRef(r int) string    { return fmt.Sprintf("r-%d", r) }
func factionRef(f int) fact.Ref { return fact.Ref{Kind: "faction", ID: fmt.Sprintf("f-%d", f)} }
func notableRef(n Notable) fact.Ref {
	return fact.Ref{Kind: "notable", ID: fmt.Sprintf("n-%d", n.ID)}
}

// OpenSettlement asks for the next starting settlement to open. It opens
// at the start of the next world day.
func (s *State) OpenSettlement() { s.Opening++ }

// open opens the settlements asked for. The regions a new settlement
// brings nearer re-tier, and a fact records the land round it growing
// calmer.
func (d *day) open() {
	s := d.s
	for ; s.Opening > 0; s.Opening-- {
		home := s.w.Settlement(s.Opened)
		s.Opened++
		region := ""
		if i := s.w.Index(home.Hex); i >= 0 {
			r := s.w.TileRegion[i]
			region = regionRef(r)
			if s.Regions[r].Holder == none && !s.Regions[r].Settlement {
				s.Regions[r].Settlement = true
				s.Regions[r].Defence = s.p("holding-defence")
			}
		}
		calmer := int64(0)
		for r := range s.Regions {
			if t := s.w.RegionTier(r, s.Opened); t < s.Regions[r].Tier {
				s.Regions[r].Tier = t
				calmer++
			}
		}
		d.emit("land.calmer", region, nil, nil, fact.N("settlement", int64(home.N)), fact.N("regions", calmer))
	}
}

// Advance runs one world day.
func (s *State) Advance(log fact.Log) error {
	s.Day++
	d := &day{s: s, log: log}
	d.open()
	for i := range s.Factions {
		for j, g := range s.Factions[i].Grudge {
			s.Factions[i].Grudge[j] = max(0, g-1)
		}
	}
	d.surge()
	d.gauges()
	for i := range s.Factions {
		if !s.Factions[i].Fallen {
			d.faction(i)
		}
	}
	return d.err
}

func (s *State) gaugeIndex(id string) int {
	return slices.IndexFunc(s.b.Gauges, func(g sheets.Gauge) bool { return g.ID == id })
}

func (d *day) gauges() {
	s := d.s
	threat := s.gaugeIndex("threat")
	// Spill and spread read yesterday's values.
	before := make([][]int64, len(s.Regions))
	for i, r := range s.Regions {
		before[i] = slices.Clone(r.Gauge)
	}
	unrest := s.gaugeIndex("unrest")
	raid, overrun := lineIndex(s.b, "raid"), lineIndex(s.b, "overrun")
	for i := range s.Regions {
		r := &s.Regions[i]
		for gi, g := range s.b.Gauges {
			v := r.Gauge[gi] + g.DailyRise + d.wobble(i, gi, g.Wobble)
			var spill int64
			for _, l := range s.b.GaugeLines {
				if l.Gauge != g.ID || (l.Effect != "neighbour-pressure" && l.Effect != "spread") {
					continue
				}
				for _, n := range r.Neighbours {
					if over := before[n][gi] - l.AtLeast; over > 0 {
						spill += l.Magnitude * over / (g.Max - l.AtLeast)
					}
				}
			}
			v += min(spill, s.wp("spill-cap"))
			if gi == threat && r.Patrolled {
				v += s.wp("patrol-threat")
			}
			if gi == threat && r.Settlement {
				v += s.wp("settlement-watch")
			}
			if gi == threat && r.Active[overrun] {
				v += s.wp("overrun-ebb")
			}
			if gi == unrest && r.Active[raid] {
				v += s.wp("raid-unrest")
			}
			v -= (v - r.Base[gi]) * g.PullPercent / percent
			r.Gauge[gi] = min(max(v, 0), g.Max)
		}
		r.Patrolled = false
		if r.Gauge[threat] < lineAt(s.b, "ambush") {
			r.SurgeFact = 0
		}
	}
	for i := range s.Regions {
		d.lines(i)
	}
}

// wobble is the day's keyed move of one gauge in one region: up to w
// either way.
func (d *day) wobble(region, gauge int, w int64) int64 {
	if w == 0 {
		return 0
	}
	return int64(d.s.d.Below(uint64(w+w+1), "world.wobble", draw.Int(d.s.Day), draw.Int(int64(region)), draw.Int(int64(gauge)))) - w
}

// surge: on some days something comes out of the wild into one region
// (a pack moving, a machine waking), raising its threat and its
// neighbours' at once. The surge is a fact, and the lines it pushes the
// region over name it as their cause.
func (d *day) surge() {
	s := d.s
	if !s.d.Roll(sheets.ParamOf(s.b.WorldParams, "surge-chance"), "world.surge", draw.Int(s.Day)) {
		return
	}
	at := int(s.d.Below(uint64(len(s.Regions)), "world.surge.where", draw.Int(s.Day)))
	lo, hi := s.wp("surge-min"), s.wp("surge-max")
	size := lo + int64(s.d.Below(uint64(hi-lo+1), "world.surge.size", draw.Int(s.Day)))
	threat := s.gaugeIndex("threat")
	g := s.b.Gauges[threat]
	r := &s.Regions[at]
	r.Gauge[threat] = min(g.Max, r.Gauge[threat]+size)
	id := d.emit("region.surge", regionRef(at), nil, nil, fact.N("threat", size))
	r.SurgeFact = id
	share := s.wp("surge-neighbour-share")
	for _, n := range r.Neighbours {
		nr := &s.Regions[n]
		nr.Gauge[threat] = min(g.Max, nr.Gauge[threat]+size*share/percent)
		nr.SurgeFact = id
	}
}

// lines writes a fact when a region crosses a line, and when an overrun
// lifts.
func (d *day) lines(i int) {
	s := d.s
	r := &s.Regions[i]
	for li, l := range s.b.GaugeLines {
		v := r.Gauge[s.gaugeIndex(l.Gauge)]
		clears := l.AtLeast
		if l.ClearsAt > 0 {
			clears = l.ClearsAt
		}
		switch {
		case !r.Active[li] && v >= l.AtLeast:
			r.Active[li] = true
			if l.FactKind != "" {
				var causes []fact.ID
				if r.SurgeFact != 0 && l.Gauge == "threat" {
					causes = append(causes, r.SurgeFact)
				}
				id := d.emit(d.kindOf(l.FactKind), regionRef(i), nil, causes, fact.N(l.Gauge, v), fact.S("line", l.ID))
				if l.Effect == "raid" {
					r.RaidFact = id
				}
			}
		case r.Active[li] && v < clears:
			r.Active[li] = false
			if l.Effect == "overrun" {
				d.emit("region.overrun-ended", regionRef(i), nil, nil, fact.N(l.Gauge, v))
			}
		}
		if r.Active[li] && l.Effect == "raid" && (r.Holder != none || r.Settlement) {
			d.hit(i, s.p("raid-damage"), "region.raids", none, r.RaidFact)
		}
	}
}

func (d *day) kindOf(sheetID string) string {
	for _, fw := range d.s.b.FactWeights {
		if fw.ID == sheetID {
			return fw.Kind
		}
	}
	return sheetID
}

// hit lowers a holding's defence; at zero it falls.
func (d *day) hit(region int, damage int64, why string, by int, cause fact.ID) {
	s := d.s
	r := &s.Regions[region]
	r.Defence = max(0, r.Defence-damage)
	if r.Defence > 0 {
		return
	}
	var subjects []fact.Ref
	if by != none {
		subjects = append(subjects, factionRef(by))
	}
	holder := r.Holder
	if holder != none {
		subjects = append(subjects, factionRef(holder))
	}
	var causes []fact.ID
	if cause != 0 {
		causes = append(causes, cause)
	}
	fell := d.emit("holding.fell", regionRef(region), subjects, causes, fact.S("cause", why), fact.N("settlement", boolN(r.Settlement)))
	r.Holder, r.Settlement = none, false
	if holder == none {
		return
	}
	f := &s.Factions[holder]
	if k := f.living(); k >= 0 && s.d.Roll(sheets.ParamOf(s.b.FactionParams, "notable-death-chance"), "notable.dies", draw.Int(s.Day), draw.Int(int64(region))) {
		f.Notables[k].Dead = true
		dead := f.Notables[k]
		d.emit("notable.died", regionRef(region), []fact.Ref{notableRef(dead), factionRef(holder)}, []fact.ID{fell}, fact.S("role", dead.Role))
	}
	if d.holdings(holder) == 0 {
		f.Fallen = true
		d.emit("faction.fell", regionRef(region), []fact.Ref{factionRef(holder)}, []fact.ID{fell})
	} else if f.Seat == region {
		f.Seat = d.safest(holder)
	}
}

func boolN(b bool) int64 {
	if b {
		return 1
	}
	return 0
}

func (d *day) holdings(f int) int {
	n := 0
	for _, r := range d.s.Regions {
		if r.Holder == f {
			n++
		}
	}
	return n
}

func (d *day) held(f int) []int {
	var out []int
	for i, r := range d.s.Regions {
		if r.Holder == f {
			out = append(out, i)
		}
	}
	return out
}

func (d *day) safest(f int) int {
	threat := d.s.gaugeIndex("threat")
	best := none
	for _, i := range d.held(f) {
		if best == none || d.s.Regions[i].Gauge[threat] < d.s.Regions[best].Gauge[threat] {
			best = i
		}
	}
	return best
}

// ---- faction moves ----

type plan struct {
	move   string
	score  int64
	target int // region or faction, by move
}

func (d *day) faction(i int) {
	s := d.s
	f := &s.Factions[i]
	held := d.held(i)
	threat, scarcity, corruption := s.gaugeIndex("threat"), s.gaugeIndex("scarcity"), s.gaugeIndex("corruption")
	yieldsHalve := lineAt(s.b, "yields-halve")
	for _, r := range held {
		income := s.p("holding-income")
		if s.Regions[r].Gauge[scarcity] >= yieldsHalve {
			income /= halves
		}
		f.Stock += income - s.p("daily-upkeep")
	}
	if f.Stock < 0 {
		f.Stock = 0
		if !f.Starving {
			f.Starving = true
			d.emit("faction.starving", regionRef(f.Seat), []fact.Ref{factionRef(i)}, nil)
		}
	} else if f.Stock >= s.p("need-threshold") {
		f.Starving = false
	}
	if f.living() < 0 {
		n := s.notable(roles[0])
		f.Notables = append(f.Notables, n)
		d.emit("notable.promoted", regionRef(f.Seat), []fact.Ref{notableRef(n), factionRef(i)}, nil, fact.S("role", n.Role))
	}

	ambush := lineAt(s.b, "ambush")
	corruptionLine := lineAt(s.b, "corrupted-nodes")
	hunger := max(0, s.p("need-threshold")-f.Stock)
	danger, worst, weakest, corrupted := int64(0), none, none, none
	for _, r := range held {
		reg := s.Regions[r]
		if over := reg.Gauge[threat] - ambush; over > danger {
			danger, worst = over, r
		}
		if weakest == none || reg.Defence < s.Regions[weakest].Defence {
			weakest = r
		}
		if reg.Gauge[corruption] >= corruptionLine && (corrupted == none || reg.Gauge[corruption] > s.Regions[corrupted].Gauge[corruption]) {
			corrupted = r
		}
	}
	rivalry, rival := int64(0), none
	for j, v := range f.Disposition {
		if j != i && !s.Factions[j].Fallen && -v > rivalry {
			rivalry, rival = -v, j
		}
	}
	free, enemy, partner, ally, foe := none, none, none, none, none
	for _, r := range held {
		for _, n := range s.Regions[r].Neighbours {
			nr := s.Regions[n]
			switch {
			case nr.Holder == none && !nr.Settlement && !nr.Active[lineIndex(s.b, "overrun")]:
				if free == none || nr.Gauge[threat] < s.Regions[free].Gauge[threat] {
					free = n
				}
			case nr.Holder != none && nr.Holder != i:
				if enemy == none || nr.Defence < s.Regions[enemy].Defence {
					enemy = n
				}
				disp := f.Disposition[nr.Holder]
				grudge := f.Grudge[nr.Holder] > 0 || s.Factions[nr.Holder].Grudge[i] > 0
				if disp >= 0 && !grudge {
					partner = nr.Holder
				}
				if disp >= s.p("betray-threshold") && !grudge && s.Day-f.LastBetrayed >= s.p("betray-cooldown") {
					ally = n
				}
			}
		}
	}
	// A grudge reaches past the border: the betrayer's weakest holding
	// anywhere.
	for j, g := range f.Grudge {
		if g == 0 || s.Factions[j].Fallen {
			continue
		}
		for _, r := range d.held(j) {
			if foe == none || s.Regions[r].Defence < s.Regions[foe].Defence {
				foe = r
			}
		}
	}
	overrun := none
	if len(held) > 1 {
		for _, r := range held {
			if s.Regions[r].Active[lineIndex(s.b, "overrun")] {
				overrun = r
			}
		}
	}
	var plans []plan
	add := func(move string, relief, risk int64, target int, ok bool) {
		if !ok {
			return
		}
		mw := s.moves[f.Archetype+"/"+move]
		if mw == nil {
			return
		}
		plans = append(plans, plan{move, mw.Fit + relief*mw.NeedWeight/percent - risk*mw.RiskWeight/percent, target})
	}
	add("expand", 0, riskOf(s, free, threat, ambush), free, free != none && f.Stock >= s.p("expand-cost"))
	add("fortify", danger, 0, weakest, weakest != none)
	add("patrol", danger, 0, worst, worst != none)
	add("raid", hunger, defenceOf(s, enemy), enemy, enemy != none && foe == none)
	add("raid", hunger+s.p("vengeance"), defenceOf(s, foe), foe, foe != none)
	add("besiege", hunger+rivalry, defenceOf(s, enemy), enemy, enemy != none && rival != none && s.Regions[enemy].Holder == rival)
	add("trade", hunger, 0, partner, partner != none)
	add("court", rivalry, 0, rival, rival != none && f.Grudge[rival] == 0 && s.Factions[rival].Grudge[i] == 0)
	add("betray", hunger, 0, ally, ally != none)
	add("withdraw", danger, 0, overrun, overrun != none)
	add("cull", corruptionOver(s, corrupted, corruption, corruptionLine), 0, corrupted, corrupted != none)
	add("migrate", danger+hunger, 0, d.safest(i), danger > 0 && worst == f.Seat && len(held) > 1)
	if len(plans) == 0 {
		return
	}
	best := plans[0]
	ties := []plan{}
	for _, p := range plans {
		if p.score > best.score {
			best = p
		}
	}
	for _, p := range plans {
		if p.score == best.score {
			ties = append(ties, p)
		}
	}
	if len(ties) > 1 {
		best = ties[s.d.Below(uint64(len(ties)), "faction.tie", draw.Int(s.Day), draw.Int(int64(i)))]
	}
	d.act(i, best)
}

// structural: halving.
const halves = 2

func lineAt(b *sheets.Book, effect string) int64 {
	return b.GaugeLines[lineIndex(b, effect)].AtLeast
}

func lineIndex(b *sheets.Book, effect string) int {
	i := slices.IndexFunc(b.GaugeLines, func(l sheets.GaugeLine) bool { return l.Effect == effect })
	if i < 0 {
		panic("world: no gauge line for " + effect)
	}
	return i
}

func riskOf(s *State, r, threat int, ambush int64) int64 {
	if r == none {
		return 0
	}
	return max(0, s.Regions[r].Gauge[threat]-ambush)
}

func defenceOf(s *State, r int) int64 {
	if r == none {
		return 0
	}
	return s.Regions[r].Defence
}

func corruptionOver(s *State, r, corruption int, line int64) int64 {
	if r == none {
		return 0
	}
	return s.Regions[r].Gauge[corruption] - line
}

func (d *day) act(i int, p plan) {
	s := d.s
	f := &s.Factions[i]
	me := []fact.Ref{factionRef(i)}
	switch p.move {
	case "expand":
		f.Stock -= s.p("expand-cost")
		s.Regions[p.target].Holder, s.Regions[p.target].Defence = i, s.p("holding-defence")
		d.emit("faction.expanded", regionRef(p.target), me, nil)
	case "fortify":
		s.Regions[p.target].Defence += s.p("fortify-gain")
		d.emit("faction.fortified", regionRef(p.target), me, nil, fact.N("defence", s.Regions[p.target].Defence))
	case "patrol":
		s.Regions[p.target].Patrolled = true
		d.emit("faction.patrolled", regionRef(p.target), me, nil)
	case "raid", "besiege", "betray":
		victim := s.Regions[p.target].Holder
		loot := min(s.p("raid-loot"), s.Factions[victim].Stock)
		s.Factions[victim].Stock -= loot
		f.Stock += loot
		s.Factions[victim].Disposition[i] -= s.p("court-gain")
		kind := map[string]string{"raid": "faction.raided", "besiege": "faction.besieged", "betray": "faction.betrayed"}[p.move]
		var causes []fact.ID
		switch {
		case p.move == "betray" && f.Ties[victim] != 0:
			causes = append(causes, f.Ties[victim])
		case p.move != "betray" && f.Grudge[victim] > 0 && f.Wrong[victim] != 0:
			causes = append(causes, f.Wrong[victim])
		}
		cause := d.emit(kind, regionRef(p.target), []fact.Ref{factionRef(i), factionRef(victim)}, causes, fact.N("loot", loot))
		if p.move == "betray" {
			v := &s.Factions[victim]
			v.Disposition[i] = -s.p("betray-threshold")
			f.Disposition[victim] = -s.p("betray-threshold")
			v.Grudge[i], v.Wrong[i] = s.p("betray-grudge"), cause
			f.LastBetrayed = s.Day
			for j := range s.Factions {
				if j != i && j != victim {
					s.Factions[j].Disposition[i] -= s.p("betray-infamy")
				}
			}
		}
		d.hit(p.target, s.p("raid-damage"), kind, i, cause)
	case "trade":
		gain := s.p("trade-gain")
		f.Stock += gain
		s.Factions[p.target].Stock += gain
		f.Disposition[p.target] += s.p("court-gain")
		s.Factions[p.target].Disposition[i] += s.p("court-gain")
		id := d.emit("faction.traded", regionRef(f.Seat), []fact.Ref{factionRef(i), factionRef(p.target)}, nil, fact.N("goods", gain))
		f.Ties[p.target], s.Factions[p.target].Ties[i] = id, id
	case "court":
		f.Disposition[p.target] += s.p("court-gain")
		s.Factions[p.target].Disposition[i] += s.p("court-gain")
		id := d.emit("faction.courted", regionRef(f.Seat), []fact.Ref{factionRef(i), factionRef(p.target)}, nil)
		f.Ties[p.target], s.Factions[p.target].Ties[i] = id, id
	case "withdraw":
		s.Regions[p.target].Holder = none
		if f.Seat == p.target {
			f.Seat = d.safest(i)
		}
		d.emit("faction.withdrew", regionRef(p.target), me, nil)
	case "cull":
		b := s.gaugeIndex("corruption")
		s.Regions[p.target].Gauge[b] = max(0, s.Regions[p.target].Gauge[b]-s.p("fortify-gain"))
		d.emit("faction.culled", regionRef(p.target), me, nil)
	case "migrate":
		from := f.Seat
		f.Seat = p.target
		d.emit("faction.migrated", regionRef(p.target), me, nil, fact.S("from", regionRef(from)))
	}
}
