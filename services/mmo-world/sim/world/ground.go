package world

import (
	"cmp"
	"slices"

	"jams.team/mmo-world/sim/canon"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tile"
)

// Why a terrain pin is refused, past the pin codes every pin shares.
const (
	CodePinRoute = "pin-route" // the re-laid corridors or rivers would move
	CodePinCut   = "pin-cut"   // tiles connected round the pin would part
	CodePinWorld = "pin-world" // a chunk's digest moved; never expected
)

// Baseline is h as the world reads its terrain, water, elevation and
// passability: the scaffold, with a terrain pin's ground laid over it once
// the pin has landed there. Finds, weather, the digest and slot
// comparisons read the scaffold itself (GDD 4.17).
func (s *State) Baseline(h hex.Hex) gen.TileBaseline {
	s.indexGround()
	if len(s.grounds) > 0 {
		if gr, ok := s.grounds[h]; ok {
			return s.g.GroundTile(h, gr)
		}
	}
	return s.g.Baseline(h)
}

func groundOf(f *tile.GroundFix) gen.Ground {
	return gen.Ground{Terrain: f.Terrain, Elevation: f.Elevation}
}

// indexGround rebuilds the landed grounds by tile; setContent keeps the
// index once it is built.
func (s *State) indexGround() {
	if s.grounds != nil {
		return
	}
	s.grounds = map[hex.Hex]gen.Ground{}
	for _, t := range s.Tiles {
		if t.Content != nil && t.Content.Ground != nil {
			s.grounds[t.Hex] = groundOf(t.Content.Ground)
		}
	}
}

// noteGround keeps the ground index in step with stored content.
func (s *State) noteGround(h hex.Hex, c *tile.Content) {
	if s.grounds == nil {
		return
	}
	if c != nil && c.Ground != nil {
		s.grounds[h] = groundOf(c.Ground)
		return
	}
	delete(s.grounds, h)
}

// PatchOf is the tiles a ground fix covers: its tile, then its ring.
func PatchOf(at hex.Hex, f *tile.GroundFix) []hex.Hex {
	if !f.Ring {
		return []hex.Hex{at}
	}
	return append([]hex.Hex{at}, hex.Ring(at, 1)...)
}

func (p *Pin) patches(h hex.Hex) bool {
	f := p.Fix.Ground
	return f != nil && slices.Contains(PatchOf(p.At, f), h)
}

// groundPinAt is the live terrain pin whose patch covers h at tick t: one
// that may still land there.
func (s *State) groundPinAt(h hex.Hex, t int64) *Pin {
	for _, i := range s.near(h) {
		if p := &s.Pins[i]; p.patches(h) && !s.expired(p, t) {
			return p
		}
	}
	return nil
}

// GroundPending reports whether a live terrain pin's patch will land on h
// at its first reach.
func (s *State) GroundPending(h hex.Hex) bool {
	return s.Content(h) == nil && s.groundPinAt(h, s.Tick+1) != nil
}

// pending is what h will read once a live terrain pin lands on it, and
// what it reads now everywhere else.
func (s *State) pending(h hex.Hex) gen.TileBaseline {
	if s.Content(h) == nil {
		if p := s.groundPinAt(h, s.Tick+1); p != nil {
			return s.g.GroundTile(h, groundOf(p.Fix.Ground))
		}
	}
	return s.Baseline(h)
}

// landRing lays a terrain pin's ground on content drawn on its ring.
func (s *State) landRing(c *tile.Content, p *Pin) {
	c.Ground = &tile.GroundFix{Terrain: p.Fix.Ground.Terrain, Elevation: p.Fix.Ground.Elevation}
	c.Pin = p.ID
	if pl := placedOf(p); pl != nil {
		c.Placed = pl
	}
}

// checkTerrain holds a terrain pin to ground the sheets hold and to free,
// unreached scaffold; an admin's patch stays in its region. CheckPin re-lays
// the scaffold under it last (checkRelay), since that is the dear part.
func (s *State) checkTerrain(at hex.Hex, fix tile.Fix, by PinBy, edit bool) error {
	gf := fix.Ground
	if err := s.g.CheckGround(groundOf(gf)); err != nil {
		return refuse(CodePinFix, "%v", err)
	}
	rest := fix
	rest.Ground = nil
	if !rest.Empty() && !s.g.Passable(gf.Terrain) {
		return refuse(CodePinGround, "what else the pin sets stands on passable ground, and %s is not", gf.Terrain)
	}
	for _, h := range PatchOf(at, gf) {
		switch {
		case edit || s.reached(h):
			return refuse(CodePinSeen, "%s is already reached", h.Ref())
		case by.staged() && s.g.RegionOf(h) != *by.Region:
			return refuse(CodePinAnchor, "%s is outside the region of the %s's settlement", h.Ref(), by.Role)
		}
		if why := s.notFree(h, at); why != "" {
			return refuse(CodePinGround, "%s %s", h.Ref(), why)
		}
	}
	return nil
}

// notFree says why ground may not be laid on h, or "": a patch covers free
// scaffold only, so corridors and places stay where generation put them.
func (s *State) notFree(h, at hex.Hex) string {
	b := s.g.Baseline(h)
	t := s.Tile(h)
	switch {
	case b.Site != "":
		return "holds a settlement, a pattern's part or a slot"
	case b.Landmark != "":
		return "holds a landmark"
	case t != nil && (len(t.Structures) > 0 || t.Road > 0):
		return "holds a structure or a road"
	case b.Yielded || b.Ford || b.River || b.Water == gen.WaterStream || b.Water == gen.WaterRiver || b.Water == gen.WaterFord:
		return "carries a corridor or a river"
	case s.g.OnLattice(h):
		return "holds a lattice point"
	case h != at && s.ReserveAt(h) != nil:
		return "holds another pin's reserve"
	case s.groundPinAt(h, s.Tick+1) != nil:
		return "lies under another pin's ground"
	}
	return ""
}

// passWorst is h's passability at its worst under every terrain pin that
// has landed on it or may yet, and under over: passable only where the
// scaffold and each ground are. Every mix of landed and unlanded pins
// passes at least where this does.
func (s *State) passWorst(h hex.Hex, over map[hex.Hex]gen.Ground) bool {
	ok := s.g.Passable(s.g.Baseline(h).Terrain)
	if c := s.Content(h); c != nil && c.Ground != nil {
		ok = ok && s.g.Passable(c.Ground.Terrain)
	} else if p := s.groundPinAt(h, s.Tick+1); p != nil {
		ok = ok && s.g.Passable(p.Fix.Ground.Terrain)
	}
	if gr, in := over[h]; in {
		ok = ok && s.g.Passable(gr.Terrain)
	}
	return ok
}

// checkRelay re-lays the scaffold under a terrain pin. In the disc of
// ground-check-tiles, tiles off the patch that were joined stay joined
// (pin-cut): a walk that crosses the disc enters and leaves it off the
// patch, so reachability holds everywhere. A pure Gen and one with the
// patch laid over its raw ground then lay every chunk the patch touches:
// their routes, and every tile's yield, ford and river (and water, off the
// patch), must match (pin-route). The live Gen's chunks must match the
// pure ones throughout (pin-world).
func (s *State) checkRelay(at hex.Hex, f *tile.GroundFix) error {
	over := map[hex.Hex]gen.Ground{}
	for _, h := range PatchOf(at, f) {
		over[h] = groundOf(f)
	}
	if err := s.checkCut(at, over); err != nil {
		return err
	}
	var ccs []gen.ChunkCoord
	for _, h := range PatchOf(at, f) {
		if cc := s.g.ChunkOf(h); !slices.Contains(ccs, cc) {
			ccs = append(ccs, cc)
		}
	}
	slices.SortFunc(ccs, func(a, b gen.ChunkCoord) int { return cmp.Or(cmp.Compare(a.A, b.A), cmp.Compare(a.B, b.B)) })
	live, err := chunkDigests(s.g, ccs)
	if err != nil {
		return err
	}
	pure, err := s.g.Twin(nil)
	if err != nil {
		return err
	}
	laid, err := s.g.Twin(over)
	if err != nil {
		return err
	}
	for _, cc := range ccs {
		pure.Chunk(cc)
		laid.Chunk(cc)
	}
	if !pure.Routes().Equal(laid.Routes()) {
		return refuse(CodePinRoute, "the corridors or rivers round %s would move", at.Ref())
	}
	for _, cc := range ccs {
		a, b := pure.Chunk(cc), laid.Chunk(cc)
		for i, x := range a.Tiles {
			y := b.Tiles[i]
			_, in := over[x.Hex]
			if x.Yielded != y.Yielded || x.Ford != y.Ford || x.River != y.River || (!in && x.Water != y.Water) {
				return refuse(CodePinRoute, "%s would change under the pin on %s", x.Hex.Ref(), at.Ref())
			}
		}
	}
	want, err := chunkDigests(pure, ccs)
	if err != nil {
		return err
	}
	after, err := chunkDigests(s.g, ccs)
	if err != nil {
		return err
	}
	if !slices.Equal(live, want) || !slices.Equal(after, want) {
		return refuse(CodePinWorld, "the scaffold round %s no longer matches a fresh generator", at.Ref())
	}
	return nil
}

func chunkDigests(g *gen.Gen, ccs []gen.ChunkCoord) ([]canon.Sum, error) {
	out := make([]canon.Sum, len(ccs))
	for i, cc := range ccs {
		d, err := canon.Digest(g.Chunk(cc))
		if err != nil {
			return nil, err
		}
		out[i] = d
	}
	return out, nil
}

// checkCut refuses ground that would part off-patch tiles of the disc
// joined before it (pin-cut), each read at its worst.
func (s *State) checkCut(at hex.Hex, over map[hex.Hex]gen.Ground) error {
	disc := hex.DiscAt(at, sheets.IntParam(s.b.LiveOpsParams, "ground-check-tiles"))
	before := joined(disc, func(h hex.Hex) bool { return s.passWorst(h, nil) })
	after := joined(disc, func(h hex.Hex) bool { return s.passWorst(h, over) })
	to := map[int]int{}
	for i, h := range disc {
		if _, in := over[h]; in || before[i] == none {
			continue
		}
		if a, ok := to[before[i]]; ok && a != after[i] {
			return refuse(CodePinCut, "ground on %s would part tiles joined round it", at.Ref())
		}
		to[before[i]] = after[i]
	}
	return nil
}

// joined labels each passable tile of the disc by its component inside
// the disc, and the rest none.
func joined(disc []hex.Hex, ok func(hex.Hex) bool) []int {
	index := make(map[hex.Hex]int, len(disc))
	pass := make([]bool, len(disc))
	label := make([]int, len(disc))
	for i, h := range disc {
		index[h], pass[i], label[i] = i, ok(h), none
	}
	for i := range disc {
		if !pass[i] || label[i] != none {
			continue
		}
		label[i] = i
		queue := []int{i}
		for len(queue) > 0 {
			k := queue[0]
			queue = queue[1:]
			for _, n := range disc[k].Neighbours() {
				if j, in := index[n]; in && pass[j] && label[j] == none {
					label[j] = i
					queue = append(queue, j)
				}
			}
		}
	}
	return label
}
