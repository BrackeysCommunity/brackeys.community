package game

import (
	"cmp"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"slices"
	"strings"
	"testing"

	"jams.team/mmo-world/sim/arc"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/pattern"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/world"
)

// patSearch is how many chunks out from the origin a frontier pattern is
// looked for.
const patSearch = 30

// patChar is a new character standing on h, reached as an arrival would.
func patChar(t *testing.T, g *Game, server string, h hex.Hex) *Char {
	t.Helper()
	key := fmt.Sprintf("pat-new-%d", len(g.Chars))
	res, err := g.Act(Command{Key: key, Kind: Create, Option: "knife", Server: server, Note: "Guild " + server})
	if err != nil {
		t.Fatal(err)
	}
	c := res.Char
	patMove(t, g, c, h)
	return c
}

func patMove(t *testing.T, g *Game, c *Char, h hex.Hex) {
	t.Helper()
	reachAt(t, g, h)
	c.C.At = h
}

// patSet sets the point c stands on to v as a player does: a machine
// armed and solved with the kit's own solve, or a beacon's delivery. It
// returns the facts written.
func patSet(t *testing.T, g *Game, c *Char, v int64) []fact.Fact {
	t.Helper()
	first := fact.ID(g.Log.Len())
	key := fmt.Sprintf("pat-set-%s-%d", c.C.ID, g.Log.Len())
	if _, err := g.Act(Command{Key: key, Char: c.C.ID, Kind: MachineArm, Machine: &MachineCmd{Source: MachinePattern}, Units: v}); err != nil {
		t.Fatalf("%s sets %v to %d: %v", c.C.ID, c.C.At, v, err)
	}
	if c.Armed != nil {
		rig, ok := g.Rig(c, Viewer{})
		if !ok || rig.Source != MachinePattern {
			t.Fatalf("%s armed no pattern machine", c.C.ID)
		}
		log := g.Puzzles().Solve(rig.Layout)
		if _, err := g.Act(Command{Key: key + "-solve", Char: c.C.ID, Kind: MachineSolve, Machine: &MachineCmd{Log: &log}}); err != nil {
			t.Fatal(err)
		}
		if c.Armed != nil {
			t.Fatal("the machine is still armed after its solve")
		}
	}
	return g.Log.Since(first)
}

// patRefused gives a command the rules must refuse with code, changing
// nothing.
func patRefused(t *testing.T, g *Game, what, code string, cmd Command) {
	t.Helper()
	before := digestOf(t, g)
	_, err := g.Act(cmd)
	var ref *Refused
	if !errors.As(err, &ref) || ref.Code != code {
		t.Fatalf("%s: %v, want %s", what, err, code)
	}
	if digestOf(t, g) != before {
		t.Fatalf("%s was refused but changed the game", what)
	}
}

func patKinds(fs []fact.Fact, kind string) []fact.Fact {
	var out []fact.Fact
	for _, f := range fs {
		if f.Kind == kind {
			out = append(out, f)
		}
	}
	return out
}

func patBoard(t *testing.T, g *Game, h hex.Hex) *Board {
	t.Helper()
	b, _, ok := g.pointAt(h)
	if !ok {
		t.Fatalf("no pattern point on %v", h)
	}
	return b
}

func patSolution(t *testing.T, g *Game, b *Board) pattern.Solution {
	t.Helper()
	row := g.puzzleRow(b.Rule)
	if row == nil {
		t.Fatalf("no puzzle row %s", b.Rule)
	}
	return pattern.Solve(g.r.draw, b.rules(row))
}

// patNextDay runs the world to the next world day's first tick.
func patNextDay(t *testing.T, g *Game) {
	t.Helper()
	for day := g.Tick() / sheets.TicksPerDay; g.Tick()/sheets.TicksPerDay == day; {
		advance(t, g)
	}
}

// patSalt gives a character enough of a salt for n beacons.
func patSalt(t *testing.T, g *Game, c *Char, n int64) {
	t.Helper()
	i := slices.IndexFunc(g.r.Book.Materials, func(m sheets.Material) bool { return g.materialHas(m.ID, beaconTag) })
	if i < 0 {
		t.Fatal("no material burns in a beacon")
	}
	dirGive(t, g, c, ledger.Material(g.r.Book.Materials[i].ID), n*g.r.Story.BeaconCost)
}

// patInstance is the scaffold instance of a rule nearest the origin whose
// points all stand, so every point can be reached.
func patInstance(t *testing.T, g *Game, rule string) gen.Instance {
	t.Helper()
	var ccs []gen.ChunkCoord
	for a := int64(-patSearch); a <= patSearch; a++ {
		for b := int64(-patSearch); b <= patSearch; b++ {
			ccs = append(ccs, gen.ChunkCoord{A: a, B: b})
		}
	}
	slices.SortStableFunc(ccs, func(x, y gen.ChunkCoord) int {
		return cmp.Compare(g.r.Gen.ChunkCentre(x).Len(), g.r.Gen.ChunkCentre(y).Len())
	})
	for _, cc := range ccs {
		for _, in := range g.r.Gen.Instances(rule, g.r.Gen.ChunkCentre(cc), g.r.Gen.ChunkRadius()) {
			if !slices.ContainsFunc(in.Points, func(p gen.PatternPoint) bool { return !g.r.Gen.Standing(p) }) {
				return in
			}
		}
	}
	t.Fatalf("no %s within %d chunks", rule, patSearch)
	return gen.Instance{}
}

// patNoSolution checks that no pattern or core fact carries more than the
// rules allow it to say, and that no stored board holds a solution.
func patNoSolution(t *testing.T, g *Game) {
	t.Helper()
	said := []string{"board", "rule", "clue", "says", "point", "other", datumN, "value", "reach", "threat", "attempts", "wrong",
		"kind", "depth", "cache", "goods", "from", "points", "season", "towers", "family", "level", "source", "q", "r"}
	for _, f := range g.Log.Since(0) {
		if !strings.HasPrefix(f.Kind, "pattern.") && !strings.HasPrefix(f.Kind, "core.") {
			continue
		}
		for _, d := range f.Data {
			if !slices.Contains(said, d.Key) {
				t.Fatalf("%s says %s", f.Kind, d.Key)
			}
		}
	}
	b, err := json.Marshal(g.Story.Patterns)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(b), "solution") {
		t.Fatal("a stored board holds its solution")
	}
}

// TestTriangleOpens works the triangle of pylons end to end: its three
// clues, found on their sites, store the board; a day whose settings are
// wrong surges at the vault; the right settings on one day solve it; the
// vault's cache is split among the three who set it; and the chained
// triangle is laid on free ground, the scaffold's chunks byte for byte as
// before.
func TestTriangleOpens(t *testing.T) {
	g := guardGame(t)
	in, ok := g.r.Gen.OriginInstance("triangle-of-pylons")
	if !ok {
		t.Fatal("no triangle of pylons")
	}
	var pylons []hex.Hex
	for _, p := range in.Points {
		if p.Place == "pylon" {
			pylons = append(pylons, p.Hex)
		}
	}
	shell := patBoard(t, g, pylons[0])
	if g.stored(shell) || len(shell.Points) != 3 || len(shell.Clues) != 3 {
		t.Fatalf("the triangle's board: stored %v, %d points, %d clue sites", g.stored(shell), len(shell.Points), len(shell.Clues))
	}
	finder := patChar(t, g, "s-a", shell.Clues[0])
	for i, h := range shell.Clues {
		patMove(t, g, finder, h)
		first := fact.ID(g.Log.Len())
		if err := g.reachPattern(finder, h, g.Tick()); err != nil {
			t.Fatal(err)
		}
		clues := patKinds(g.Log.Since(first), "pattern.clue")
		if len(clues) != 1 {
			t.Fatalf("clue site %d wrote %d clues", i, len(clues))
		}
		if d, _ := clues[0].Get("says"); d.S != pattern.ClueOffset {
			t.Fatalf("a state board's clue says %q", d.S)
		}
		if err := g.reachPattern(finder, h, g.Tick()); err != nil || len(patKinds(g.Log.Since(first), "pattern.clue")) != 1 {
			t.Fatalf("a clue is written twice: %v", err)
		}
	}
	b := g.boardByID(shell.ID)
	if b == nil || len(b.Found) != 3 || len(b.Told) != 3 {
		t.Fatalf("the clues did not store the board: %+v", b)
	}
	if pp := g.PatternAt(finder, pylons[0]); pp == nil || len(pp.Clues) != 3 || pp.Kind != pattern.State || pp.Family != "circuit" || pp.Held != nil {
		t.Fatalf("the pylon reads %+v", pp)
	}

	sol := patSolution(t, g, b)
	setters := make([]*Char, 3)
	for i, h := range b.Points {
		setters[i] = patChar(t, g, "s-a", h)
	}
	wrong := (sol[2] + 1) % 4
	var fs []fact.Fact
	for i, c := range setters {
		v := sol[i]
		if i == 2 {
			v = wrong
		}
		fs = append(fs, patSet(t, g, c, v)...)
	}
	hay := patKinds(fs, "pattern.haywire")
	if len(hay) != 1 || len(patKinds(fs, "pattern.solved")) != 0 {
		t.Fatalf("a wrong day: %d haywires, solved %v", len(hay), b.P.Done)
	}
	i := slices.IndexFunc(g.Pending, func(a world.Action) bool { return a.Kind == world.ActSurge && a.Hex == b.Centre })
	p := g.r.Story
	if i < 0 || g.Pending[i].Units < p.HaywireLeast || g.Pending[i].Units > p.HaywireMost || g.Pending[i].Cause != hay[0].ID {
		t.Fatalf("the haywire surges %v", g.Pending)
	}
	if pp := g.PatternAt(setters[2], b.Points[2]); pp == nil || pp.Held == nil || *pp.Held != wrong {
		t.Fatalf("the wrong setting does not show as held: %+v", pp)
	}

	patNextDay(t, g)
	fs = nil
	for i, c := range setters {
		fs = append(fs, patSet(t, g, c, sol[i])...)
		if i < 2 && b.P.Done {
			t.Fatal("solved before every pylon held its setting on one day")
		}
	}
	if !b.P.Done || len(patKinds(fs, "pattern.solved")) != 1 {
		t.Fatalf("the right day did not solve it: %+v", b.P)
	}
	if solved := patKinds(fs, "pattern.solved")[0]; solved.Region != "" {
		t.Fatalf("the triangle opens a fact, so it is solved in the world's hearing, not %q", solved.Region)
	}
	cache := patKinds(fs, "pattern.cache")
	if len(cache) != 1 {
		t.Fatalf("%d caches", len(cache))
	}
	vault := g.r.Book.Caches[slices.IndexFunc(g.r.Book.Caches, func(c sheets.Cache) bool { return c.ID == "vault-cache" })]
	for _, line := range vault.Goods {
		var got int64
		for _, c := range setters {
			n := g.Ledger.Of(ledger.WaitPool(b.Centre.Ref(), c.C.ID), ledger.Goods(line.Material))
			if n <= 0 {
				t.Fatalf("%s took no %s", c.C.ID, line.Material)
			}
			got += n
		}
		if got != line.Quantity {
			t.Fatalf("%s: %d split, the cache holds %d", line.Material, got, line.Quantity)
		}
	}
	for _, c := range setters {
		if !slices.Contains(c.Waits, b.Centre) {
			t.Fatalf("%s is not told its share waits at the vault", c.C.ID)
		}
	}
	audit(t, g)

	placed := patKinds(fs, "pattern.placed")
	if len(placed) != 1 {
		t.Fatalf("%d placed", len(placed))
	}
	chain := g.Story.Patterns[len(g.Story.Patterns)-1]
	if !chain.Placed || chain.Rule != "second-triangle" || len(chain.Points) != 3 || chain.Depth != 1 ||
		hex.Distance(chain.Centre, b.Centre) != p.ChainDistance || chain.Centre.Len() <= b.Centre.Len() {
		t.Fatalf("the chain: %+v", chain)
	}
	for _, h := range append(slices.Clone(chain.Points), chain.Clues...) {
		bl := g.r.Gen.Baseline(h)
		if !g.r.Gen.Passable(bl.Terrain) || bl.Site != "" || bl.Landmark != "" || g.PlaceAt(h) != nil {
			t.Fatalf("the chain stands on %v, which is not free", h)
		}
		if slices.ContainsFunc(g.r.Gen.Patterns(g.r.Gen.ChunkOf(h)), func(pp gen.PatternPoint) bool { return pp.Hex == h }) {
			t.Fatalf("the chain's %v is on the scaffold", h)
		}
	}
	fresh, err := NewRules(g.r.Book, keys.Throwaway("guards"))
	if err != nil {
		t.Fatal(err)
	}
	for _, h := range slices.Concat(pylons, b.Clues, chain.Points, chain.Clues, []hex.Hex{b.Centre, chain.Centre}) {
		cc := g.r.Gen.ChunkOf(h)
		for _, pair := range [][2]any{{g.r.Gen.Chunk(cc), fresh.Gen.Chunk(cc)}, {g.r.Gen.Patterns(cc), fresh.Gen.Patterns(cc)}} {
			a, _ := json.Marshal(pair[0])
			z, _ := json.Marshal(pair[1])
			if string(a) != string(z) {
				t.Fatalf("chunk %v moved", cc)
			}
		}
	}
	patNoSolution(t, g)

	patRefused(t, g, "a solved pylon", PatternSolved,
		Command{Key: "pat-solved", Char: setters[0].C.ID, Kind: MachineArm, Machine: &MachineCmd{Source: MachinePattern}})
}

// TestChainedTriangleOpensTheCore solves the triangle the first one placed:
// its vault pays, and the opening it casts wakes the core first.
func TestChainedTriangleOpensTheCore(t *testing.T) {
	g := guardGame(t)
	in, _ := g.r.Gen.OriginInstance("triangle-of-pylons")
	first := patBoard(t, g, in.Points[0].Hex)
	sol := patSolution(t, g, first)
	for i, h := range first.Points {
		patSet(t, g, patChar(t, g, "s-a", h), sol[i])
	}
	first = g.boardByID(first.ID)
	chain := g.Story.Patterns[len(g.Story.Patterns)-1]
	if first == nil || !first.P.Done || !chain.Placed {
		t.Fatal("the first triangle did not place its chain")
	}
	sol = patSolution(t, g, chain)
	var fs []fact.Fact
	for i, h := range chain.Points {
		fs = append(fs, patSet(t, g, patChar(t, g, "s-b", h), sol[i])...)
	}
	if !chain.P.Done || len(patKinds(fs, "pattern.cache")) != 1 || len(patKinds(fs, "core.opened")) != 1 {
		t.Fatalf("the chain: solved %v, %d caches, %d cores opened", chain.P.Done, len(patKinds(fs, "pattern.cache")), len(patKinds(fs, "core.opened")))
	}
	ring := g.Story.Ring
	if ring == nil || ring.Open == 0 {
		t.Fatal("the core is shut")
	}
	open := g.openArcs(arc.ScopeWorld)
	if len(open) != 1 || open[0].Template != "the-opening" || open[0].By != ByPattern {
		t.Fatalf("the opening is not cast: %+v", open)
	}
	if c, _ := g.clock(); ring.Until != c.N {
		t.Fatalf("a core whose opening was cast stays open to season %d, not %d", ring.Until, c.N)
	}
	audit(t, g)
	patNoSolution(t, g)
}

// slay writes a guardian slain at a tower, as a kill does, and hands it to
// the story with the step's facts.
func slay(t *testing.T, g *Game, h hex.Hex) {
	t.Helper()
	f, err := g.r.weights.New(g.Tick(), factGuardianSlain, "", []fact.Ref{huntRef(GuardianID(h))}, nil, fact.At(h)...)
	if err != nil {
		t.Fatal(err)
	}
	id, err := g.Log.Append(f)
	if err != nil {
		t.Fatal(err)
	}
	f, _ = g.Log.Get(id)
	g.keepNews([]fact.Fact{f})
}

// TestRingOpensCore: every tower's guardian slain in one season opens the
// core and casts the opening; a guardian slain twice counts once, and one
// slain last season not at all. The close reseals a core past the season
// it was held open through, and starts the tally afresh.
func TestRingOpensCore(t *testing.T) {
	g := guardGame(t)
	ring := g.ringOf()
	if ring == nil || len(ring.Towers) != 8 || ring.Core != (hex.Hex{}) {
		t.Fatalf("the ring: %+v", ring)
	}
	c, _ := g.clock()
	slay(t, g, ring.Towers[0])
	ring.Season = c.N - 1
	if err := g.patternsDay(g.Tick() / sheets.TicksPerDay); err != nil {
		t.Fatal(err)
	}
	if len(ring.Fell) != 0 || ring.Season != c.N {
		t.Fatalf("last season's tower still counts: %+v", ring)
	}
	slay(t, g, hex.Hex{Q: 1, R: 1})
	for _, h := range ring.Towers[:7] {
		slay(t, g, h)
		slay(t, g, h)
	}
	if len(ring.Fell) != 7 {
		t.Fatalf("%d towers fell, want 7", len(ring.Fell))
	}
	day := g.Tick() / sheets.TicksPerDay
	first := fact.ID(g.Log.Len())
	if err := g.patternsDay(day); err != nil {
		t.Fatal(err)
	}
	if ring.Open != 0 || len(patKinds(g.Log.Since(first), "core.opened")) != 0 {
		t.Fatal("seven towers opened the core")
	}
	slay(t, g, ring.Towers[7])
	if err := g.patternsDay(day); err != nil {
		t.Fatal(err)
	}
	opened := patKinds(g.Log.Since(first), "core.opened")
	if ring.Open == 0 || len(opened) != 1 || len(opened[0].Causes) != 8 || len(ring.Fell) != 0 {
		t.Fatalf("eight towers: open %d, %d facts, fell %d", ring.Open, len(opened), len(ring.Fell))
	}
	open := g.openArcs(arc.ScopeWorld)
	if len(open) != 1 || open[0].Template != "the-opening" || open[0].By != ByOpening || ring.Until != c.N {
		t.Fatalf("the opening: %+v, until %d", open, ring.Until)
	}
	if err := g.patternsDay(day); err != nil || len(patKinds(g.Log.Since(first), "core.opened")) != 1 {
		t.Fatalf("the core opened twice: %v", err)
	}

	ring.Until = c.N + 1
	slay(t, g, ring.Towers[0])
	if err := g.ringClose(); err != nil {
		t.Fatal(err)
	}
	if ring.Open == 0 || len(ring.Fell) != 0 {
		t.Fatal("a core held open through the next season shut at this close")
	}
	ring.Until = c.N
	first = fact.ID(g.Log.Len())
	if err := g.ringClose(); err != nil {
		t.Fatal(err)
	}
	if ring.Open != 0 || len(patKinds(g.Log.Since(first), "core.sealed")) != 1 {
		t.Fatal("a core past its season stayed open")
	}
	patNoSolution(t, g)
}

// TestRingWaitsForTheSlot: with the world's arc already running, the core
// still opens but the opening waits, and the core stays open into the
// next season for it.
func TestRingWaitsForTheSlot(t *testing.T) {
	g := guardGame(t)
	ring := g.ringOf()
	c, _ := g.clock()
	g.Story.Arcs = append(g.Story.Arcs, &Arc{ID: "arc-held", Template: "the-siege", Scope: arc.ScopeWorld, Stages: []StageRun{{Due: g.Tick() + sheets.TicksPerDay}}})
	for _, h := range ring.Towers {
		slay(t, g, h)
	}
	if err := g.patternsDay(g.Tick() / sheets.TicksPerDay); err != nil {
		t.Fatal(err)
	}
	if ring.Open == 0 || ring.Until != c.N+1 || len(g.openArcs(arc.ScopeWorld)) != 1 {
		t.Fatalf("open %d until %d, %d world arcs", ring.Open, ring.Until, len(g.openArcs(arc.ScopeWorld)))
	}
}

// TestPatternLapse: a held setting lapses after the row's lapse days.
func TestPatternLapse(t *testing.T) {
	g := guardGame(t)
	in, _ := g.r.Gen.OriginInstance("triangle-of-pylons")
	c := patChar(t, g, "s-a", in.Points[0].Hex)
	patSet(t, g, c, 0)
	b := patBoard(t, g, in.Points[0].Hex)
	row := g.puzzleRow(b.Rule)
	day := g.Tick() / sheets.TicksPerDay
	first := fact.ID(g.Log.Len())
	if err := g.patternsDay(day + row.LapseDays); err != nil || len(b.P.Marks) != 1 {
		t.Fatalf("a setting lapsed early: %v", err)
	}
	if err := g.patternsDay(day + row.LapseDays + 1); err != nil {
		t.Fatal(err)
	}
	if len(b.P.Marks) != 0 || len(patKinds(g.Log.Since(first), "pattern.lapsed")) != 1 {
		t.Fatalf("the setting did not lapse: %+v", b.P)
	}
}

// TestPatternRefusals: each refusal of a pattern's point changes nothing.
func TestPatternRefusals(t *testing.T) {
	g := guardGame(t)
	in, _ := g.r.Gen.OriginInstance("triangle-of-pylons")
	pylon := in.Points[0].Hex
	c := patChar(t, g, "s-a", pylon)
	set := func(v int64) Command {
		return Command{Key: fmt.Sprintf("pat-refused-%d", g.Log.Len()), Char: c.C.ID, Kind: MachineArm, Machine: &MachineCmd{Source: MachinePattern}, Units: v}
	}
	patRefused(t, g, "a value out of range", BadArgs, set(4))
	away := set(0)
	away.To = &hex.Hex{Q: pylon.Q + 1, R: pylon.R}
	patRefused(t, g, "a point not stood on", NotHere, away)
	patMove(t, g, c, hex.Hex{Q: pylon.Q + 1, R: pylon.R})
	patRefused(t, g, "no point here", NoPattern, set(0))
	patMove(t, g, c, pylon)
	if _, err := g.Act(set(1)); err != nil || c.Armed == nil {
		t.Fatalf("arming: %v", err)
	}
	patRefused(t, g, "a second arming", MachineArmed, set(1))
	var ref *Refused
	if err := g.patternSet(c, set(1)); !errors.As(err, &ref) || ref.Code != Busy {
		t.Fatalf("an armed character sets a point: %v", err)
	}
	if g.boardByID(patBoard(t, g, pylon).ID) == nil {
		t.Fatal("arming did not store the board")
	}

	beacon := patInstance(t, g, "peak-beacons").Points[0].Hex
	poor := patChar(t, g, "s-a", beacon)
	patRefused(t, g, "a beacon without salt", BadArgs,
		Command{Key: "pat-poor", Char: poor.C.ID, Kind: MachineArm, Machine: &MachineCmd{Source: MachinePattern}})
}

// TestPatternPeakBeaconsLightSight: the peak's one beacon relit with salt
// solves it, and the region sees further.
func TestPatternPeakBeaconsLightSight(t *testing.T) {
	g := guardGame(t)
	h := patInstance(t, g, "peak-beacons").Points[0].Hex
	c := patChar(t, g, "s-a", h)
	if err := g.World.Discover(g.Log, h, char.Ref(c.C.ID)); err != nil {
		t.Fatal(err)
	}
	if g.World.RegionAt(h) < 0 {
		t.Fatal("the peak's region is not awake")
	}
	before := g.Sight(h)
	patSalt(t, g, c, 1)
	fs := patSet(t, g, c, 0)
	if len(patKinds(fs, "pattern.solved")) != 1 {
		t.Fatal("relighting the beacon did not solve it")
	}
	if g.Sight(h) != before+4 || g.World.Sight(h) != before {
		t.Fatalf("sight %d after %d", g.Sight(h), before)
	}
	if slices.ContainsFunc(c.C.Goods, func(s item.Spoil) bool { return g.materialHas(s.Material, beaconTag) && s.Qty > 0 }) {
		t.Fatal("the beacon burnt no salt")
	}
	audit(t, g)
	patNoSolution(t, g)
}

// TestPatternFrontierLineOrder: the line's points fired out of order
// haywire and go dark; in order they open the line's cache.
func TestPatternFrontierLineOrder(t *testing.T) {
	g := guardGame(t)
	in := patInstance(t, g, "frontier-line")
	b := patBoard(t, g, in.Points[0].Hex)
	sol := patSolution(t, g, b)
	cs := make([]*Char, len(b.Points))
	for i, h := range b.Points {
		cs[i] = patChar(t, g, "s-a", h)
	}
	fs := patSet(t, g, cs[sol[1]], 0)
	if len(patKinds(fs, "pattern.haywire")) != 1 || len(b.P.Marks) != 0 {
		t.Fatalf("out of order: %d haywires, marks %v", len(patKinds(fs, "pattern.haywire")), b.P.Marks)
	}
	fs = nil
	for _, pt := range sol {
		fs = append(fs, patSet(t, g, cs[pt], 0)...)
	}
	if len(patKinds(fs, "pattern.solved")) != 1 || len(patKinds(fs, "pattern.cache")) != 1 {
		t.Fatal("in order the line did not open its cache")
	}
	audit(t, g)
	patNoSolution(t, g)
}

// TestPatternFrontierCrossAlignment: the cross's beacons all raised, one
// facing wrong, haywire; turned right, the cross opens its cache, and its
// dungeon waits.
func TestPatternFrontierCrossAlignment(t *testing.T) {
	g := guardGame(t)
	in := patInstance(t, g, "frontier-cross")
	b := patBoard(t, g, in.Points[0].Hex)
	if len(b.Points) != 4 {
		t.Fatalf("the cross has %d beacons", len(b.Points))
	}
	sol := patSolution(t, g, b)
	cs := make([]*Char, len(b.Points))
	for i, h := range b.Points {
		cs[i] = patChar(t, g, "s-a", h)
		patSalt(t, g, cs[i], 2)
	}
	var fs []fact.Fact
	for i, c := range cs {
		v := sol[i]
		if i == 0 {
			v = (v + 1) % 6
		}
		fs = append(fs, patSet(t, g, c, v)...)
	}
	if len(patKinds(fs, "pattern.haywire")) != 1 {
		t.Fatal("a wrong facing did not haywire")
	}
	fs = patSet(t, g, cs[0], sol[0])
	if len(patKinds(fs, "pattern.solved")) != 1 || len(patKinds(fs, "pattern.cache")) != 1 {
		t.Fatal("the cross did not open")
	}
	if set := patKinds(fs, "pattern.set"); len(set) != 1 {
		t.Fatal("no setting written")
	} else if d, ok := set[0].Get("reach"); !ok || d.N != 4 {
		t.Fatalf("the signal reaches %d", d.N)
	}
	audit(t, g)
	patNoSolution(t, g)
}

// TestPatternFrontierSpiralConnection: repairing a dead run among the
// spiral's haywires and undoes the repairs; the live runs connect it, and
// its road waits.
func TestPatternFrontierSpiralConnection(t *testing.T) {
	g := guardGame(t)
	in := patInstance(t, g, "frontier-spiral")
	b := patBoard(t, g, in.Points[0].Hex)
	sol := patSolution(t, g, b)
	var live, dead []int
	for i, v := range sol {
		if v == 1 {
			live = append(live, i)
		} else {
			dead = append(dead, i)
		}
	}
	at := func(i int) *Char { return patChar(t, g, "s-a", b.Points[i]) }
	var fs []fact.Fact
	for _, i := range append(slices.Clone(live[:len(live)-1]), dead[0]) {
		fs = append(fs, patSet(t, g, at(i), 0)...)
	}
	if len(patKinds(fs, "pattern.haywire")) != 1 || len(b.P.Marks) != 0 {
		t.Fatal("a dead run repaired did not haywire and reset")
	}
	fs = nil
	for _, i := range live {
		fs = append(fs, patSet(t, g, at(i), 0)...)
	}
	if len(patKinds(fs, "pattern.solved")) != 1 || len(patKinds(fs, "pattern.cache")) != 0 || len(patKinds(fs, "pattern.placed")) != 0 {
		t.Fatal("the spiral did not connect, or opened more than its waiting road")
	}
	patNoSolution(t, g)
}

// TestPatternFrontierStarAcrossServers: one server's settings, all right,
// are held back; a second server's character setting one of them solves
// the star, which opens its vault and a world fact.
func TestPatternFrontierStarAcrossServers(t *testing.T) {
	g := guardGame(t)
	in := patInstance(t, g, "frontier-star")
	b := patBoard(t, g, in.Points[0].Hex)
	sol := patSolution(t, g, b)
	var fs []fact.Fact
	for i, h := range b.Points {
		c := patChar(t, g, "s-a", h)
		patSalt(t, g, c, 1)
		fs = append(fs, patSet(t, g, c, sol[i])...)
	}
	if b.P.Done || len(patKinds(fs, "pattern.haywire")) != 0 {
		t.Fatal("one server solved a star that asks two")
	}
	other := patChar(t, g, "s-b", b.Points[0])
	patSalt(t, g, other, 1)
	fs = patSet(t, g, other, sol[0])
	solved := patKinds(fs, "pattern.solved")
	if len(solved) != 1 || solved[0].Region != "" || len(patKinds(fs, "pattern.cache")) != 1 {
		t.Fatalf("the second server: %d solves", len(solved))
	}
	audit(t, g)
	patNoSolution(t, g)
}

// TestPatternFrontierScatterConstellation: the hidden relay looks and is
// found like any other; a wrong activation haywires, the hidden one opens
// the relay vault.
func TestPatternFrontierScatterConstellation(t *testing.T) {
	g := guardGame(t)
	in := patInstance(t, g, "frontier-scatter")
	b := patBoard(t, g, in.Points[0].Hex)
	hidden := int(patSolution(t, g, b)[0])
	seer := patChar(t, g, "s-a", b.Points[hidden])
	var others []int
	for i := range b.Points {
		if i != hidden {
			others = append(others, i)
		}
	}
	look := func(i int) PatternPoint {
		pp := g.PatternAt(seer, b.Points[i])
		if pp == nil {
			t.Fatalf("point %d does not show", i)
		}
		out := *pp
		out.Point, out.Place, out.Family = 0, "", ""
		return out
	}
	if !reflect.DeepEqual(look(hidden), look(others[0])) {
		t.Fatal("the hidden relay looks unlike an unfound one")
	}
	patSet(t, g, seer, pattern.Find)
	for _, i := range others {
		patSet(t, g, patChar(t, g, "s-a", b.Points[i]), pattern.Find)
	}
	if !reflect.DeepEqual(look(hidden), look(others[0])) {
		t.Fatal("the found hidden relay looks unlike another found one")
	}
	fs := patSet(t, g, patChar(t, g, "s-a", b.Points[others[0]]), pattern.Activate)
	if len(patKinds(fs, "pattern.haywire")) != 1 {
		t.Fatal("a wrong activation did not haywire")
	}
	fs = patSet(t, g, seer, pattern.Activate)
	if len(patKinds(fs, "pattern.solved")) != 1 || len(patKinds(fs, "pattern.cache")) != 1 {
		t.Fatal("the hidden relay did not open its vault")
	}
	audit(t, g)
	patNoSolution(t, g)
}

// TestPatternFrontierHookCompletion: a beacon raised at the wrong gap
// haywires; at the missing point it completes the hook and opens a seam.
func TestPatternFrontierHookCompletion(t *testing.T) {
	g := guardGame(t)
	in := patInstance(t, g, "frontier-hook")
	b := patBoard(t, g, in.Points[0].Hex)
	missing := int(patSolution(t, g, b)[0])
	wrong := (missing + 1) % len(b.Points)
	c := patChar(t, g, "s-a", b.Points[wrong])
	patSalt(t, g, c, 2)
	if fs := patSet(t, g, c, 0); len(patKinds(fs, "pattern.haywire")) != 1 {
		t.Fatal("a beacon at the wrong gap did not haywire")
	}
	patMove(t, g, c, b.Points[missing])
	fs := patSet(t, g, c, 0)
	if len(patKinds(fs, "pattern.solved")) != 1 {
		t.Fatal("the missing beacon did not complete the hook")
	}
	i := slices.IndexFunc(g.Pending, func(a world.Action) bool { return a.Kind == world.ActSeam })
	if i < 0 || g.Pending[i].Units != 80 || hex.Distance(g.Pending[i].Hex, b.Centre) > g.r.Story.SeamRadius || g.Pending[i].Material == "" {
		t.Fatalf("no seam opened: %v", g.Pending)
	}
	advance(t, g)
	audit(t, g)
	patNoSolution(t, g)
}
