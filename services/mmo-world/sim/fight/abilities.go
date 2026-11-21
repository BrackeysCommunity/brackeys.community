package fight

import (
	"slices"

	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tags"
)

// The Warden's and the Kindler's abilities that change a beat (GDD 5.9).
// Each reads its measure from the holder's own tags, so a member without
// the ability, or alone where it needs a party, fights unchanged.

// failures is every failure that has landed in the encounter.
func (e *Encounter) failures() int64 {
	var n int64
	for _, c := range e.Failures {
		n += c.N
	}
	return n
}

// up reports whether a member is still in the encounter's beats.
func (e *Encounter) up(m *Member) bool {
	return !slices.Contains(e.Down, m.Ch.ID) && !slices.Contains(e.Gone, m.Ch.ID)
}

// onJoined reports whether the beat is the joined creature's own.
func (e *Encounter) onJoined() bool {
	j := e.Joined
	return j != nil && e.At >= j.From && e.At <= j.Until
}

// foe is the states on the creature the beat faces.
func (e *Encounter) foe() []State {
	if e.onJoined() {
		return e.Joined.States
	}
	var out []State
	for _, st := range e.States {
		if st.On == OnCreature {
			out = append(out, st)
		}
	}
	return out
}

// sees adds to a beat's situation what the encounter's states and the
// party's abilities make of it: the states on the creature it faces,
// the rally, and how often each chained state's rules fire.
func (r *Rules) sees(e *Encounter, who string, s *Situation) {
	foe := e.foe()
	for _, st := range foe {
		s.Other = append(s.Other, st.Tag)
	}
	s.Rally = e.Rally
	chained := func(st State) {
		if st.Repeats <= 0 {
			return
		}
		if s.Repeats == nil {
			s.Repeats = map[tags.Tag]int64{}
		}
		s.Repeats[st.Tag] = max(s.Repeats[st.Tag], st.Repeats)
	}
	for _, st := range foe {
		chained(st)
	}
	for _, st := range e.States {
		if st.On == OnPlace || st.On == OnSelf && st.Who == who {
			chained(st)
		}
	}
}

// repeated fires again, as often as Chain says, every band and score a
// rule gave by matching a chained state.
func repeated(effects []tags.Effect, rw tags.Why, s Situation) []tags.Effect {
	if len(s.Repeats) == 0 {
		return effects
	}
	out := effects
	for _, ef := range effects {
		switch ef.(type) {
		case tags.Band, tags.Score:
		case tags.AddTag, tags.RemoveTag, tags.Scale, tags.Add, tags.Join, tags.End:
			continue
		}
		var n int64
		for _, m := range rw.Steps[ef.Step()-1].Matched {
			n = max(n, s.Repeats[m.Tag])
		}
		for range n {
			out = append(out, ef)
		}
	}
	return out
}

// structural: the rule row a rallied option's why names.
const ruleRally = "ability-rally"

// rallied is the band steps a rally gives an option; the way out is
// always certain already.
func rallied(s Situation, row sheets.OptionRow, why *Why) int64 {
	if s.Rally <= 0 || row.Kind == WayOut {
		return 0
	}
	why.Notes = append(why.Notes, ruleRally)
	return s.Rally
}

// rallies spends a rally given for this press and, the first time a
// failure lands in a party encounter, has a Warden with Rally give one
// to every member for the next (Rally).
func (r *Rules) rallies(e *Encounter, team []*Member, failed int64) {
	e.Rally = 0
	if e.Rallied != "" || e.Party <= 1 || e.failures() <= failed {
		return
	}
	for _, m := range team {
		if steps := r.self(m.Kit, "party-rally", 0); steps > 0 && e.up(m) {
			e.Rally, e.Rallied = steps, m.Ch.ID
			return
		}
	}
}

// shield is who a member's failure lands on, and the item it wears: a
// Warden still up beside them with Shield the line takes it on their own
// armour, as many times an encounter as the ability says.
func (r *Rules) shield(e *Encounter, team []*Member, m *Member, g *Gear) (*Member, *Gear) {
	if e.Party <= 1 {
		return m, g
	}
	for _, w := range team {
		if w.Ch.ID == m.Ch.ID || !e.up(w) {
			continue
		}
		if r.self(w.Kit, "party-failures-taken", 0) > e.Shielded.Get(w.Ch.ID) {
			e.Shielded.Bump(w.Ch.ID, 1)
			return w, w.Kit.Body
		}
	}
	return m, g
}

// reprieve is how many more failures than the rule a member takes before
// going down, each a wound instead: Unmoved in a party encounter, Deep
// breath on the deep floors.
func (r *Rules) reprieve(e *Encounter, m *Member) int64 {
	var n int64
	if e.Party > 1 {
		n += r.self(m.Kit, "party-second-failure", 0)
	}
	if e.Floor > 0 && e.Floor >= r.Param("deep-breath-floor") {
		n += r.self(m.Kit, "deep-breath", 0)
	}
	return n
}

// harm puts a state the encounter lays on a member against their will,
// unless a Kindler in the beat with a counter left lifts it (Counter).
func (r *Rules) harm(e *Encounter, team []*Member, m *Member, st State, tick int64) {
	for _, k := range team {
		if !e.up(k) {
			continue
		}
		if r.self(k.Kit, "counters", 0) > e.Countered.Get(k.Ch.ID) {
			e.Countered.Bump(k.Ch.ID, 1)
			return
		}
	}
	r.put(e, m, st, tick)
}

// widen lands a state a member's exploit put on one creature on the
// other as well, while a second creature is in the encounter (Wide cast).
func (r *Rules) widen(e *Encounter, m *Member, st State) {
	j := e.Joined
	if j == nil || e.At > j.Until || r.self(m.Kit, "exploit-reach", 0) <= 0 {
		return
	}
	if row := r.states[st.Tag]; row != nil && st.Left == 0 {
		st.Left = r.lasts(e, st.Tag, row.Beats)
	}
	if e.onJoined() {
		e.States = upsert(e.States, st)
		return
	}
	j.States = upsert(j.States, st)
}

// standOver keeps the haul of every member down at the end while a
// Warden with Stand over is still up beside them (Stand over).
func (r *Rules) standOver(e *Encounter, ms []*Member) {
	if e.Party <= 1 || len(e.Down) == 0 {
		return
	}
	for _, m := range ms {
		if e.up(m) && r.self(m.Kit, "party-haul-kept", 0) > 0 {
			for _, who := range e.Down {
				if !slices.Contains(e.Kept, who) {
					e.Kept = append(e.Kept, who)
				}
			}
			return
		}
	}
}

// Keeps reports whether a member down in the encounter keeps their haul,
// a Warden having stood over them.
func (e *Encounter) Keeps(who string) bool { return slices.Contains(e.Kept, who) }
