package harness

import (
	"fmt"
	"slices"
	"strings"

	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/sheets"
)

// Mount journeys: on foot against ridden, to a passable tile journeyTiles away.
const (
	journeyTiles  = 12
	journeyWorlds = 8
	journeyStarts = 40 // per mount and world
	journeyRadius = 60 // starts are drawn this close to the origin
	journeyDetour = 3  // a path may stray this many times the straight distance
	// The median saving a speed mount must land in, in percent.
	journeyLoPct = 25
	journeyHiPct = 40
)

// MountRow is one mount kind's journeys.
type MountRow struct {
	Kind     string
	Speed    bool // some terrain it suits costs more than the floor on foot
	Journeys int
	Median   int64 // percent saved
	Lo, Hi   int64 // tenth and ninetieth percentile
}

// MountJourneys measures how much each mount shortens a journey from a
// terrain where it buys speed (speedTerrains). A mount with none buys load,
// not speed (GDD 6.2): it is reported, not held to the band.
func MountJourneys(b *sheets.Book, worlds int) (Measured, []MountRow, error) {
	if worlds == 0 {
		worlds = journeyWorlds
	}
	floor := sheets.IntParam(b.MountParams, "min-enter-ticks")
	sys, err := fight.Wire(b, keys.Throwaway("mounts"))
	if err != nil {
		return Measured{}, nil, err
	}
	mounts := sys.Mounts
	var rows []MountRow
	savings := map[string][]int64{}
	for w := range worlds {
		g, k, err := newGen(b, fmt.Sprintf("mounts-%d", w))
		if err != nil {
			return Measured{}, nil, err
		}
		d := draw.NewDrawer(k.Roll)
		for _, mk := range b.MountKinds {
			fast := speedTerrains(b, mk, floor)
			if len(fast) == 0 {
				continue
			}
			ridden := mounts.NewMount("m", mk.ID)
			for _, s := range journeys(g, d, fast) {
				foot := journeyCost(g, s, nil, mounts)
				ride := journeyCost(g, s, ridden, mounts)
				if foot > 0 && ride > 0 {
					savings[mk.ID] = append(savings[mk.ID], fixed.ShareFloor(foot-ride, foot))
				}
			}
		}
	}
	held, notes := true, []string{}
	for _, mk := range b.MountKinds {
		row := MountRow{Kind: mk.ID, Speed: len(speedTerrains(b, mk, floor)) > 0}
		if s := savings[mk.ID]; len(s) > 0 {
			slices.Sort(s)
			row.Journeys, row.Median = len(s), percentile(s, 50)
			row.Lo, row.Hi = percentile(s, 10), percentile(s, 90)
		}
		rows = append(rows, row)
		if row.Speed {
			ok := row.Journeys > 0 && row.Median >= journeyLoPct && row.Median <= journeyHiPct
			held = held && ok
			notes = append(notes, fmt.Sprintf("%s %d%%", mk.ID, row.Median))
		}
	}
	return Measured{Target: "mount-shortens", Value: "median saving " + strings.Join(notes, ", ") + " (speed mounts)", Holds: held}, rows, nil
}

// speedTerrains are the terrains a mount suits that cost more than the
// floor on foot: where it buys speed. On the rest it buys load only.
func speedTerrains(b *sheets.Book, mk sheets.MountKind, floor int64) []string {
	var out []string
	for _, t := range b.Terrain {
		if t.EnterTicks > floor && slices.Contains(mk.Suits, t.ID) {
			out = append(out, t.ID)
		}
	}
	return out
}

type journey struct{ from, to hex.Hex }

// journeys draws starts of a suited terrain near the origin, each with a
// passable end journeyTiles away.
func journeys(g *gen.Gen, d *draw.Drawer, suits []string) []journey {
	var out []journey
	disc := hex.Disc(journeyRadius)
	for i := range journeyStarts * journeyStarts {
		if len(out) == journeyStarts {
			break
		}
		from := disc[d.Below(uint64(len(disc)), "journey.from", draw.Int(int64(i)))]
		if !slices.Contains(suits, g.Baseline(from).Terrain) {
			continue
		}
		ring := hex.Ring(from, journeyTiles)
		to := ring[d.Below(uint64(len(ring)), "journey.to", draw.Int(int64(i)))]
		if g.Passable(g.Baseline(to).Terrain) {
			out = append(out, journey{from, to})
		}
	}
	return out
}

// journeyCost is the quickest journey's ticks, on foot or ridden; 0 when
// there is no way.
func journeyCost(g *gen.Gen, j journey, m *item.Instance, mounts *item.Mounts) int64 {
	step := func(from, to hex.Hex) (int64, bool) {
		t := g.Baseline(to)
		if !g.Passable(t.Terrain) {
			return 0, false
		}
		cost := g.StepTicks(t.Terrain, t.River && g.Baseline(from).River, t.River)
		if m != nil {
			cost = mounts.EnterTicks(m, cost, item.Ground{Terrain: t.Terrain, River: t.River}, true)
		}
		return cost, true
	}
	_, cost, ok := hex.Path(j.from, j.to, step, 1, journeyTiles*journeyDetour)
	if !ok {
		return 0
	}
	return cost
}
