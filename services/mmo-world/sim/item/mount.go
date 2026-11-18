package item

import (
	"slices"

	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/sheets"
)

// Mounts are items too: found, bred or made, traded and levelled by use
// (GDD 6.2). The mounts.kinds row is what the instance is.
type Mounts struct {
	kinds  map[string]*sheets.MountKind
	params []sheets.Param
	g      *Growth
}

func NewMounts(b *sheets.Book, g *Growth) *Mounts {
	return &Mounts{kinds: sheets.Lookup(b.MountKinds), params: b.MountParams, g: g}
}

func (m *Mounts) param(id string) int64 { return sheets.IntParam(m.params, id) }

// NewMount is a mount of a kind at level 1.
func (m *Mounts) NewMount(id, kind string) *Instance {
	return &Instance{ID: id, Mount: kind, Level: 1, Picks: []string{}}
}

func (m *Mounts) Kind(id string) *sheets.MountKind { return m.kinds[id] }

// Suits reports whether a mount lowers the cost of a tile.
func (m *Mounts) Suits(in *Instance, terrain string, road bool) bool {
	k := m.kinds[in.Mount]
	if k.RoadOnly {
		return road
	}
	return slices.Contains(k.Suits, terrain)
}

// EnterTicks is the cost of entering a tile ridden: a suited tile costs
// the saving less (more with Sure-footed), never under the floor. An
// unfed mount does not carry.
func (m *Mounts) EnterTicks(in *Instance, base int64, terrain string, road, fed bool) int64 {
	if in == nil || !fed || !m.Suits(in, terrain, road) {
		return base
	}
	saving := m.param("tick-saving")
	for _, p := range in.Picks {
		if o, ok := m.g.MountOffer(p); ok && o.Effect == "tick-saving" {
			saving += o.Magnitude
		}
	}
	return max(m.param("min-enter-ticks"), base-saving)
}

// Load is the load a mount adds, with Pack picks.
func (m *Mounts) Load(in *Instance) int64 {
	if in == nil {
		return 0
	}
	load := m.kinds[in.Mount].Load
	var pct int64
	for _, p := range in.Picks {
		if o, ok := m.g.MountOffer(p); ok && o.Effect == "load" {
			pct += o.Magnitude
		}
	}
	return fixed.PercentOf(load, fixed.Hundredths+pct)
}

// PackLoad is a character's pack before mounts and traits.
func (m *Mounts) PackLoad() int64 { return m.param("pack-load") }

// Upkeep is the provisions a mount eats: upkeep-daily a world day, plus
// one per upkeep-ridden ticks ridden.
func (m *Mounts) Upkeep(days, ticksRidden int64) int64 {
	return days*m.param("upkeep-daily") + ticksRidden/m.param("upkeep-ridden")
}

// Ridden records a tile entered and gives xp when the terrain suits it.
func (m *Mounts) Ridden(in *Instance, terrain string, road, laden bool) Levelled {
	in.Record.Add("ridden", "any")
	if laden {
		in.Record.Bump("ridden:laden", 1)
	}
	if road {
		in.Record.Bump("ridden:road", 1)
	}
	if !m.Suits(in, terrain, road) {
		return Levelled{From: in.Level, To: in.Level}
	}
	in.Record.Bump("ridden:suited", 1)
	return m.g.AddXP(in, nil, m.g.Deed("mount-tile"))
}
