package world

import (
	"slices"

	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/sheets"
)

// Notable is a named person of a faction (GDD 4.6). A dead one stays
// dead, and stays named.
type Notable struct {
	ID      int      `json:"id"`
	Given   string   `json:"given"`
	Family  string   `json:"family"`
	Role    string   `json:"role"`
	Traits  []string `json:"traits"`
	Loyalty int64    `json:"loyalty"`
	Dead    bool     `json:"dead"`
}

// Roles, by rank.
const (
	RoleLeader  = "leader"
	RoleCaptain = "captain"
	RoleFactor  = "factor"
)

// notable generates a notable on demand for a faction seated at seat:
// names, traits and loyalty are keyed draws on its id, and on the seat's
// digest once the world draws content from history (GDD 4.17).
func (s *State) notable(role string, seat int) Notable {
	id := s.NextNotable
	s.NextNotable++
	if s.Drawn() {
		return s.drawnNotable(id, role, seat)
	}
	who := draw.Int(int64(id))
	given, family := s.parts("notable-given"), s.parts("notable-family")
	lo, hi := s.p("loyalty-min"), s.p("loyalty-max")
	n := Notable{
		ID:      id,
		Given:   given[s.d.Below(uint64(len(given)), "notable.given", who)],
		Family:  family[s.d.Below(uint64(len(family)), "notable.family", who)],
		Role:    role,
		Loyalty: s.d.Between(lo, hi, "notable.loyalty", who),
	}
	order := s.d.Shuffle(len(s.b.NPCTraits), "notable.traits", who)
	for _, k := range order {
		if int64(len(n.Traits)) == s.p("notable-traits") {
			break
		}
		t := s.b.NPCTraits[k]
		if slices.Contains(n.Traits, t.Opposes) {
			continue
		}
		n.Traits = append(n.Traits, t.ID)
	}
	return n
}

// drawnNotable draws a notable under the content labels, from the digest
// at its seat's centre now.
func (s *State) drawnNotable(id int, role string, seat int) Notable {
	dg := s.DigestAt(s.centre(seat), s.Tick)
	// A notable is not a tile's content, so no pin reaches it.
	dg.Pins = nil
	who := []draw.Part{draw.Int(int64(id)), draw.Str(dg.Key())}
	given, family := s.parts("notable-given"), s.parts("notable-family")
	lo, hi := s.p("loyalty-min"), s.p("loyalty-max")
	n := Notable{
		ID:      id,
		Given:   given[s.d.Below(uint64(len(given)), "content.notable.given", who...)],
		Family:  family[s.d.Below(uint64(len(family)), "content.notable.family", who...)],
		Role:    role,
		Loyalty: s.d.Between(lo, hi, "content.notable.loyalty", who...),
	}
	ids := make([]string, len(s.b.NPCTraits))
	base := make([]int64, len(s.b.NPCTraits))
	for i, t := range s.b.NPCTraits {
		ids[i], base[i] = t.ID, sheets.IntParam(s.b.MapParams, "content-trait-weight")
	}
	weights := s.g.Weights(gen.TableTrait, ids, base, dg, "")
	st := s.d.Stream("content.notable.traits", who...)
	n.Traits = sheets.PickTraits(s.b.NPCTraits, weights, s.p("notable-traits"), st.Pick)
	return n
}

func (f *Faction) living() int {
	return slices.IndexFunc(f.Notables, func(n Notable) bool { return !n.Dead })
}

func (f *Faction) count(role string) int {
	n := 0
	for _, x := range f.Notables {
		if !x.Dead && x.Role == role {
			n++
		}
	}
	return n
}

// appoint fills a faction's posts: a leader, a factor, and a captain plus
// one per captain-per-holdings holdings. The highest-loyalty captain
// takes an empty leadership, and a factor an empty captaincy; anything
// still empty is filled from the ranks. Founding fills posts quietly.
func (s *State) appoint(d *day, fi int, founding bool) {
	f := &s.Factions[fi]
	holdings := 0
	if d != nil {
		holdings = d.holdings(fi)
	}
	captains := 1 + holdings/int(s.p("captain-per-holdings"))
	say := func(kind string, n Notable) {
		if !founding && d != nil {
			d.emit(kind, RegionRef(f.Seat), []fact.Ref{notableRef(n), factionRef(fi)}, nil, fact.S("role", n.Role))
		}
	}
	if f.count(RoleLeader) == 0 {
		best := -1
		for k, n := range f.Notables {
			if !n.Dead && n.Role == RoleCaptain && (best < 0 || n.Loyalty > f.Notables[best].Loyalty) {
				best = k
			}
		}
		if best >= 0 {
			f.Notables[best].Role = RoleLeader
			say("notable.promoted", f.Notables[best])
		} else {
			n := s.notable(RoleLeader, f.Seat)
			f.Notables = append(f.Notables, n)
			say("notable.promoted", n)
		}
	}
	for f.count(RoleCaptain) < captains {
		k := slices.IndexFunc(f.Notables, func(n Notable) bool { return !n.Dead && n.Role == RoleFactor })
		if k >= 0 && f.count(RoleFactor) > 0 && !founding {
			f.Notables[k].Role = RoleCaptain
			say("notable.promoted", f.Notables[k])
			continue
		}
		n := s.notable(RoleCaptain, f.Seat)
		f.Notables = append(f.Notables, n)
		say("notable.appointed", n)
	}
	if f.count(RoleFactor) == 0 {
		n := s.notable(RoleFactor, f.Seat)
		f.Notables = append(f.Notables, n)
		say("notable.appointed", n)
	}
}

// loyalty moves every living notable of a faction.
func (f *Faction) loyalty(by int64) {
	for k := range f.Notables {
		if !f.Notables[k].Dead {
			f.Notables[k].Loyalty += by
		}
	}
}

// defect: a notable under the line may leave, each world day, for the
// faction theirs holds the best disposition toward, taking one holding's
// defence with them.
func (d *day) defect(fi int) {
	s := d.s
	f := &s.Factions[fi]
	for k := 0; k < len(f.Notables); k++ {
		n := f.Notables[k]
		if n.Dead || n.Loyalty >= s.p("defect-below") {
			continue
		}
		if !s.d.Roll(sheets.ParamOf(s.b.FactionParams, "defect-chance"), "notable.defects", draw.Int(s.Day), draw.Int(int64(n.ID))) {
			continue
		}
		to, best := none, int64(0)
		for j, v := range f.Disposition {
			if j != fi && !s.Factions[j].Fallen && (to == none || v > best) {
				to, best = j, v
			}
		}
		if to == none {
			continue
		}
		f.Notables = slices.Delete(f.Notables, k, k+1)
		k--
		n.Role, n.Loyalty = RoleCaptain, s.p("loyalty-min")
		s.Factions[to].Notables = append(s.Factions[to].Notables, n)
		taken := int64(0)
		if r := d.strongest(fi); r != none {
			taken = min(s.Regions[r].Defence, s.p("holding-defence"))
			s.Regions[r].Defence -= taken
			s.Regions[s.Factions[to].Seat].Defence += taken
		}
		d.emit("notable.defected", RegionRef(f.Seat), []fact.Ref{notableRef(n), factionRef(fi), factionRef(to)}, nil, fact.N("defence", taken))
		f = &s.Factions[fi]
	}
}

func (d *day) strongest(fi int) int {
	best := none
	for _, r := range d.held(fi) {
		if best == none || d.s.Regions[r].Defence > d.s.Regions[best].Defence {
			best = r
		}
	}
	return best
}
