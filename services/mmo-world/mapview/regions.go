package mapview

import (
	"cmp"
	"slices"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/npc"
	"jams.team/mmo-world/sim/world"
)

// runGap is the longest stretch of undiscovered tiles a row carries as -1
// slots; a longer one starts a new run, since a run's header costs about
// as many bytes as this many slots.
const runGap = 8

// noSlot marks an undiscovered tile in a row.
const noSlot = -1

// regionName is a region's written name, as the public reads show it.
func (r *reader) regionName(i int) string {
	return r.g.Rules().NPC.PlaceName(npc.ListRegion, world.RegionRef(i))
}

// regionsOf builds the widest level from the discovered tiles, sorted by
// (r, q).
func (r *reader) regionsOf(worldID string, tiles []hex.Hex) api.MapRegions {
	g := r.g
	type acc struct {
		index         int
		n, sumQ, sumR int64
		members       []hex.Hex
	}
	byIndex := map[int]*acc{}
	regionOf := make([]int, len(tiles))
	for i, h := range tiles {
		ri := g.World.RegionAt(h)
		regionOf[i] = ri
		if ri < 0 {
			continue
		}
		a := byIndex[ri]
		if a == nil {
			a = &acc{index: ri}
			byIndex[ri] = a
		}
		a.n++
		a.sumQ += h.Q
		a.sumR += h.R
		a.members = append(a.members, h)
	}
	order := make([]*acc, 0, len(byIndex))
	for _, a := range byIndex {
		order = append(order, a)
	}
	slices.SortFunc(order, func(x, y *acc) int { return cmp.Compare(x.index, y.index) })
	out := api.MapRegions{World: worldID, Regions: make([]api.MapRegion, len(order)), Rows: []api.MapRow{}, Places: []api.MapDot{}}
	slot := make(map[int]int64, len(order))
	for s, a := range order {
		slot[a.index] = int64(s)
		anchor := centroidTile(a.members, a.n, a.sumQ, a.sumR)
		lattice := g.World.Regions[a.index].Lattice
		out.Regions[s] = api.MapRegion{Ref: world.RegionRef(a.index), Terrain: g.World.Gen().Region(lattice).Terrain,
			Anchor: api.Hex{Q: anchor.Q, R: anchor.R}, Tiles: a.n, Name: r.regionName(a.index)}
	}
	var row *api.MapRow
	for i, h := range tiles {
		s := int64(noSlot)
		if ri := regionOf[i]; ri >= 0 {
			s = slot[ri]
		}
		if row != nil && row.R == h.R && h.Q-(row.Q+int64(len(row.Slots))) <= runGap {
			for q := row.Q + int64(len(row.Slots)); q < h.Q; q++ {
				row.Slots = append(row.Slots, noSlot)
			}
			row.Slots = append(row.Slots, s)
			continue
		}
		out.Rows = append(out.Rows, api.MapRow{R: h.R, Q: h.Q, Slots: []int64{s}})
		row = &out.Rows[len(out.Rows)-1]
	}
	for _, h := range tiles {
		if p, ok := r.places[h]; ok && dotted(p.kind) {
			out.Places = append(out.Places, api.MapDot{Q: h.Q, R: h.R, Place: p.kind})
		}
	}
	out.Rev = Rev(out)
	return out
}

// dotted reports whether a place shows as a dot at the widest level: a
// standing settlement or city, never a ruin or a city's outer tile.
func dotted(kind string) bool {
	return kind == api.PlaceSettlement || kind == api.PlaceCity || kind == api.PlaceFaction
}

// centroidTile is the member nearest the members' centroid, the first by
// (r, q) on a tie. Distances are scaled by n so the centroid stays exact.
func centroidTile(members []hex.Hex, n, sumQ, sumR int64) hex.Hex {
	best, bestD := members[0], int64(-1)
	for _, h := range members {
		dq, dr := n*h.Q-sumQ, n*h.R-sumR
		d := max(dq, -dq, dr, -dr, dq+dr, -dq-dr)
		if bestD < 0 || d < bestD {
			best, bestD = h, d
		}
	}
	return best
}
