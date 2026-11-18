package world

import (
	"maps"
	"slices"

	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/sheets"
)

// Band is a moving group of one species: a herd that migrates along its
// season's path, or a pack that follows the nearest herd (GDD 4.15).
type Band struct {
	ID      int     `json:"id"`
	Species string  `json:"species"`
	At      hex.Hex `json:"at"`
	Count   int64   `json:"count"`
	Herd    bool    `json:"herd"` // else a pack
	Region  int     `json:"region"`
}

func (s *State) creature(id string) *sheets.Creature {
	for i := range s.b.Creatures {
		if s.b.Creatures[i].ID == id {
			return &s.b.Creatures[i]
		}
	}
	return nil
}

// Capacity is how many of a species a tile can carry: none off its
// biomes, more with fertility and water, fewer for bigger creatures.
func (s *State) Capacity(h hex.Hex, species string) int64 {
	c := s.creature(species)
	if c == nil {
		return 0
	}
	t := s.g.Baseline(h)
	if !slices.Contains(c.Biomes, t.Terrain) {
		return 0
	}
	n := s.cp("capacity-base") + t.Fertility*s.cp("capacity-fertility")/percent
	if t.Water != "none" {
		n += s.cp("capacity-wet")
	}
	for range c.Tier - 1 {
		n /= s.cp("capacity-tier-step")
	}
	return max(n, 1)
}

// Population is a species' count on a tile: its capacity unless the tile
// stores otherwise.
func (s *State) Population(h hex.Hex, species string) int64 {
	if t := s.Tile(h); t != nil {
		if n, ok := t.Population[species]; ok {
			return n
		}
	}
	return s.Capacity(h, species)
}

// slay takes one of a species off a tile; under a share of capacity the
// species is gone from it.
func (s *State) slay(h hex.Hex, species string) {
	t := s.touch(h)
	t.Slay(species)
	cap := s.Capacity(h, species)
	n := max(0, s.Population(h, species)-1)
	if n*percent < cap*s.cp("gone-share") {
		n = 0
	}
	if t.Population == nil {
		t.Population = map[string]int64{}
	}
	t.Population[species] = n
}

// creatures runs a world day for populations and bands.
func (d *day) creatures() {
	s := d.s
	for _, t := range s.Tiles {
		for _, sp := range sortedKeys(t.Population) {
			cap := s.Capacity(t.Hex, sp)
			n := t.Population[sp]
			if n == 0 {
				// Gone until it spreads back from a neighbour.
				for _, nb := range t.Hex.Neighbours() {
					if s.Population(nb, sp)*percent >= s.Capacity(nb, sp)*s.cp("spread-share") && s.Capacity(nb, sp) > 0 {
						n = max(1, cap*s.cp("gone-share")/percent)
						break
					}
				}
			} else {
				n += max(1, (cap-n)*s.cp("breed-percent")/percent)
			}
			if n >= cap {
				delete(t.Population, sp)
				continue
			}
			t.Population[sp] = n
		}
	}
	for i := range s.Bands {
		d.moveBand(i)
	}
}

func sortedKeys(m map[string]int64) []string { return slices.Sorted(maps.Keys(m)) }

// spawnBand gives a newly woken region a band of its creature, when that
// creature moves in herds or packs.
func (s *State) spawnBand(r int) {
	base := s.g.Region(s.Regions[r].Lattice)
	c := s.creature(base.Creature)
	if c == nil {
		return
	}
	herd, pack := slices.Contains(c.Tags, "herd"), slices.Contains(c.Tags, "pack")
	if !herd && !pack {
		return
	}
	at := base.Centre
	if !slices.Contains(c.Biomes, s.g.Baseline(at).Terrain) {
		return
	}
	s.Bands = append(s.Bands, Band{ID: s.NextBand, Species: c.ID, At: at, Count: s.cp("herd-size"), Herd: herd, Region: r})
	s.NextBand++
}

// moveBand: a herd moves a tile a day along its season's heading,
// turning where its biome or the horizon ends; a pack steps toward the
// nearest herd it can see.
func (d *day) moveBand(i int) {
	s := d.s
	b := &s.Bands[i]
	c := s.creature(b.Species)
	ok := func(h hex.Hex) bool {
		return s.RegionAt(h) >= 0 && slices.Contains(c.Biomes, s.g.Baseline(h).Terrain) && s.g.Passable(s.g.Baseline(h).Terrain)
	}
	var next hex.Hex
	moved := false
	if b.Herd {
		heading := int(s.d.Below(uint64(hex.Directions), "herd.heading", draw.Int(s.sky.SeasonIndex(s.Day)), draw.Int(int64(b.ID))))
		for k := range hex.Directions {
			if n := b.At.Neighbour((heading + k) % hex.Directions); ok(n) {
				next, moved = n, true
				break
			}
		}
	} else {
		prey, found := hex.Hex{}, false
		for _, o := range s.Bands {
			if o.Herd && hex.Distance(o.At, b.At) <= s.cp("pack-sight") && (!found || hex.Distance(o.At, b.At) < hex.Distance(prey, b.At)) {
				prey, found = o.At, true
			}
		}
		if found && prey != b.At {
			for _, n := range b.At.Neighbours() {
				if ok(n) && hex.Distance(n, prey) < hex.Distance(b.At, prey) && (!moved || hex.Distance(n, prey) < hex.Distance(next, prey)) {
					next, moved = n, true
				}
			}
		}
	}
	if !moved {
		return
	}
	b.At = next
	if r := s.RegionAt(next); r >= 0 && r != b.Region {
		b.Region = r
		if b.Herd {
			d.emit("herd.arrived", regionRef(r), nil, nil, fact.S("species", b.Species), fact.N("count", b.Count))
		}
	}
}
