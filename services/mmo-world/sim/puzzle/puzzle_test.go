package puzzle_test

import (
	"slices"
	"testing"

	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/puzzle"
)

func puzzles(t *testing.T) *puzzle.Puzzles {
	t.Helper()
	b, err := sheetfs.LoadBook(sheetfs.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	return puzzle.New(b, keys.Throwaway("puzzle-test").Generation)
}

// Every family's layouts are solvable, the solving log replays into a
// solve, and an empty or late log haywires.
func TestReplay(t *testing.T) {
	p := puzzles(t)
	for _, fam := range firstEight {
		for level := int64(1); level <= 9; level++ {
			for tier := int64(1); tier <= 4; tier++ {
				w := puzzle.Where{Place: "tile:3,-2", Beat: level*10 + tier}
				l := p.Generate(fam, level, tier, w)
				cd := p.Countdown(fam, level, tier, 0)
				moves := puzzle.Solve(l)
				for i := range moves {
					moves[i].At = int64(i) * 100
				}
				if r := p.Replay(l, moves, cd, w); !r.Solved {
					t.Fatalf("%s level %d tier %d: solving log did not solve: %+v (%d moves)", fam, level, tier, r, len(moves))
				}
				if r := p.Replay(l, nil, cd, w); r.Solved || r.Haywire == "" {
					t.Fatalf("%s: an empty log solved: %+v", fam, r)
				}
				late := slices.Clone(moves)
				for i := range late {
					late[i].At = cd + p.Param("network-grace")*1000 + 1 + int64(i)
				}
				if r := p.Replay(l, late, cd, w); r.Solved {
					t.Fatalf("%s: a late log solved", fam)
				}
				if again := p.Generate(fam, level, tier, w); !slices.Equal(again.Target, l.Target) || !slices.Equal(again.Order, l.Order) || !slices.Equal(again.Walls, l.Walls) || !slices.Equal(again.Turn, l.Turn) {
					t.Fatalf("%s: layout not deterministic", fam)
				}
			}
		}
	}
}

// A move out of range breaks the machine instead of the process.
func TestReplayRejectsWildMoves(t *testing.T) {
	p := puzzles(t)
	for _, fam := range firstEight {
		w := puzzle.Where{Place: "tile:0,0", Beat: 1}
		l := p.Generate(fam, 3, 2, w)
		cd := p.Countdown(fam, 3, 2, 0)
		for _, a := range []int64{-1, -1 << 40, 1 << 40} {
			for _, b := range []int64{0, -1, 1 << 40} {
				if r := p.Replay(l, []puzzle.Move{{A: a, B: b, C: b}}, cd, w); r.Solved {
					t.Fatalf("%s: move a=%d b=%d solved", fam, a, b)
				}
			}
		}
	}
}

func TestCountdownAndRewireWires(t *testing.T) {
	p := puzzles(t)
	// GDD 7.11: Rewire 40 s at level 1; +3 s a level; -15% a tier above 1.
	if got := p.Countdown(puzzle.Rewire, 1, 1, 0); got != 40000 {
		t.Fatalf("rewire level 1 tier 1: %d ms", got)
	}
	if got := p.Countdown(puzzle.Rewire, 3, 2, 0); got != 39100 {
		t.Fatalf("rewire level 3 tier 2: %d ms", got)
	}
	if got := p.Countdown(puzzle.Rewire, 1, 1, 10); got != 52000 {
		t.Fatalf("practice 10 adds 10%% and 20%%: %d ms", got)
	}
	for level, want := range map[int64]int64{1: 3, 7: 9} {
		if l := p.Generate(puzzle.Rewire, level, 1, puzzle.Where{Place: "x"}); l.Size != want {
			t.Fatalf("rewire level %d: %d wires, want %d", level, l.Size, want)
		}
	}
}

func TestCleanSolveAndHaul(t *testing.T) {
	p := puzzles(t)
	w := puzzle.Where{Place: "floor:d/1", Beat: 2}
	l := p.Generate(puzzle.Fuse, 2, 1, w)
	cd := p.Countdown(puzzle.Fuse, 2, 1, 0)
	r := p.Replay(l, puzzle.Solve(l), cd, w)
	if !r.Solved || !r.Clean || p.HaulPercent(r) != 125 {
		t.Fatalf("a quick solve is clean and hauls 125%%: %+v", r)
	}
	wrong := puzzle.Solve(l)
	wrong[0].A = (wrong[0].A + 1) % l.Size
	if r := p.Replay(l, wrong, cd, w); r.Solved {
		t.Fatal("a fuse pulled out of order solved")
	}
}

func TestSolveRate(t *testing.T) {
	p := puzzles(t)
	// 75% less 3% a level and 8% a tier: 27% at level 9, tier 4.
	low := p.SolveRate(puzzle.Rewire, 0, 9, 4, 1)
	high := p.SolveRate(puzzle.Rewire, 20, 1, 1, 4)
	if low.String() != "0.27" || high.String() != "0.95" {
		t.Fatalf("solve rate %s to %s, want 0.27 to the 0.95 ceiling", low, high)
	}
}
