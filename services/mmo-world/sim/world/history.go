package world

import (
	"cmp"
	"slices"

	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/history"
)

// HistoryCell is one cell of the spatial index of heavy facts a digest
// reads: history-radius by history-radius axial tiles, the newest
// history-cell-kept entries.
type HistoryCell struct {
	I     int64           `json:"i"`
	J     int64           `json:"j"`
	Facts []history.Heavy `json:"facts"` // oldest first, by (tick, id)
}

func (s *State) bounds() history.Bounds { return history.BoundsOf(s.b.MapParams) }

// Note indexes the located heavy facts among fs; a world from before
// content was drawn from history notes nothing. Noting a fact twice keeps
// one entry.
func (s *State) Note(fs ...fact.Fact) {
	if !s.Drawn() || len(fs) == 0 {
		return
	}
	b := s.bounds()
	if b.CellKept <= 0 {
		return
	}
	for _, f := range fs {
		if !b.Indexed(f.Kind, f.Weight) {
			continue
		}
		at, ok := s.FactAt(f)
		if !ok {
			continue
		}
		i, j := b.CellOf(at)
		c := s.cell(i, j, true)
		if slices.ContainsFunc(c.Facts, func(e history.Heavy) bool { return e.ID == int64(f.ID) }) {
			continue
		}
		e := history.Heavy{ID: int64(f.ID), Kind: f.Kind, Tick: f.Tick, Weight: f.Weight, At: at}
		k, _ := slices.BinarySearchFunc(c.Facts, e, olderFirst)
		c.Facts = slices.Insert(c.Facts, k, e)
		if over := int64(len(c.Facts)) - b.CellKept; over > 0 {
			c.Facts = slices.Delete(c.Facts, 0, int(over))
		}
	}
}

func olderFirst(a, b history.Heavy) int {
	return cmp.Or(cmp.Compare(a.Tick, b.Tick), cmp.Compare(a.ID, b.ID))
}

// FactAt is where a fact happened: the tile its data names, or else its
// region's centre. Season facts and reports have no place.
func (s *State) FactAt(f fact.Fact) (hex.Hex, bool) {
	if h, ok := fact.HexOf(f); ok {
		return h, true
	}
	if r, ok := ParseRegionRef(f.Region); ok && r >= 0 && r < len(s.Regions) {
		return s.centre(r), true
	}
	return hex.Hex{}, false
}

// cell finds an index cell, adding it in (I, J) order when add is set.
func (s *State) cell(i, j int64, add bool) *HistoryCell {
	k, ok := slices.BinarySearchFunc(s.History, i, func(c HistoryCell, i int64) int {
		return cmp.Or(cmp.Compare(c.I, i), cmp.Compare(c.J, j))
	})
	if !ok {
		if !add {
			return nil
		}
		s.History = slices.Insert(s.History, k, HistoryCell{I: i, J: j})
	}
	return &s.History[k]
}

// pruneHistory drops, at the day's turn, entries no later digest can read
// and the cells they leave empty, so the index is bounded by the cells
// active within the window.
func (s *State) pruneHistory() {
	if len(s.History) == 0 {
		return
	}
	cut := s.Tick - s.bounds().Ticks
	for k := range s.History {
		c := &s.History[k]
		n, _ := slices.BinarySearchFunc(c.Facts, cut, func(e history.Heavy, t int64) int { return cmp.Compare(e.Tick, t) })
		c.Facts = slices.Delete(c.Facts, 0, n)
	}
	s.History = slices.DeleteFunc(s.History, func(c HistoryCell) bool { return len(c.Facts) == 0 })
}

// DigestAt is the neighbourhood of h read at tick t, from state written
// before t only.
func (s *State) DigestAt(h hex.Hex, t int64) history.Digest {
	d, _ := s.DigestCost(h, t)
	return d
}

// DigestCost is DigestAt with how many entries, tiles, pins and finds it
// visited, which no world's age or size may raise.
func (s *State) DigestCost(h hex.Hex, t int64) (history.Digest, int64) {
	b := s.bounds()
	var cost int64
	ci, cj := b.CellOf(h)
	var cells [][]history.Heavy
	for i := ci - 1; i <= ci+1; i++ {
		for j := cj - 1; j <= cj+1; j++ {
			if c := s.cell(i, j, false); c != nil {
				cells = append(cells, c.Facts)
				cost += int64(len(c.Facts))
			}
		}
	}
	d := history.Digest{Facts: history.Facts(h, t, b, cells...)}

	disc := hex.DiscAt(h, b.Radius)
	cost += int64(len(disc))
	var reach []gen.LatticeID
	for _, at := range disc {
		if id := s.g.RegionOf(at); !slices.Contains(reach, id) {
			reach = append(reach, id)
		}
	}
	slices.SortFunc(reach, gen.CompareIDs)

	if len(s.b.Gauges) > 0 {
		d.Bands = make([]int64, len(s.b.Gauges))
		if r := s.RegionAt(h); r >= 0 && !s.arrivedRegion(r) {
			for i, g := range s.b.Gauges {
				d.Bands[i] = history.BandOf(s.b.GaugeLines, g.ID, s.Regions[r].Gauge[i])
			}
		}
	}

	d.Faction = s.pressure(reach, b.HoldersMost)

	pins, visited := s.pinsCost(h, t)
	d.Pins, cost = pins, cost+visited

	s.indexFinds()
	found := map[string]int64{}
	for _, id := range reach {
		for _, i := range s.findsIn[id] {
			cost++
			if f := s.Finds[i]; f.Tick < t {
				found[f.Kind]++
			}
		}
	}
	d.Finds = history.Tally(found, b.KindMost)
	return d, cost
}

func (s *State) arrivedRegion(r int) bool { return s.arriving != nil && s.arriving.regions[r] }

func (s *State) arrivedFaction(f int) bool { return s.arriving != nil && s.arriving.factions[f] }

// pressure is what the factions holding the awake regions in reach bring.
func (s *State) pressure(reach []gen.LatticeID, most int64) history.Pressure {
	var p history.Pressure
	var holders []int
	for _, id := range reach {
		r := s.RegionIndex(id)
		if r < 0 || s.arrivedRegion(r) {
			continue
		}
		fi := s.Regions[r].Holder
		if fi < 0 || fi >= len(s.Factions) || s.arrivedFaction(fi) || slices.Contains(holders, fi) {
			continue
		}
		holders = append(holders, fi)
		f := s.Factions[fi]
		if !slices.Contains(p.Archetypes, f.Archetype) {
			p.Archetypes = append(p.Archetypes, f.Archetype)
		}
		p.War = p.War || slices.ContainsFunc(f.Grudge, func(g int64) bool { return g > 0 })
		p.Starving = p.Starving || f.Starving
	}
	slices.Sort(p.Archetypes)
	p.Holders = min(int64(len(holders)), most)
	return p
}

// pinsCost is PinsAt with how many pins the read visited: those standing
// in the pin cells round h, which pins-per-cell bounds.
func (s *State) pinsCost(h hex.Hex, t int64) ([]string, int64) {
	return s.PinsAt(h, t), int64(len(s.near(h)))
}

// indexFinds rebuilds the finds-by-region index whenever a find was added.
func (s *State) indexFinds() {
	if s.findsIn != nil && s.findsSeen == len(s.Finds) {
		return
	}
	s.findsIn = map[gen.LatticeID][]int{}
	for i, f := range s.Finds {
		s.findsIn[f.Region] = append(s.findsIn[f.Region], i)
	}
	s.findsSeen = len(s.Finds)
}
