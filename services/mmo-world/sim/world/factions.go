package world

import (
	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/sheets"
)

// Faction is one of the world's factions (GDD 4.5).
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
	// Needs are what the faction is short of, by what it buys: the
	// shortfall spread over its archetype's buys (the buy orders of GDD
	// 10.4).
	Needs []Need `json:"needs"`
}

// Need is goods a faction wants of one tag.
type Need struct {
	Tag   string `json:"tag"`
	Goods int64  `json:"goods"`
}

// grow makes room for one more faction in the per-faction slices.
func (f *Faction) grow() {
	f.Disposition = append(f.Disposition, 0)
	f.Grudge = append(f.Grudge, 0)
	f.Wrong = append(f.Wrong, 0)
	f.Ties = append(f.Ties, 0)
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
	threat := d.s.GaugeIndex("threat")
	best := none
	for _, i := range d.held(f) {
		if best == none || d.s.Regions[i].Gauge[threat] < d.s.Regions[best].Gauge[threat] {
			best = i
		}
	}
	return best
}

// needs spreads a faction's shortfall over what its archetype buys.
func (s *State) needs(f *Faction, shortfall int64) {
	f.Needs = f.Needs[:0]
	var buys []string
	for _, a := range s.b.Archetypes {
		if a.ID == f.Archetype {
			buys = a.Buys
		}
	}
	if shortfall <= 0 || len(buys) == 0 {
		return
	}
	each := shortfall / int64(len(buys))
	for k, t := range buys {
		g := each
		if k == 0 {
			g += shortfall - each*int64(len(buys))
		}
		if g > 0 {
			f.Needs = append(f.Needs, Need{Tag: t, Goods: g})
		}
	}
}

type plan struct {
	move   string
	score  int64
	target int // region or faction, by move
}

// structural: halving.
const halves = 2

func (d *day) faction(i int) {
	s := d.s
	f := &s.Factions[i]
	held := d.held(i)
	threat, scarcity, corruption := s.GaugeIndex("threat"), s.GaugeIndex("scarcity"), s.GaugeIndex("corruption")
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
			f.loyalty(s.p("loyalty-starving"))
			d.emit("faction.starving", RegionRef(f.Seat), []fact.Ref{factionRef(i)}, nil)
		}
	} else if f.Stock >= s.p("need-threshold") {
		f.Starving = false
	}
	s.appoint(d, i, false)
	d.defect(i)
	f = &s.Factions[i]

	ambush := lineAt(s.b, "ambush")
	corruptionLine := lineAt(s.b, "corrupted-nodes")
	hunger := max(0, s.p("need-threshold")-f.Stock)
	s.needs(f, hunger)
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
	overrunLine := lineIndex(s.b, "overrun")
	free, enemy, partner, ally, foe := none, none, none, none, none
	for _, r := range held {
		for _, n := range s.Regions[r].Neighbours {
			nr := s.Regions[n]
			switch {
			case nr.Holder == none && !nr.Settlement && !nr.Active[overrunLine]:
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
			if s.Regions[r].Active[overrunLine] {
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
		plans = append(plans, plan{move, mw.Fit + fixed.PercentOf(relief, mw.NeedWeight) - fixed.PercentOf(risk, mw.RiskWeight), target})
	}
	add("expand", 0, riskOf(s, free, threat, ambush), free, free != none && f.Stock >= s.p("expand-cost"))
	// Lost defence is need too: a holding under siege wants walls, and a
	// faction's last holding wants them more.
	peril := int64(0)
	if weakest != none {
		want := s.p("holding-defence")
		if len(held) == 1 {
			want = fixed.PercentOf(want, s.p("last-holding-peril"))
		}
		peril = max(0, want-s.Regions[weakest].Defence)
	}
	add("fortify", danger+peril, 0, weakest, weakest != none)
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
	for _, p := range plans {
		if p.score > best.score {
			best = p
		}
	}
	var ties []plan
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

func lineAt(b *sheets.Book, effect string) int64 {
	return b.GaugeLines[lineIndex(b, effect)].AtLeast
}

func lineIndex(b *sheets.Book, effect string) int {
	for i, l := range b.GaugeLines {
		if l.Effect == effect {
			return i
		}
	}
	panic("world: no gauge line for " + effect)
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
		f.loyalty(s.p("loyalty-holding"))
		d.emit("faction.expanded", RegionRef(p.target), me, nil)
	case "fortify":
		s.Regions[p.target].Defence += s.p("fortify-gain")
		d.emit("faction.fortified", RegionRef(p.target), me, nil, fact.N("defence", s.Regions[p.target].Defence))
	case "patrol":
		s.Regions[p.target].Patrolled = true
		d.emit("faction.patrolled", RegionRef(p.target), me, nil)
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
		cause := d.emit(kind, RegionRef(p.target), []fact.Ref{factionRef(i), factionRef(victim)}, causes, fact.N("loot", loot))
		if p.move == "betray" {
			v := &s.Factions[victim]
			v.Disposition[i] = -s.p("betray-threshold")
			f.Disposition[victim] = -s.p("betray-threshold")
			v.Grudge[i], v.Wrong[i] = s.p("betray-grudge"), cause
			f.LastBetrayed = s.Day
			f.loyalty(s.p("loyalty-betrayal"))
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
		id := d.emit("faction.traded", RegionRef(f.Seat), []fact.Ref{factionRef(i), factionRef(p.target)}, nil, fact.N("goods", gain))
		f.Ties[p.target], s.Factions[p.target].Ties[i] = id, id
	case "court":
		f.Disposition[p.target] += s.p("court-gain")
		s.Factions[p.target].Disposition[i] += s.p("court-gain")
		id := d.emit("faction.courted", RegionRef(f.Seat), []fact.Ref{factionRef(i), factionRef(p.target)}, nil)
		f.Ties[p.target], s.Factions[p.target].Ties[i] = id, id
	case "withdraw":
		s.Regions[p.target].Holder = none
		if f.Seat == p.target {
			f.Seat = d.safest(i)
		}
		d.emit("faction.withdrew", RegionRef(p.target), me, nil)
	case "cull":
		b := s.GaugeIndex("corruption")
		s.addGauge(p.target, b, -s.p("fortify-gain"))
		d.emit("faction.culled", RegionRef(p.target), me, nil)
	case "migrate":
		from := f.Seat
		f.Seat = p.target
		d.emit("faction.migrated", RegionRef(p.target), me, nil, fact.S("from", RegionRef(from)))
	}
}

// hit lowers a holding's defence; at zero it falls. A faction's last
// holding takes a share of the damage.
func (d *day) hit(region int, damage int64, why string, by int, cause fact.ID) {
	s := d.s
	r := &s.Regions[region]
	if r.Holder != none && d.holdings(r.Holder) == 1 {
		damage = fixed.PercentOf(damage, s.p("last-holding-damage"))
	}
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
	fell := d.emit("holding.fell", RegionRef(region), subjects, causes, fact.S("cause", why), fact.B("settlement", r.Settlement))
	r.Holder, r.Settlement = none, false
	if holder == none {
		return
	}
	f := &s.Factions[holder]
	if k := f.living(); k >= 0 && s.d.Roll(sheets.ParamOf(s.b.FactionParams, "notable-death-chance"), "notable.dies", draw.Int(s.Day), draw.Int(int64(region))) {
		f.Notables[k].Dead = true
		dead := f.Notables[k]
		d.emit("notable.died", RegionRef(region), []fact.Ref{notableRef(dead), factionRef(holder)}, []fact.ID{fell}, fact.S("role", dead.Role))
	}
	if d.holdings(holder) == 0 {
		f.Fallen = true
		d.emit("faction.fell", RegionRef(region), []fact.Ref{factionRef(holder)}, []fact.ID{fell})
	} else if f.Seat == region {
		f.Seat = d.safest(holder)
	}
}
