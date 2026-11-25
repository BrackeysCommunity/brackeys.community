package world

import (
	"encoding/json"
	"slices"
	"testing"

	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/canon"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/tile"
)

// terrainSeed is the world every terrain pin case is found on.
const terrainSeed = "terrain-pins"

func groundFix(terrain string, ring bool) tile.Fix {
	return tile.Fix{Ground: &tile.GroundFix{Terrain: terrain, Ring: ring}}
}

// groundOpen reports whether a terrain pin's patch round h passes the cheap
// checks: an open tile with a path, every patch tile free and unreached.
func (s *State) groundOpen(h hex.Hex, fix tile.Fix, by PinBy) bool {
	return s.open(h) && s.pathFrom(h, s.mp("pin-path-tiles")) && s.checkTerrain(h, fix, by, false) == nil
}

// refusedAs reserves fix on at and wants code, with the world and its log
// as they were.
func refusedAs(t *testing.T, s *State, log *fact.Mem, at hex.Hex, fix tile.Fix, by PinBy, code string) {
	t.Helper()
	before := pinDigest(t, s, log)
	_, err := s.Reserve(log, at, 1, fix, by)
	if got := codeOf(err); got != code {
		t.Fatalf("ground %s on %s: %q, want %q", fix.Ground.Terrain, at.Ref(), got, code)
	}
	if pinDigest(t, s, log) != before {
		t.Fatalf("a refused terrain pin (%s) changed the world", code)
	}
	t.Logf("%s: %s on %s, ring %v", code, fix.Ground.Terrain, at.Ref(), fix.Ground.Ring)
}

// cutVertex reports whether h's passable neighbours fall in two or more
// runs round it, so closing h may part them.
func (s *State) cutVertex(h hex.Hex) bool {
	ns := h.Neighbours()
	runs := 0
	for d := range ns {
		if s.passWorst(ns[d], nil) && !s.passWorst(ns[(d+len(ns)-1)%len(ns)], nil) {
			runs++
		}
	}
	return runs >= 2
}

// Each terrain refusal fires on a fixed case, and leaves the world as it was.
func TestTerrainPinRefused(t *testing.T) {
	s, log := pinWorld(t, terrainSeed)

	t.Run("pin-fix", func(t *testing.T) {
		at := pinFind(t, s, 3, 30, func(h hex.Hex) bool { return s.groundOpen(h, groundFix("forest", false), designer) })
		refusedAs(t, s, log, at, groundFix("no-such-terrain", false), designer, CodePinFix)
		bad := groundFix("forest", false)
		bad.Ground.Elevation = s.g.ElevationMax() + 1
		refusedAs(t, s, log, at, bad, designer, CodePinFix)
	})

	t.Run("pin-ground", func(t *testing.T) {
		// A ring over a corridor's yielded tile or a river.
		at := pinFind(t, s, 3, 80, func(h hex.Hex) bool {
			if !s.open(h) || s.notFree(h, h) != "" {
				return false
			}
			return slices.ContainsFunc(hex.Ring(h, 1), func(n hex.Hex) bool {
				b := s.g.Baseline(n)
				return b.Yielded || b.River
			})
		})
		refusedAs(t, s, log, at, groundFix("forest", true), designer, CodePinGround)
		// What else a pin sets stands on passable ground.
		fix := groundFix("deep-water", false)
		fix.Lead = "x"
		refusedAs(t, s, log, at, fix, designer, CodePinGround)
	})

	t.Run("pin-seen", func(t *testing.T) {
		at := pinFind(t, s, 3, 30, func(h hex.Hex) bool { return s.groundOpen(h, groundFix("forest", true), designer) })
		w, wlog := pinWorld(t, terrainSeed)
		discover(t, w, wlog, hex.Ring(at, 1)[0])
		refusedAs(t, w, wlog, at, groundFix("forest", true), designer, CodePinSeen)
	})

	t.Run("pin-anchor", func(t *testing.T) {
		at := pinFind(t, s, 3, 80, func(h hex.Hex) bool {
			if !s.open(h) || !s.pathFrom(h, s.mp("pin-path-tiles")) {
				return false
			}
			for _, n := range PatchOf(h, groundFix("forest", true).Ground) {
				if s.notFree(n, h) != "" || s.reached(n) {
					return false
				}
			}
			return slices.ContainsFunc(hex.Ring(h, 1), func(n hex.Hex) bool { return s.g.RegionOf(n) != s.g.RegionOf(h) })
		})
		refusedAs(t, s, log, at, groundFix("forest", true), staged(s, PinAdmin, at), CodePinAnchor)
	})

	t.Run("pin-cut", func(t *testing.T) {
		// Water on the only gap between two stretches of ground.
		fix := groundFix("deep-water", false)
		at := pinFind(t, s, 3, 120, func(h hex.Hex) bool {
			return s.cutVertex(h) && s.groundOpen(h, fix, designer) && codeOf(s.checkCut(h, map[hex.Hex]gen.Ground{h: {Terrain: "deep-water"}})) == CodePinCut
		})
		refusedAs(t, s, log, at, fix, designer, CodePinCut)
	})

	t.Run("pin-route", func(t *testing.T) {
		// A peak on a corridor over open land moves the corridor.
		twin, err := s.g.Twin(nil)
		if err != nil {
			t.Fatal(err)
		}
		twin.Chunk(s.g.ChunkOf(home(s)))
		var on []hex.Hex
		for _, p := range twin.Routes().Paths {
			on = append(on, p...)
		}
		fix := groundFix("peak", false)
		tried := 0
		at := pinFind(t, s, 2, 60, func(h hex.Hex) bool {
			if !slices.Contains(on, h) || s.cutVertex(h) || !s.groundOpen(h, fix, designer) || tried > 8 {
				return false
			}
			tried++
			return codeOf(s.CheckPin(h, 1, fix, designer, false)) == CodePinRoute
		})
		refusedAs(t, s, log, at, fix, designer, CodePinRoute)
	})
}

// acceptedGround finds a tile round home where a ring of ground is
// accepted, trying terrains that cost what the tile does to walk.
func acceptedGround(t *testing.T, s *State, from, to int64) (hex.Hex, tile.Fix) {
	t.Helper()
	var fix tile.Fix
	at := pinFind(t, s, from, to, func(h hex.Hex) bool {
		here := s.g.Terrain(s.g.Baseline(h).Terrain)
		for _, ter := range s.b.Terrain {
			if ter.ID == here.ID || !ter.Passable || ter.EnterTicks != here.EnterTicks {
				continue
			}
			f := groundFix(ter.ID, true)
			if s.groundOpen(h, f, designer) && s.CheckPin(h, 1, f, designer, false) == nil {
				fix = f
				return true
			}
		}
		return false
	})
	return at, fix
}

// An accepted terrain pin lands with each patch tile's first reach and
// reads through State.Baseline on those tiles only.
func TestTerrainPinAccepted(t *testing.T) {
	s, log := pinWorld(t, terrainSeed)
	at, fix := acceptedGround(t, s, 3, 40)
	ter := fix.Ground.Terrain
	p := mustPin(t)(s.Reserve(log, at, 1, fix, designer))
	ring := hex.Ring(at, 1)
	for _, h := range append([]hex.Hex{at}, ring...) {
		if s.Baseline(h) != s.g.Baseline(h) {
			t.Fatalf("%s reads its ground before anyone reached it", h.Ref())
		}
	}
	if codeOf(s.CheckPin(ring[2], 1, groundFix(ter, false), designer, false)) != CodePinGround {
		t.Fatal("a second patch over a live pin's ground was not refused")
	}

	discover(t, s, log, at)
	c := s.Content(at)
	if c == nil || c.Ground == nil || c.Ground.Terrain != ter || c.Ground.Ring || c.Pin != p.ID {
		t.Fatalf("the pin's tile stored %+v", c)
	}
	if s.Baseline(at).Terrain != ter || s.g.Baseline(at).Terrain == ter {
		t.Fatal("the pin's tile does not read its ground over a pure scaffold")
	}
	if !slices.Contains(s.g.ArchetypesOf(ter), c.Lead) && len(s.g.ArchetypesOf(ter)) > 0 {
		t.Fatalf("lead %q is not drawn for %s", c.Lead, ter)
	}
	place := s.Place(at)
	for _, tg := range TerrainTags(s.terrain(ter)) {
		if h, ok := place.Get(tg); !ok || h.From.Note != "terrain:"+ter {
			t.Fatalf("the place reads %v, not %s's tags", place.Tags(), ter)
		}
	}
	if _, kind := s.weatherAt(at); kind == "" && s.Sight(at) != s.terrain(ter).Sight {
		t.Fatalf("sight on %s does not read %s", at.Ref(), ter)
	}
	for _, h := range ring {
		if s.Baseline(h) != s.g.Baseline(h) {
			t.Fatalf("ring tile %s read its ground before its own reach", h.Ref())
		}
	}

	discover(t, s, log, ring[0])
	if rc := s.Content(ring[0]); rc == nil || rc.Ground == nil || rc.Ground.Terrain != ter || rc.Pin != p.ID {
		t.Fatalf("a ring tile stored %+v", rc)
	}
	landed := 0
	for _, f := range log.Since(0) {
		if f.Kind == factPinLanded {
			landed++
		}
	}
	if landed != 1 {
		t.Fatalf("%d pin.landed facts, want the pin's own tile's only", landed)
	}
	patch := []hex.Hex{at, ring[0]}
	for _, h := range hex.DiscAt(at, 16) {
		got, pure := s.Baseline(h), s.g.Baseline(h)
		if slices.Contains(patch, h) {
			if got.Terrain != ter || got.Region != pure.Region || got.Site != pure.Site {
				t.Fatalf("%s reads %+v under its ground", h.Ref(), got)
			}
			continue
		}
		if got != pure {
			t.Fatalf("%s off the patch reads %+v, not the scaffold's %+v", h.Ref(), got, pure)
		}
	}

	// A decoded world rebuilds the ground index from its tiles.
	raw, err := json.Marshal(s)
	if err != nil {
		t.Fatal(err)
	}
	var back State
	if err := json.Unmarshal(raw, &back); err != nil {
		t.Fatal(err)
	}
	back.Attach(s.b, s.g, keys.Throwaway(terrainSeed).Roll)
	for _, h := range patch {
		if back.Baseline(h) != s.Baseline(h) {
			t.Fatalf("a decoded world reads %s otherwise", h.Ref())
		}
	}
}

// Landed terrain pins never reach the generator: the world's Gen gives
// what a fresh Gen gives, in either chunk order.
func TestScaffoldPureWithPins(t *testing.T) {
	s, log := pinWorld(t, terrainSeed)
	var pinned []hex.Hex
	for _, r := range [][2]int64{{3, 20}, {21, 40}} {
		at, fix := acceptedGround(t, s, r[0], r[1])
		mustPin(t)(s.Reserve(log, at, 1, fix, designer))
		discover(t, s, log, append([]hex.Hex{at}, hex.Ring(at, 1)...)...)
		pinned = append(pinned, at)
	}
	for _, at := range pinned {
		if s.Baseline(at) == s.g.Baseline(at) {
			t.Fatalf("the pin on %s never landed", at.Ref())
		}
	}
	b, err := sheetfs.LoadBook(sheetfs.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	seen := map[gen.ChunkCoord]bool{}
	var order []gen.ChunkCoord
	for _, at := range pinned {
		for _, h := range hex.DiscAt(at, 2*s.g.ChunkRadius()) {
			if cc := s.g.ChunkOf(h); !seen[cc] {
				seen[cc] = true
				order = append(order, cc)
			}
		}
	}
	sum := func(g *gen.Gen, cc gen.ChunkCoord) canon.Sum {
		d, err := canon.Digest(g.Chunk(cc))
		if err != nil {
			t.Fatal(err)
		}
		return d
	}
	for _, reverse := range []bool{false, true} {
		fresh, err := gen.New(b, keys.Throwaway(terrainSeed).Generation)
		if err != nil {
			t.Fatal(err)
		}
		walk := slices.Clone(order)
		if reverse {
			slices.Reverse(walk)
		}
		for _, cc := range walk {
			if sum(fresh, cc) != sum(s.g, cc) {
				t.Fatalf("chunk %v differs from a fresh Gen's (reverse %v)", cc, reverse)
			}
		}
	}
}
