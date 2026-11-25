package harness

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/world"
)

func terrainBook(t *testing.T) *sheets.Book {
	t.Helper()
	b, err := sheetfs.LoadBook(sheetfs.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// spikeEReport is spike E's report on its first n worlds, without the
// line that times their generation.
func spikeEReport(t *testing.T, b *sheets.Book, n int) string {
	t.Helper()
	stats := make([]worldStats, n)
	if err := runParallel(n, func(i int) error {
		var err error
		stats[i], err = oneWorld(b, i)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	if err := writeSpikeE(b, dir, stats, []time.Duration{time.Millisecond}); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(dir, "spike-e.md"))
	if err != nil {
		t.Fatal(err)
	}
	var keep []string
	for l := range strings.SplitSeq(string(raw), "\n") {
		if !strings.Contains(l, "| Per chunk, generating") {
			keep = append(keep, l)
		}
	}
	return strings.Join(keep, "\n")
}

// TestTerrain plays the terrain run on 4 seeds: it holds, it tallies the
// validator's refusals, both roles land pins, and spike E reads the same
// after it as before.
func TestTerrain(t *testing.T) {
	if testing.Short() {
		t.Skip("generates a dozen discs of 250 tiles")
	}
	b := terrainBook(t)
	before := spikeEReport(t, b, 4)
	dir := t.TempDir()
	rs, m, err := terrainRun(b, dir, 4)
	if err != nil {
		t.Fatal(err)
	}
	md, err := os.ReadFile(filepath.Join(dir, "terrain.md"))
	if err != nil {
		t.Fatal(err)
	}
	t.Log(m.Value)
	if !m.Holds {
		t.Fatalf("terrain-pins-hold does not hold:\n%s", md)
	}
	codes, accepted := map[string]int{}, map[string]int{}
	var tiles, chunks, targets int
	for _, r := range rs {
		sumCodes(codes, r.codes)
		sumCodes(accepted, r.accepted)
		tiles, chunks, targets = tiles+r.tiles, chunks+r.chunks, targets+r.homes+r.points
	}
	if total(codes) == 0 || strings.Contains(m.Value, "refused: none") {
		t.Errorf("no refusal tallied: %s", m.Value)
	}
	for _, role := range terrainRoles {
		if accepted[role] == 0 {
			t.Errorf("no %s pin was accepted", role)
		}
	}
	if tiles == 0 || chunks == 0 || targets == 0 {
		t.Errorf("checked %d tiles, %d chunks, %d targets", tiles, chunks, targets)
	}
	if !strings.Contains(string(md), m.Value) {
		t.Error("terrain.md lacks the reading")
	}
	if after := spikeEReport(t, b, 4); after != before {
		t.Error("spike E reads otherwise after the terrain run")
	}
}

// TestTerrainChecksBite: each check of the run fails a world it should.
func TestTerrainChecksBite(t *testing.T) {
	if testing.Short() {
		t.Skip("generates discs of 250 tiles")
	}
	b := terrainBook(t)
	var w *terrainWorld
	shown := -1
	for seed := range 8 {
		tw, err := newTerrainWorld(b, seed)
		if err != nil {
			t.Fatal(err)
		}
		var out terrainResult
		out.tried, out.accepted, out.codes = map[string]int{}, map[string]int{}, map[string]int{}
		if err := tw.place(&out); err != nil {
			t.Fatal(err)
		}
		for k, p := range tw.pins {
			if tw.g.GroundTile(p.At, gen.Ground{Terrain: p.Fix.Ground.Terrain, Elevation: p.Fix.Ground.Elevation}) != tw.g.Baseline(p.At) {
				w, shown = tw, k
				break
			}
		}
		if w != nil {
			break
		}
	}
	if w == nil {
		t.Fatal("no seed of 8 landed a pin whose ground shows")
	}
	broke := func(f func(*terrainResult), want string) {
		t.Helper()
		var out terrainResult
		f(&out)
		for _, s := range out.bad {
			if strings.Contains(s, want) {
				return
			}
		}
		t.Errorf("want a break reading %q, got %q", want, out.bad)
	}

	var clean terrainResult
	over := w.ground(&clean, w.breaks(&clean))
	w.reach(over, &clean, w.breaks(&clean))
	if err := w.twinContent(&clean, w.breaks(&clean)); err != nil {
		t.Fatal(err)
	}
	if len(clean.bad) > 0 {
		t.Fatalf("the clean world breaks: %q", clean.bad)
	}

	// A landed patch no pin accounts for is ground off every patch.
	hidden := *w
	hidden.pins = append(append([]world.Pin(nil), w.pins[:shown]...), w.pins[shown+1:]...)
	broke(func(out *terrainResult) { hidden.ground(out, hidden.breaks(out)) }, "off every patch")

	// Water round the first settlement parts it from all the scaffold joins.
	moat := append([]gen.TileBaseline(nil), over...)
	for _, h := range hex.Ring(w.pure[w.homes[0]].Hex, 1) {
		if i := w.area.Index(h); i >= 0 {
			moat[i].Terrain = "deep-water"
		}
	}
	broke(func(out *terrainResult) { w.reach(moat, out, w.breaks(out)) }, "the pins part it")

	// A far tile, reached in both, whose twin stores something else.
	var far hex.Hex
	for _, h := range hex.Ring(hex.Hex{}, spikeEOut/2) {
		if !slices.ContainsFunc(w.pins, func(p world.Pin) bool { return hex.Distance(p.At, h) <= p.Reach }) {
			far = h
			break
		}
	}
	who := fact.Ref{Kind: "character", ID: "c-terrain"}
	for _, s := range []struct {
		s   *world.State
		log *fact.Mem
	}{{w.s, w.log}, {w.twin, w.tlog}} {
		if _, _, err := world.Advance(s.s, s.log, []world.Action{{Kind: world.ActDiscover, Hex: far, By: who}}, s.s.Tick+1); err != nil {
			t.Fatal(err)
		}
	}
	w.twin.Content(far).Lead += "-other"
	broke(func(out *terrainResult) {
		if err := w.twinContent(out, w.breaks(out)); err != nil {
			t.Fatal(err)
		}
	}, "differs from the pinless twin's")
}
