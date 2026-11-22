package world

import (
	"fmt"
	"slices"
	"strconv"
	"strings"

	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/hex"
)

// The story's world effects (GDD 12.2): arcs never write regions or
// factions themselves, they queue these. Each writes its own fact. Its
// fields are checked when it is queued; a target gone by the tick it
// applies in (a holding fallen, a notable dead) leaves the world as it was
// and writes nothing, so a tick never fails on what changed since.
const (
	ActFortify     = "story-fortify" // Units of defence (may be negative) on the holding at Hex
	ActFallHolding = "story-fall"    // the holding at Hex falls: holding.fell, Holder none
	ActGauge       = "story-gauge"   // Units on gauge Tag of the region at Hex
	ActSplit       = "story-split"   // the faction at Hex splits; Species names the notable leading the new one
	ActAppoint     = "story-appoint" // Species becomes the leading notable of the faction at Hex
	ActLoyalty     = "story-loyalty" // Units of loyalty on notable Species
	ActDefect      = "story-defect"  // notable Species defects to the faction at Hex
	ActPeace       = "story-peace"   // grudges between the faction at Hex and Material's (its ref) clear
	ActGrudge      = "story-grudge"  // Units days of grudge from the faction at Hex toward Material's
	ActSurge       = "story-surge"   // Units of threat surge at the region of Hex, with surge-neighbour-share
	ActSeam        = "story-seam"    // Units of stock on the node of Material at Hex
)

var storyKinds = []string{ActFortify, ActFallHolding, ActGauge, ActSplit, ActAppoint, ActLoyalty, ActDefect, ActPeace, ActGrudge, ActSurge, ActSeam}

// IsStory reports whether an action kind is one of the story's.
func IsStory(kind string) bool { return slices.Contains(storyKinds, kind) }

// The facts the story's actions write beside the world's own kinds.
const (
	FactGaugeMoved   = "region.gauge-moved"
	FactLoyaltyMoved = "notable.loyalty-moved"
	FactSplit        = "faction.split"
	FactPeace        = "faction.peace"
	FactGrudge       = "faction.grudge"
	FactSeam         = "node.seam"
)

// structural: what a story fall names as its cause on holding.fell.
const storyCause = "story"

func init() {
	for _, k := range storyKinds {
		actions[k] = struct {
			check func(*State, Action) error
			apply func(*State, fact.Log, Action) error
		}{checkStory, func(s *State, log fact.Log, a Action) error {
			d := &day{s: s, log: log}
			d.story(a)
			return d.err
		}}
	}
}

func checkStory(s *State, a Action) error {
	bad := func(why string) error { return fmt.Errorf("world: %s %s", a.Kind, why) }
	switch a.Kind {
	case ActFortify, ActLoyalty:
		if a.Units == 0 {
			return bad("of nothing")
		}
	case ActGauge:
		if _, ok := s.GaugeOf(a.Tag); !ok || a.Units == 0 {
			return bad(fmt.Sprintf("of %d on gauge %q", a.Units, a.Tag))
		}
	case ActSurge, ActSeam, ActGrudge:
		if a.Units <= 0 {
			return bad(fmt.Sprintf("of %d", a.Units))
		}
	}
	switch a.Kind {
	case ActSplit, ActAppoint, ActLoyalty, ActDefect:
		if _, ok := notableIndex(a.Species); !ok {
			return bad(fmt.Sprintf("names no notable in %q", a.Species))
		}
	case ActPeace, ActGrudge:
		if _, ok := FactionIndex(a.Material); !ok {
			return bad(fmt.Sprintf("names no faction in %q", a.Material))
		}
	case ActSeam:
		if a.Material == "" {
			return bad("names no material")
		}
	}
	return nil
}

// FactionIndex reads a faction's ref back: "faction:f-3", "f-3" or
// "faction:3".
func FactionIndex(ref string) (int, bool) {
	rest := strings.TrimPrefix(ref, "faction:")
	if i, ok := RefIndex(fact.Ref{ID: rest}); ok && strings.HasPrefix(rest, "f-") {
		return i, true
	}
	i, err := strconv.Atoi(rest)
	return i, err == nil && rest != ref && i >= 0
}

// notableIndex reads a notable's ref back: "notable:n-3" or "n-3".
func notableIndex(ref string) (int, bool) {
	rest := strings.TrimPrefix(ref, "notable:")
	if !strings.HasPrefix(rest, "n-") {
		return 0, false
	}
	return RefIndex(fact.Ref{ID: rest})
}

// factionAt is the living faction holding the region at h, or seated
// there, or none.
func (s *State) factionAt(h hex.Hex) int {
	r := s.RegionAt(h)
	if r < 0 {
		return none
	}
	if f := s.Regions[r].Holder; f != none && !s.Factions[f].Fallen {
		return f
	}
	for i, f := range s.Factions {
		if !f.Fallen && f.Seat == r {
			return i
		}
	}
	return none
}

// livingNotable finds a living notable by its ref: its faction and its
// index there.
func (s *State) livingNotable(ref string) (fi, k int, ok bool) {
	id, ok := notableIndex(ref)
	if !ok {
		return none, none, false
	}
	for fi, f := range s.Factions {
		if f.Fallen {
			continue
		}
		for k, n := range f.Notables {
			if n.ID == id && !n.Dead {
				return fi, k, true
			}
		}
	}
	return none, none, false
}

// story applies one story action.
func (d *day) story(a Action) {
	s := d.s
	var causes []fact.ID
	if a.Cause > 0 && d.log != nil && int(a.Cause) <= d.log.Len() {
		causes = []fact.ID{a.Cause}
	}
	switch a.Kind {
	case ActFortify:
		d.storyFortify(a, causes)
	case ActFallHolding:
		d.storyFall(a, causes)
	case ActGauge:
		r := s.RegionAt(a.Hex)
		if r < 0 {
			return
		}
		gi := s.GaugeIndex(a.Tag)
		s.addGauge(r, gi, a.Units)
		d.emit(FactGaugeMoved, RegionRef(r), nil, causes, fact.S("gauge", a.Tag), fact.N("by", a.Units), fact.N("value", s.Regions[r].Gauge[gi]))
	case ActSplit:
		d.storySplit(a, causes)
	case ActAppoint:
		fi := s.factionAt(a.Hex)
		nf, k, ok := s.livingNotable(a.Species)
		if !ok || nf != fi || s.Factions[fi].Notables[k].Role == RoleLeader {
			return
		}
		f := &s.Factions[fi]
		for j := range f.Notables {
			if !f.Notables[j].Dead && f.Notables[j].Role == RoleLeader {
				f.Notables[j].Role = RoleCaptain
			}
		}
		f.Notables[k].Role = RoleLeader
		d.emit("notable.promoted", RegionRef(f.Seat), []fact.Ref{notableRef(f.Notables[k]), factionRef(fi)}, causes, fact.S("role", RoleLeader))
	case ActLoyalty:
		fi, k, ok := s.livingNotable(a.Species)
		if !ok {
			return
		}
		n := &s.Factions[fi].Notables[k]
		n.Loyalty += a.Units
		d.emit(FactLoyaltyMoved, RegionRef(s.Factions[fi].Seat), []fact.Ref{notableRef(*n), factionRef(fi)}, causes, fact.N("by", a.Units), fact.N("loyalty", n.Loyalty))
	case ActDefect:
		d.storyDefect(a, causes)
	case ActPeace:
		fi, j := s.factionAt(a.Hex), s.otherFaction(a.Material)
		if fi == none || j == none || fi == j {
			return
		}
		was := max(s.Factions[fi].Grudge[j], s.Factions[j].Grudge[fi])
		s.Factions[fi].Grudge[j], s.Factions[j].Grudge[fi] = 0, 0
		d.emit(FactPeace, RegionRef(s.Factions[fi].Seat), []fact.Ref{factionRef(fi), factionRef(j)}, causes, fact.N("grudge", was))
	case ActGrudge:
		fi, j := s.factionAt(a.Hex), s.otherFaction(a.Material)
		if fi == none || j == none || fi == j {
			return
		}
		f := &s.Factions[fi]
		fresh := f.Grudge[j] == 0
		f.Grudge[j] += a.Units
		id := d.emit(FactGrudge, RegionRef(f.Seat), []fact.Ref{factionRef(fi), factionRef(j)}, causes, fact.N("days", f.Grudge[j]))
		// The wrong behind a grudge the story began is the story's.
		if fresh || f.Wrong[j] == 0 {
			f.Wrong[j] = id
		}
	case ActSurge:
		r := s.RegionAt(a.Hex)
		if r < 0 {
			return
		}
		threat := s.GaugeIndex("threat")
		s.addGauge(r, threat, a.Units)
		id := d.emit("region.surge", RegionRef(r), nil, causes, fact.N("threat", a.Units))
		s.Regions[r].SurgeFact = id
		share := s.wp("surge-neighbour-share")
		for _, n := range s.Regions[r].Neighbours {
			s.addGauge(n, threat, fixed.PercentFloor(a.Units, share))
			s.Regions[n].SurgeFact = id
		}
	case ActSeam:
		// A seam is stock past the node's own: gathering owed back, which
		// no day's forgetting wears down.
		t := s.touch(a.Hex)
		if t.Gathered == nil {
			t.Gathered = map[string]int64{}
		}
		t.Gathered[a.Material] -= a.Units
		if t.Gathered[a.Material] == 0 {
			delete(t.Gathered, a.Material)
		}
		d.emit(FactSeam, s.refAt(a.Hex), nil, causes, append([]fact.Datum{fact.S("material", a.Material), fact.N("stock", a.Units)}, fact.At(a.Hex)...)...)
	}
}

// otherFaction is the living faction a ref names, or none.
func (s *State) otherFaction(ref string) int {
	j, ok := FactionIndex(ref)
	if !ok || j >= len(s.Factions) || s.Factions[j].Fallen {
		return none
	}
	return j
}

// storyFortify moves a holding's defence, never under 0 and never felling
// it; a faction's last holding takes a share of a cut, as of any damage.
func (d *day) storyFortify(a Action, causes []fact.ID) {
	s := d.s
	r := s.RegionAt(a.Hex)
	if r < 0 || s.Regions[r].Holder == none {
		return
	}
	holder := s.Regions[r].Holder
	by := a.Units
	if by < 0 && d.holdings(holder) == 1 {
		by = -fixed.PercentOf(-by, s.p("last-holding-damage"))
	}
	s.Regions[r].Defence = max(0, s.Regions[r].Defence+by)
	d.emit("faction.fortified", RegionRef(r), []fact.Ref{factionRef(holder)}, causes, fact.N("defence", s.Regions[r].Defence), fact.N("by", by))
}

// storyFall takes a holding from its faction. A faction's last holding
// never falls to the story: the director cuts its defence instead.
func (d *day) storyFall(a Action, causes []fact.ID) {
	s := d.s
	r := s.RegionAt(a.Hex)
	if r < 0 || s.Regions[r].Holder == none {
		return
	}
	holder := s.Regions[r].Holder
	if d.holdings(holder) <= 1 {
		return
	}
	d.emit("holding.fell", RegionRef(r), []fact.Ref{factionRef(holder)}, causes, fact.S("cause", storyCause), fact.B("settlement", false))
	reg := &s.Regions[r]
	reg.Holder, reg.Settlement, reg.Defence = none, false, 0
	if s.Factions[holder].Seat == r {
		s.Factions[holder].Seat = d.safest(holder)
	}
}

// storyDefect moves a living notable to the faction at Hex, taking one
// holding's defence with it, as a notable's own defection does.
func (d *day) storyDefect(a Action, causes []fact.ID) {
	s := d.s
	fi, k, ok := s.livingNotable(a.Species)
	to := s.factionAt(a.Hex)
	if !ok || to == none || to == fi {
		return
	}
	f := &s.Factions[fi]
	n := f.Notables[k]
	f.Notables = slices.Delete(f.Notables, k, k+1)
	n.Role, n.Loyalty = RoleCaptain, s.p("loyalty-min")
	s.Factions[to].Notables = append(s.Factions[to].Notables, n)
	taken := int64(0)
	if r := d.strongest(fi); r != none {
		taken = min(s.Regions[r].Defence, s.p("holding-defence"))
		s.Regions[r].Defence -= taken
		s.Regions[s.Factions[to].Seat].Defence += taken
	}
	d.emit("notable.defected", RegionRef(s.Factions[fi].Seat), []fact.Ref{notableRef(n), factionRef(fi), factionRef(to)}, causes, fact.N("defence", taken))
}

// storySplit breaks a faction in two (GDD 4.5, 12.9): half its holdings,
// drawn, go to a new faction of its archetype led by the named notable
// and named for that notable's family, seated by the seat rules where it
// can be. The parent keeps its seat.
func (d *day) storySplit(a Action, causes []fact.ID) {
	s := d.s
	pi := s.factionAt(a.Hex)
	if pi == none {
		return
	}
	held := d.held(pi)
	k := len(held) / halves
	if k == 0 {
		return
	}
	var pool []int
	for _, r := range held {
		if r != s.Factions[pi].Seat {
			pool = append(pool, r)
		}
	}
	order := s.d.Shuffle(len(pool), "split.holdings", draw.Int(int64(pi)), draw.Int(s.Day))
	taken := make([]int, 0, k)
	for _, o := range order[:k] {
		taken = append(taken, pool[o])
	}
	seat := s.splitSeat(pi, taken)
	if seat == none {
		return
	}
	parent := s.Factions[pi]
	head := parent.Head
	nf, nk, led := s.livingNotable(a.Species)
	led = led && nf == pi
	if led {
		head = parent.Notables[nk].Family
	}
	share := parent.Stock * int64(k) / int64(len(held))
	ni := len(s.Factions)
	s.Factions[pi].Stock -= share
	s.Factions = append(s.Factions, Faction{ID: ni, Archetype: parent.Archetype, Head: head, Seat: seat, Stock: share})
	if s.arriving != nil {
		s.arriving.factions[ni] = true
	}
	for j := range s.Factions {
		for len(s.Factions[j].Disposition) < len(s.Factions) {
			s.Factions[j].grow()
		}
	}
	// The new faction sees the others as its parent did, and they it.
	for j := range s.Factions {
		if j != ni && j != pi {
			s.Factions[ni].Disposition[j] = s.Factions[pi].Disposition[j]
			s.Factions[j].Disposition[ni] = s.Factions[j].Disposition[pi]
		}
	}
	for _, r := range taken {
		s.Regions[r].Holder = ni
	}
	subjects := []fact.Ref{factionRef(pi), factionRef(ni)}
	if led {
		n := s.Factions[pi].Notables[nk]
		s.Factions[pi].Notables = slices.Delete(s.Factions[pi].Notables, nk, nk+1)
		n.Role = RoleLeader
		s.Factions[ni].Notables = append(s.Factions[ni].Notables, n)
		subjects = append(subjects, notableRef(n))
	}
	s.appoint(d, ni, true)
	d.emit(FactSplit, RegionRef(seat), subjects, causes, fact.N("holdings", int64(k)), fact.S("from", RegionRef(parent.Seat)))
}

// splitSeat is where a split's new faction sits: the first drawn holding
// the seat rules allow, else the passable one furthest from the parent's
// seat; none when no holding taken is passable.
func (s *State) splitSeat(pi int, taken []int) int {
	spacing := s.p("seat-spacing")
	far, farthest := none, int64(0)
	for _, r := range taken {
		if !passable(s.g, s.Regions[r].Lattice) {
			continue
		}
		spaced := true
		for _, f := range s.Factions {
			if !f.Fallen && hex.Distance(s.centre(r), s.centre(f.Seat)) < spacing {
				spaced = false
			}
		}
		if spaced {
			return r
		}
		if d := hex.Distance(s.centre(r), s.centre(s.Factions[pi].Seat)); far == none || d > farthest {
			far, farthest = r, d
		}
	}
	return far
}
