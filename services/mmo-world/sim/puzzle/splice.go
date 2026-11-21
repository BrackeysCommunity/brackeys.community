package puzzle

// Splice: solder along the trace from the left edge to the right, lifting
// over its gaps, while the loose end twitches. The board is Size columns
// by Range rows and a cell is row times Size plus column. Order is the
// trace's cells, False the positions in Order that are gaps, Track the
// step and rows of each twitch, and Par the steps of warning the scene
// gives before one.
const Splice = "splice"

func init() { register(Splice, splice{}) }

const (
	spStep = iota
	spShift
	spRow
)

// What C says of a move: the iron is lifted, dragged into cell A, or set
// down on cell A.
const (
	spliceLift = iota
	spliceDrag
	spliceDown
)

// structural: a trace has two ends and a gap is at most two positions;
// Solve's hand solders a position every 3 steps.
const (
	spliceEnds  = 2
	spliceGap   = 2
	spliceEvery = 3
)

type splice struct{}

func (splice) Keys() []string { return []string{"bend", "jitters", "jitter-gap", "warn"} }

func (splice) Lay(l *Layout, k Kit) {
	cols, rows := l.Size, l.Range
	bend := max(1, k.Tune("bend"))
	row := k.below(rows)
	lo, hi := row, row
	for col := range cols {
		l.Order = append(l.Order, row*cols+col)
		if col == cols-1 || !k.flip() {
			continue
		}
		dir := k.sign()
		if !in(row+dir, rows) {
			dir = -dir
		}
		for range 1 + k.below(bend) {
			if !in(row+dir, rows) {
				break
			}
			row += dir
			l.Order = append(l.Order, row*cols+col)
		}
		lo, hi = min(lo, row), max(hi, row)
	}
	// A gap is one or two positions, never an end of the trace and never
	// touching another gap.
	n := int64(len(l.Order))
	gap := make([]bool, n)
	for range l.Decoys {
		at := 1 + k.below(n-spliceEnds)
		length := 1 + k.below(spliceGap)
		fits := at+length < n
		for i := at - 1; fits && i <= at+length; i++ {
			fits = !gap[i]
		}
		for i := at; fits && i < at+length; i++ {
			gap[i] = true
		}
	}
	for i, g := range gap {
		if g {
			l.False = append(l.False, int64(i))
		}
	}
	// A twitch never carries the trace off the board.
	var off int64
	every := k.Tune("jitter-gap")
	for i := range k.Tune("jitters") {
		dy := k.sign()
		if lo+off+dy < 0 || hi+off+dy >= rows {
			dy = -dy
		}
		if lo+off+dy < 0 || hi+off+dy >= rows {
			continue
		}
		off += dy
		l.Track = append(l.Track, (i+1)*every, dy)
	}
	l.Par = []int64{k.Tune("warn")}
}

type splicePlay struct {
	clock
	l    *Layout
	gap  []bool
	k    int64 // positions soldered
	off  int64 // rows the loose end has shifted
	cur  int64 // the cell last soldered; -1 before the first
	on   bool  // the iron is down
	next int   // twitches past
}

func (splice) Start(l *Layout) Play {
	p := &splicePlay{clock: newClock(l), l: l, gap: make([]bool, len(l.Order)), cur: -1}
	for _, i := range l.False {
		p.gap[i] = true
	}
	return p
}

func (p *splicePlay) Run(at int64) (Status, int64) { return p.run(at, p.tick) }

func (p *splicePlay) tick(k int64) Status {
	t := p.l.Track
	for ; p.next*spRow < len(t) && t[p.next*spRow+spStep] <= k; p.next++ {
		p.off += t[p.next*spRow+spShift]
	}
	return Going
}

// cell is where a position not yet soldered sits now.
func (p *splicePlay) cell(i int64) int64 { return p.l.Order[i] + p.off*p.l.Size }

// across is the next position to solder, past any gap.
func (p *splicePlay) across() int64 {
	i := p.k
	for i < int64(len(p.gap)) && p.gap[i] {
		i++
	}
	return i
}

func (p *splicePlay) solder(i, cell int64) Status {
	p.k, p.cur, p.on = i+1, cell, true
	return until(p.k == int64(len(p.l.Order)))
}

// Apply moves the iron. Set down, it solders the next position past any
// gap, or picks up where it left off. Dragged, it solders the next
// position only; into any other cell it bridges the board.
func (p *splicePlay) Apply(m Move) Status {
	if !in(m.A, p.l.Size*p.l.Range) {
		return Broke
	}
	switch m.C {
	case spliceLift:
		p.on = false
	case spliceDown:
		switch i := p.across(); {
		case m.A == p.cell(i):
			return p.solder(i, m.A)
		case m.A == p.cur:
			p.on = true
		}
	case spliceDrag:
		switch {
		case !p.on:
		case !p.gap[p.k] && m.A == p.cell(p.k):
			return p.solder(p.k, m.A)
		case m.A != p.cur:
			return Broke
		}
	default:
		return Broke
	}
	return Going
}

// Snapshot is the positions soldered, the rows shifted, the cell last
// soldered, and 1 while the iron is down.
func (p *splicePlay) Snapshot() []int64 {
	var on int64
	if p.on {
		on = 1
	}
	return []int64{p.k, p.off, p.cur, on}
}

// Solve drags along the trace, and lifts to cross a gap or to follow a
// twitch.
func (f splice) Solve(l *Layout) Log {
	play := f.Start(l).(*splicePlay)
	var log Log
	add := func(m Move) Status {
		log.Moves = append(log.Moves, m)
		return play.Apply(m)
	}
	var off int64 // the shift the hand last soldered at
	for k := int64(spliceEvery); k < solveCap; k += spliceEvery {
		at := k * l.Step
		play.Run(at)
		i := play.across()
		m := Move{At: at, A: play.cell(i), C: spliceDrag}
		if !play.on || i != play.k || play.off != off {
			if play.on {
				add(Move{At: at, A: play.cur, C: spliceLift})
			}
			m.C = spliceDown
		}
		off = play.off
		if add(m) != Going {
			break
		}
	}
	return log
}

// Hints name the far side of each gap: the cell at rest in A, its
// position along the trace in B.
func (splice) Hints(l *Layout) []Move {
	var out []Move
	for j, i := range l.False {
		if j+1 < len(l.False) && l.False[j+1] == i+1 {
			continue
		}
		out = append(out, Move{A: l.Order[i+1], B: i + 1, C: spliceDown})
	}
	return out
}
