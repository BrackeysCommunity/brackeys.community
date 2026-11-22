package world

import (
	"cmp"
	"fmt"
	"slices"
	"strings"

	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/tile"
)

// Find is something generated past the authored set, frozen the first
// time anyone finds it: a far or edge material at the tier it was found
// at, a creature variant, a biome variant or a pattern (GDD 4.17).
type Find struct {
	Key    string        `json:"key"`
	Kind   string        `json:"kind"` // far-material, edge-material, variant, edge-creature, biome-variant, pattern
	Region gen.LatticeID `json:"region"`
	Tier   int64         `json:"tier"`
	Vector []int64       `json:"vector,omitempty"` // a material's axes at its tier
	Tick   int64         `json:"tick"`
	Fact   fact.ID       `json:"fact"`
}

// NoveltyBand counts, per distance band from the origin, the regions
// discovered and those that held something not seen before.
type NoveltyBand struct {
	Band    int64 `json:"band"`
	Regions int   `json:"regions"`
	Novel   int   `json:"novel"`
}

// structural: novelty is reported per band of this many tiles (GDD 4.17).
const noveltyBand = 40

// Discover marks a tile discovered by someone: its content is drawn if
// nobody had reached it, the frontier grows, and a region discovered for
// the first time wakes the horizon round it.
func (s *State) Discover(log fact.Log, h hex.Hex, by fact.Ref) error {
	if t := s.Tile(h); t != nil && t.Discovered != nil {
		return nil
	}
	if err := s.Reach(log, h, s.Tick); err != nil {
		return err
	}
	s.touch(h).Discovered = &tile.Discovery{By: by, Tick: s.Tick}
	return s.discoverRegion(log, s.g.RegionOf(h))
}

// Frontier is how many tiles anyone has entered.
func (s *State) Frontier() int {
	n := 0
	for _, t := range s.Tiles {
		if t.Discovered != nil {
			n++
		}
	}
	return n
}

// discoverRegion wakes a region and those within the horizon's hops of
// it, records what it holds that nobody had found, and seats factions
// for the new regions.
func (s *State) discoverRegion(log fact.Log, id gen.LatticeID) error {
	if i := s.RegionIndex(id); i >= 0 && s.Regions[i].Discovered {
		return nil
	}
	ring := []gen.LatticeID{id}
	seen := map[gen.LatticeID]bool{id: true}
	for range s.wp("horizon-hops") {
		var next []gen.LatticeID
		for _, r := range ring {
			for _, n := range s.g.RegionNeighbours(r) {
				if !seen[n] {
					seen[n] = true
					next = append(next, n)
				}
			}
		}
		ring = append(ring, next...)
	}
	for _, r := range ring {
		s.wake(r)
	}
	i := s.RegionIndex(id)
	s.Regions[i].Discovered = true
	s.relink()
	d := &day{s: s, log: log}
	d.emit("region.discovered", RegionRef(i), nil, nil, fact.N("distance", s.g.Region(id).Distance))
	d.finds(i)
	s.seatFactions(d)
	return d.err
}

// wake gives a dormant region its state at its baseline.
func (s *State) wake(id gen.LatticeID) {
	if s.RegionIndex(id) >= 0 {
		return
	}
	lo, hi, corruptionHi := s.wp("baseline-min"), s.wp("baseline-max"), s.wp("corruption-baseline-max")
	base := s.g.Region(id)
	idx := len(s.Regions)
	reg := Region{
		ID: idx, Lattice: id, Holder: none, Tiles: len(s.g.RegionTiles(id)),
		Active: make([]bool, len(s.b.GaugeLines)), Tier: s.g.TierAt(base.Centre, s.Opened),
		Weather: make([]int64, len(s.b.Weather)),
	}
	who := []draw.Part{draw.Int(id.I), draw.Int(id.J)}
	for gi, g := range s.b.Gauges {
		top := hi
		if g.ID == "corruption" {
			top = corruptionHi
		}
		v := s.d.Between(lo, top, "world.baseline", append(who, draw.Int(int64(gi)))...)
		reg.Gauge = append(reg.Gauge, v)
		reg.Base = append(reg.Base, v)
	}
	for n := range s.Opened {
		if s.g.RegionOf(s.g.Settlement(n).Hex) == id {
			reg.Settlement = true
			reg.Defence = s.wp("settlement-defence")
		}
	}
	s.Regions = append(s.Regions, reg)
	s.region[id] = idx
	s.spawnBand(idx)
}

// relink recomputes awake neighbours and the dormant fringe.
func (s *State) relink() {
	fringe := map[gen.LatticeID]bool{}
	s.Dormant = s.Dormant[:0]
	for i := range s.Regions {
		r := &s.Regions[i]
		r.Neighbours = r.Neighbours[:0]
		for _, n := range s.g.RegionNeighbours(r.Lattice) {
			if j := s.RegionIndex(n); j >= 0 {
				r.Neighbours = append(r.Neighbours, j)
			} else if !fringe[n] {
				fringe[n] = true
				s.Dormant = append(s.Dormant, n)
			}
		}
		slices.Sort(r.Neighbours)
	}
	slices.SortFunc(s.Dormant, gen.CompareIDs)
}

// finds records what a newly discovered region holds that nobody has
// found before, frozen at the region's tier, and counts it toward the
// novelty measure.
func (d *day) finds(i int) {
	s := d.s
	r := s.Regions[i]
	base := s.g.Region(r.Lattice)
	var news []Find
	add := func(kind, key string, vector []int64) {
		k := kind + ":" + key
		if _, ok := slices.BinarySearchFunc(s.Finds, k, func(f Find, k string) int { return strings.Compare(f.Key, k) }); ok {
			return
		}
		for _, n := range news {
			if n.Key == k {
				return
			}
		}
		news = append(news, Find{Key: k, Kind: kind, Region: r.Lattice, Tier: r.Tier, Vector: vector, Tick: s.Tick})
	}
	if base.Far != nil {
		add("far-material", base.Far.ID, base.Far.Vector(s.b.Tiers, r.Tier))
	}
	if base.EdgeMaterial != nil {
		add("edge-material", base.EdgeMaterial.ID, base.EdgeMaterial.Vector(s.b.Tiers, r.Tier))
	}
	if base.Variant != "" {
		add("variant", base.Creature+"."+base.Variant, nil)
	}
	if base.EdgeCreature != "" {
		add("edge-creature", base.EdgeCreature+"."+base.Edge, nil)
	}
	for _, h := range s.g.RegionTiles(r.Lattice) {
		if v := s.g.Baseline(h).Variant; v != "" {
			add("biome-variant", v, nil)
		}
	}
	for _, p := range s.patternsIn(r.Lattice) {
		add("pattern", p, nil)
	}
	band := base.Distance / noveltyBand * noveltyBand
	k, ok := slices.BinarySearchFunc(s.Novelty, band, func(n NoveltyBand, b int64) int { return cmp.Compare(n.Band, b) })
	if !ok {
		s.Novelty = slices.Insert(s.Novelty, k, NoveltyBand{Band: band})
	}
	s.Novelty[k].Regions++
	if len(news) > 0 {
		s.Novelty[k].Novel++
	}
	for _, f := range news {
		f.Fact = d.emit("find.first-sight", RegionRef(i), nil, nil, fact.S("find", f.Key), fact.N("tier", f.Tier))
		s.Finds = append(s.Finds, f)
	}
	slices.SortFunc(s.Finds, func(a, b Find) int { return strings.Compare(a.Key, b.Key) })
}

// patternsIn lists the pattern instances with a point in a region.
func (s *State) patternsIn(id gen.LatticeID) []string {
	var out []string
	tiles := s.g.RegionTiles(id)
	var chunks []gen.ChunkCoord
	for _, h := range tiles {
		if cc := s.g.ChunkOf(h); !slices.Contains(chunks, cc) {
			chunks = append(chunks, cc)
		}
	}
	for _, cc := range chunks {
		for _, p := range s.g.Chunk(cc).Points {
			if s.g.RegionOf(p.Hex) == id && !slices.Contains(out, p.Instance) {
				out = append(out, p.Instance)
			}
		}
	}
	slices.Sort(out)
	return out
}

// Novel is the share, in percent, of discovered regions in a band that
// held something new, and how many were discovered there.
func (s *State) Novel(band int64) (int64, int) {
	for _, n := range s.Novelty {
		if n.Band == band && n.Regions > 0 {
			return fixed.ShareFloor(int64(n.Novel), int64(n.Regions)), n.Regions
		}
	}
	return 0, 0
}

// seatFactions seats a faction per regions-per-faction awake regions,
// as regions come inside the horizon.
func (s *State) seatFactions(d *day) {
	want := int64(len(s.Regions)) / s.p("regions-per-faction")
	spacing := s.p("seat-spacing")
	heads := s.parts("faction-head")
	for int64(len(s.Factions)) < want {
		i := len(s.Factions)
		order := s.d.Shuffle(len(s.Regions), "world.seats", draw.Int(int64(i)))
		seat := none
		for _, r := range order {
			reg := s.Regions[r]
			if reg.Settlement || reg.Holder != none || !passable(s.g, reg.Lattice) {
				continue
			}
			ok := true
			for _, f := range s.Factions {
				if !f.Fallen && hex.Distance(s.centre(r), s.centre(f.Seat)) < spacing {
					ok = false
				}
			}
			if ok {
				seat = r
				break
			}
		}
		if seat == none {
			return
		}
		arch := s.b.Archetypes[s.d.Below(uint64(len(s.b.Archetypes)), "world.archetype", draw.Int(int64(i)))].ID
		f := Faction{
			ID: i, Archetype: arch, Seat: seat, Stock: s.p("start-stock"),
			Head: heads[s.d.Below(uint64(len(heads)), "world.faction-name", draw.Int(int64(i)))],
		}
		s.Factions = append(s.Factions, f)
		for j := range s.Factions {
			for len(s.Factions[j].Disposition) < len(s.Factions) {
				s.Factions[j].grow()
			}
		}
		s.Regions[seat].Holder, s.Regions[seat].Defence = i, s.p("holding-defence")
		s.appoint(d, i, true)
		d.emit("faction.seated", RegionRef(seat), []fact.Ref{factionRef(i)}, nil)
	}
}

func (s *State) centre(r int) hex.Hex { return s.g.Region(s.Regions[r].Lattice).Centre }

// Describe names a region for reports.
func (s *State) Describe(r int) string {
	id := s.Regions[r].Lattice
	return fmt.Sprintf("%s (%s)", RegionRef(r), latticeRef(id))
}
