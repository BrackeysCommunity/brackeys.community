package fight

import (
	"fmt"
	"slices"

	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/tags"
)

// Hunt is a creature with a health pool that many characters wear down
// over a window. Each won beat removes health equal to the option's
// score; spoils are split by health removed (GDD 7.6).
type Hunt struct {
	ID       string         `json:"id"`
	Row      string         `json:"row"`
	Creature Creature       `json:"creature"`
	Site     []tags.Tag     `json:"site"`
	Health   int64          `json:"health"`
	Max      int64          `json:"max"`
	Ends     int64          `json:"ends"` // tick
	Removed  item.Tally     `json:"removed"`
	Beats    int64          `json:"beats"`
	Over     bool           `json:"over"`
	Slain    bool           `json:"slain"`
	Failures item.Tally     `json:"failures"`
	Down     []string       `json:"down"`
	States   []State        `json:"states"`
	Salvage  []Salvaged     `json:"salvage,omitempty"` // left by gear that broke
	Measures []tags.Measure `json:"-"`
}

// StartHunt opens a hunt from its sheet row at a tick.
func (r *Rules) StartHunt(id, row string, site Site, tick int64) (*Hunt, error) {
	h, ok := r.hunts[row]
	if !ok {
		return nil, fmt.Errorf("fight: no hunt %q", row)
	}
	c := r.Spawn(h.Creature, nil, site.Tags, site.Measures)
	pool := h.HealthRatio.Of(r.tiers[c.Tier].HuntHealth)
	return &Hunt{ID: id, Row: row, Creature: c, Site: slices.Clone(site.Tags), Health: pool, Max: pool,
		Ends: tick + h.WindowDays*r.Param("hunt-day-ticks"), Measures: site.Measures}, nil
}

// Close ends a hunt whose window has run out by tick, and reports
// whether it is over.
func (h *Hunt) Close(tick int64) bool {
	if tick >= h.Ends {
		h.Over = true
	}
	return h.Over
}

// HuntBeat is one character's press against a hunt: a Clash with the
// creature's tier, resolved like any beat. Failures, downs, states and
// broken gear's salvage carry on the hunt from press to press. A refused
// press leaves the hunt unchanged.
func (r *Rules) HuntBeat(h *Hunt, m *Member, tick int64) (Pressed, []fact.Fact, error) {
	if h.Over || tick >= h.Ends {
		return Pressed{}, nil, fmt.Errorf("fight: hunt %s is over", h.ID)
	}
	if slices.Contains(h.Down, m.Ch.ID) {
		return Pressed{}, nil, fmt.Errorf("fight: %s is down in hunt %s", m.Ch.ID, h.ID)
	}
	e := &Encounter{ID: h.ID, Creature: h.Creature, Site: h.Site, Measures: h.Measures, Beats: []string{"clash"},
		Machines: []string{""}, Levels: []int64{0}, Party: 1, Guardian: -1,
		Failures: h.Failures, Down: h.Down, States: h.States}
	s, k, opts := r.Choices(e, m.Ch, m.Kit, tick)
	o, ok := OptionByID(opts, m.Pick)
	if !ok {
		return Pressed{}, nil, fmt.Errorf("fight: %s cannot pick %q in a hunt", m.Ch.ID, m.Pick)
	}
	pm := *m
	pm.Kit = k
	m = &pm
	h.Beats++
	oc, why := r.Resolve(o, Roll{Who: m.Ch.ID, Encounter: h.ID, Beat: h.Beats})
	facts := r.apply(e, m, s, o, oc, tick)
	r.tickStates(e, []*Member{m}, tick, &facts)
	h.Failures, h.Down, h.States = e.Failures, e.Down, e.States
	h.Salvage = append(h.Salvage, e.Salvage...)
	if oc.Success && o.Kind == Win {
		took := min(h.Health, o.Score)
		h.Health -= took
		h.Removed.Bump(m.Ch.ID, took)
		facts = append(facts, r.fact(tick, "hunt.wounded", []fact.Ref{{Kind: "character", ID: m.Ch.ID}, {Kind: "hunt", ID: h.ID}}, fact.N("health", took)))
	}
	if h.Health == 0 {
		h.Over, h.Slain = true, true
		facts = append(facts, r.fact(tick, "hunt.slain", []fact.Ref{{Kind: "hunt", ID: h.ID}, {Kind: "archetype", ID: h.Creature.Archetype}}, fact.N("hunters", int64(len(h.Removed)))))
	}
	return Pressed{Who: m.Ch.ID, Option: o, Outcome: oc, Why: why}, facts, nil
}

// Spoils rolls the hunt's sheet row and splits it by health removed.
// Each spoil line's quantity is drawn from half to all of the row's.
func (r *Rules) Spoils(h *Hunt) map[string][]item.Spoil {
	if !h.Slain {
		return map[string][]item.Spoil{}
	}
	var haul []item.Spoil
	for i, s := range r.hunts[h.Row].Spoils {
		lo := fixed.Ratio(s.Quantity, statHalf).Int()
		n := r.roll.Between(lo, s.Quantity, "hunt.spoils", draw.Str(h.ID), draw.Int(int64(i)))
		haul = append(haul, item.Spoil{Material: s.Material, Qty: n})
	}
	return Split(haul, h.Removed)
}
