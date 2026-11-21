package puzzle

// Split grid: the board is cut into one region a seat, each seat turns
// only its own tiles, and the power has to cross the seams.
const SplitGrid = "split-grid"

func init() { registerParty(SplitGrid, Circuit, splitGrid{}) }

// structural: four seats share the board in quarters, two columns of
// two; fewer share it in columns.
const (
	gridQuarterSeats = 4
	gridQuarterSide  = 2
)

// gridRegion is the seat whose region cell c is in. A hex board's cells
// sit on the same rhombus indices.
func gridRegion(l *Layout, c int64) int64 {
	n := l.Size
	x, y := c%n, c/n
	if l.Seats == gridQuarterSeats {
		return x*gridQuarterSide/n + gridQuarterSide*(y*gridQuarterSide/n)
	}
	return x * l.Seats / n
}

type splitGrid struct{}

func (splitGrid) Lay(*Layout, Kit) {}

type splitGridPlay struct {
	untimed
	l    *Layout
	grid Play
}

func (splitGrid) Start(l *Layout) Play { return &splitGridPlay{l: l, grid: registry[Circuit].Start(l)} }

// Apply is solo's turn of tile A, by the seat whose region it is in.
func (p *splitGridPlay) Apply(m Move) Status {
	if !seated(p.l, m) || !in(m.A, p.l.Size*p.l.Size) {
		return Broke
	}
	if m.Seat != gridRegion(p.l, m.A) {
		return Going
	}
	return p.grid.Apply(m)
}

func (p *splitGridPlay) Snapshot() []int64 { return p.grid.Snapshot() }

// Solve is solo's turns, each made by the tile's region's seat.
func (splitGrid) Solve(l *Layout) Log {
	var ms []Move
	for i, m := range registry[Circuit].Solve(l).Moves {
		m.At, m.Seat = int64(i)*pressMs, gridRegion(l, m.A)
		ms = append(ms, m)
	}
	return Log{Moves: ms}
}

func (splitGrid) Deal(l *Layout) []Layout { return dealWhole(l) }
