package puzzle

// Generate lays out a machine. The same place, beat, family, level and
// tier always give the same machine.
func (p *Puzzles) Generate(family string, level, tier int64, w Where) Layout {
	return p.Make(Spec{Family: family, Level: level, Tier: tier, Place: w.Place, Beat: w.Beat})
}

// Replay plays a move log against a layout and a countdown, with no
// server clock and no inner panel, as the pinned vectors were made.
func (p *Puzzles) Replay(l Layout, moves []Move, countdown int64, w Where) Result {
	out := RunLog(l, nil, Log{Moves: moves}, countdown+p.Grace(), nil)
	return p.judge(out, Result{Haywire: p.Haywire(l.Family, w)}, countdown, -1)
}

// Solve is the moves that solve a layout, restamped one a second for a
// family played move by move. For a family on the clock the moves alone
// do not say when to stop; Puzzles.Solve does.
func Solve(l Layout) []Move {
	f := registry[l.Family]
	moves := f.Solve(&l).Moves
	if _, ok := f.(Timed); !ok {
		for i := range moves {
			moves[i].At = int64(i) * msPerSecond
		}
	}
	return moves
}
