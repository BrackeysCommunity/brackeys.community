package game

import (
	"errors"
	"slices"
	"strings"
	"testing"

	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/world"
)

// The pattern template's row, as the sheets give it.
const stagedTriangle = "second-triangle"

// probeStage is the pattern stage an admin's next order at h would make.
func probeStage(g *Game, c *Char, home int, h hex.Hex) *Stage {
	next := int64(0)
	if g.Live != nil {
		next = g.Live.Next
	}
	return &Stage{ID: "st-" + i64(next+1), Template: sheets.StagePattern, Kind: sheets.StagePattern, Server: c.Server, Role: RoleAdmin,
		By: c.C.ID, Settlement: home, At: h, Pattern: stagedTriangle}
}

// patternTile is the nearest stage tile whose next pattern lays, or, with
// bad set, is refused pin-path for a point off free open ground.
func patternTile(g *Game, c *Char, home int, bad bool) (hex.Hex, bool) {
	return freeStageTile(g, home, func(h hex.Hex) bool {
		_, _, err := g.layStaged(probeStage(g, c, home, h))
		if !bad {
			return err == nil
		}
		var r *Refused
		return errors.As(err, &r) && r.Code == world.CodePinPath && strings.Contains(r.Error(), "free open ground")
	})
}

// TestStagedPatternRefused: the pattern is an admin's alone, a pattern its
// template does not list is refused, and points off free open ground or
// with no known ground within pin-path-tiles are refused pin-path, each
// with the game unchanged.
func TestStagedPatternRefused(t *testing.T) {
	g, c, home := houseGame(t)
	good, ok := patternTile(g, c, home, false)
	if !ok {
		t.Skip("no ground near server a's settlement takes the pattern")
	}
	order := func(as Command, s StageCmd) Command {
		as.Key, as.Char, as.Kind, as.Server, as.Stage = "pat-order-"+i64(int64(g.Log.Len())), c.C.ID, Staging, c.Server, &s
		return as
	}
	at := StageCmd{Template: sheets.StagePattern, Settlement: home, At: good, Pattern: stagedTriangle}
	patRefused(t, g, "a staff pattern", StageTemplate, order(Command{Staff: true}, at))
	other := at
	other.Pattern = "triangle"
	patRefused(t, g, "an unlisted pattern", BadArgs, order(Command{Admin: true}, other))

	if bad, ok := patternTile(g, c, home, true); ok {
		off := at
		off.At = bad
		patRefused(t, g, "a pattern off open ground", world.CodePinPath, order(Command{Admin: true}, off))
	} else {
		t.Log("every pattern near the settlement lays on open ground")
	}

	params := g.r.Book.MapParams
	t.Cleanup(func() { g.r.Book.MapParams = params })
	short := slices.Clone(params)
	short[slices.IndexFunc(short, func(p sheets.Param) bool { return p.ID == "pin-path-tiles" })].Value = fixed.One
	g.r.Book.MapParams = short
	_, _, err := g.layStaged(probeStage(g, c, home, good))
	if r := (*Refused)(nil); !errors.As(err, &r) || r.Code != world.CodePinPath || !strings.Contains(r.Error(), "known ground") {
		t.Fatalf("points a walk of 1 cannot reach known ground from: %v", err)
	}
	patRefused(t, g, "a pattern out of reach", world.CodePinPath, order(Command{Admin: true}, at))
}

// TestStagedPatternPays: an admin's pattern lays its row round the stage
// tile, with no chain; a wrong day raises no threat; the right day solves
// it and pays each solver but the stager one roll of the template's table
// as goods staged at the settlement, opening nothing of its row's.
func TestStagedPatternPays(t *testing.T) {
	g, c, home := houseGame(t)
	h, ok := patternTile(g, c, home, false)
	if !ok {
		t.Skip("no ground near server a's settlement takes the pattern")
	}
	st := stageAs(t, g, c, Command{Admin: true}, StageCmd{Template: sheets.StagePattern, Settlement: home, At: h, Pattern: stagedTriangle})
	b := g.boardByID(st.Board)
	if b == nil || b.ID != stagedBoardID(st) || b.Placed || b.Centre != h || len(b.Points) != 3 || b.Rule != stagedTriangle {
		t.Fatalf("the staged board: %+v", b)
	}
	if g.boardStage(b) != st || len(factsOf(g, "pattern.placed")) != 1 {
		t.Fatal("the board does not read as the stage's")
	}
	boards, arcs := len(g.Story.Patterns), len(g.Story.Arcs)

	sol := patSolution(t, g, b)
	setters := []*Char{c, patChar(t, g, "b", b.Points[1]), patChar(t, g, "b", b.Points[2])}
	patMove(t, g, c, b.Points[0])
	wrong := (sol[2] + 1) % max(g.puzzleRow(b.Rule).Values, 1)
	pending := len(g.Pending)
	var fs []fact.Fact
	for i, s := range setters {
		v := sol[i]
		if i == 2 {
			v = wrong
		}
		fs = append(fs, patSet(t, g, s, v)...)
	}
	hay := patKinds(fs, "pattern.haywire")
	if len(hay) != 1 || b.P.Done {
		t.Fatalf("a wrong day: %d haywires", len(hay))
	}
	if d, _ := hay[0].Get("threat"); d.N != 0 || slices.ContainsFunc(g.Pending[pending:], func(a world.Action) bool { return a.Kind == world.ActSurge }) {
		t.Fatalf("a staged board surged: %+v", g.Pending[pending:])
	}

	patNextDay(t, g)
	fs = nil
	for i, s := range setters {
		fs = append(fs, patSet(t, g, s, sol[i])...)
	}
	if !b.P.Done || len(patKinds(fs, "pattern.solved")) != 1 || len(patKinds(fs, "pattern.cache")) != 1 {
		t.Fatalf("the right day: done %v, facts %v", b.P.Done, fs)
	}
	if stagedCarried(c) != 0 {
		t.Fatalf("the stager took %+v", c.C.Staged)
	}
	for _, s := range setters[1:] {
		if stagedCarried(s) <= 0 {
			t.Fatalf("%s took nothing", s.C.ID)
		}
		for _, sg := range s.C.Staged {
			if sg.At != home || g.Ledger.Of(ledger.Char(s.C.ID), ledger.Staged(home, sg.Material)) != sg.Units {
				t.Fatalf("%s holds %+v", s.C.ID, sg)
			}
		}
	}
	if len(g.Story.Patterns) != boards || len(g.Story.Arcs) != arcs || len(patKinds(fs, "pattern.placed")) != 0 {
		t.Fatal("a staged board opened its row's chain")
	}
	if err := g.closeStage(st, closedEnded, g.Tick()); err != nil {
		t.Fatal(err)
	}
	if g.boardByID(st.Board) != b {
		t.Fatal("a solved staged board left the world at its close")
	}
	audit(t, g)
}

// TestStagedPatternCloses: an unsolved staged board leaves the world when
// its stage closes.
func TestStagedPatternCloses(t *testing.T) {
	g, c, home := houseGame(t)
	h, ok := patternTile(g, c, home, false)
	if !ok {
		t.Skip("no ground near server a's settlement takes the pattern")
	}
	st := stageAs(t, g, c, Command{Admin: true}, StageCmd{Template: sheets.StagePattern, Settlement: home, At: h, Pattern: stagedTriangle})
	if g.boardByID(st.Board) == nil {
		t.Fatal("no board")
	}
	if err := g.closeStage(st, closedEnded, g.Tick()); err != nil {
		t.Fatal(err)
	}
	if g.boardByID(st.Board) != nil {
		t.Fatal("an unsolved staged board outlived its stage")
	}
}
