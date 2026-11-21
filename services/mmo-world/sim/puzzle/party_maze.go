package puzzle

// Two-axis tilt: each seat tilts the maze along its own axis only, and
// the axes pass round the seats as the bit rolls.
const TwoAxisTilt = "two-axis-tilt"

func init() { registerParty(TwoAxisTilt, Maze, twoAxis{}) }

// structural: a square maze tilts along two axes, a hex maze (shape 1)
// along three; each axis is a side and its opposite.
const (
	squareAxes = 2
	hexAxes    = 3
	hexMaze    = 1
	axisSides  = 2
)

func tiltAxes(l *Layout) int64 {
	if l.Shape == hexMaze {
		return hexAxes
	}
	return squareAxes
}

type twoAxis struct{}

func (twoAxis) Lay(*Layout, Kit) {}

type twoAxisPlay struct {
	untimed
	l     *Layout
	maze  Play
	rolls int64 // tilts that moved the bit
}

func (twoAxis) Start(l *Layout) Play { return &twoAxisPlay{l: l, maze: registry[Maze].Start(l)} }

func (p *twoAxisPlay) tilter(side int64) int64 {
	return holder(side%tiltAxes(p.l), passTurn(p.l, p.rolls), p.l.Seats)
}

// Apply is solo's tilt toward side A, by the seat holding its axis.
func (p *twoAxisPlay) Apply(m Move) Status {
	if !seated(p.l, m) || !in(m.A, tiltAxes(p.l)*axisSides) {
		return Broke
	}
	if m.Seat != p.tilter(m.A) {
		return Going
	}
	from := p.maze.Snapshot()[0]
	st := p.maze.Apply(m)
	if p.maze.Snapshot()[0] != from {
		p.rolls++
	}
	return st
}

func (p *twoAxisPlay) Snapshot() []int64 { return append(p.maze.Snapshot(), p.rolls) }

// Solve is solo's shortest path, each tilt made by its axis's holder.
func (twoAxis) Solve(l *Layout) Log {
	play := twoAxis{}.Start(l).(*twoAxisPlay)
	var ms []Move
	for i, m := range registry[Maze].Solve(l).Moves {
		m.At, m.Seat = int64(i)*pressMs, play.tilter(m.A)
		play.Apply(m)
		ms = append(ms, m)
	}
	return Log{Moves: ms}
}

func (twoAxis) Deal(l *Layout) []Layout { return dealWhole(l) }
