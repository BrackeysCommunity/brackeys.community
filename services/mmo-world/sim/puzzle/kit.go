package puzzle

import "jams.team/mmo-world/sim/draw"

// Family is one kind of machine: how its layout is drawn, and how a move
// log plays against it. A family is one file that registers itself.
type Family interface {
	// Lay fills the family's part of a layout. Family, Level, Tier, Size,
	// Decoys, Range and Step are already set.
	Lay(l *Layout, k Kit)
	// Start is the machine at rest.
	Start(l *Layout) Play
	// Solve is a log that solves the layout.
	Solve(l *Layout) Log
	// Hints are the moves a hint may show, most telling first.
	Hints(l *Layout) []Move
}

// Timed is a family whose model runs on the step clock. Keys are the
// tuning cells it reads, so a missing one is found before a machine is.
type Timed interface {
	Family
	Keys() []string
}

// Kit is what a generator draws from.
type Kit struct {
	S     *draw.Stream
	Tune  func(key string) int64 // the family's puzzles.tuning cell at this level
	Steps int64                  // model steps in the countdown at no practice
}

// structural: a coin has two faces, a half is one of two, and a Solve
// that is getting nowhere gives up after this many model steps.
const (
	coin     = 2
	halves   = 2
	solveCap = 1 << 16
)

// perm is a keyed permutation of [0, n).
func (k Kit) perm(n int64) []int64 {
	out := make([]int64, n)
	for i, x := range k.S.Perm(int(n)) {
		out[i] = int64(x)
	}
	return out
}

func (k Kit) below(n int64) int64 { return int64(k.S.Below(uint64(n))) }

func (k Kit) flip() bool { return k.below(coin) == 1 }

// sign is 1 or -1.
func (k Kit) sign() int64 { return 1 - coin*k.below(coin) }

// Play is a machine mid-solve.
type Play interface {
	// Run steps the model to at milliseconds since arming, and says when
	// its status changed. A family played move by move does nothing here.
	Run(at int64) (Status, int64)
	// Apply plays one move, after Run(m.At).
	Apply(m Move) Status
	// Snapshot is the state as numbers, for the golden vectors.
	Snapshot() []int64
}

// structural: a play is going, solved or broken.
type Status int

const (
	Going Status = iota
	Done
	Broke
)

var registry = map[string]Family{}

func register(id string, f Family) {
	if registry[id] != nil {
		panic("puzzle: family " + id + " registered twice")
	}
	registry[id] = f
}

// Keys are the tuning cells a family reads; none for a family with no
// model on the clock.
func Keys(family string) []string {
	if t, ok := registry[family].(Timed); ok {
		return t.Keys()
	}
	return nil
}

// Outcome is where a log left the machine: the family model's own answer,
// before a countdown is read against it. At is the solve's millisecond,
// or where the replay stopped.
type Outcome struct {
	Status Status `json:"status"`
	At     int64  `json:"at"`
	Master bool   `json:"master"` // the inner panel was solved too
}

// RunLog plays a log against a layout, and what is left of it after the
// solve against the inner panel when there is one. No move stamped past
// the horizon is played. see, when set, is shown the state after every
// move and once more when a panel's replay stops.
func RunLog(l Layout, inner *Layout, log Log, horizon int64, see func(at int64, state []int64)) Outcome {
	f := registry[l.Family]
	st, at, used := feed(f.Start(&l), log.Moves, log.End, horizon, 0, see)
	out := Outcome{Status: st, At: at}
	if st == Done && inner != nil && used < len(log.Moves) {
		ist, _, _ := feed(f.Start(inner), log.Moves[used:], log.End, horizon, at, see)
		out.Master = ist == Done
	}
	return out
}

// feed plays moves into one panel that was started at base ms, and
// reports its status, the ms it changed or stopped at, and the moves it
// took.
func feed(play Play, moves []Move, end, horizon, base int64, see func(int64, []int64)) (Status, int64, int) {
	stop := func(st Status, at int64, used int) (Status, int64, int) {
		if see != nil {
			see(base+at, play.Snapshot())
		}
		return st, base + at, used
	}
	var last int64
	for i, m := range moves {
		m.At -= base
		if m.At < last || m.At > horizon-base {
			return stop(Going, last, i)
		}
		if st, at := play.Run(m.At); st != Going {
			return stop(st, at, i)
		}
		last = m.At
		st := play.Apply(m)
		if see != nil {
			see(base+m.At, play.Snapshot())
		}
		if st != Going {
			return stop(st, m.At, i+1)
		}
	}
	st, at := play.Run(min(max(end-base, last), horizon-base))
	return stop(st, at, len(moves))
}

// Solve is the moves that solve a layout. For a family played move by
// move they come one a second, as they always have; for a family on the
// clock the moves alone do not say when to stop, and Puzzles.Solve does.
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

// untimed is a machine played move by move: the clock does nothing to it.
type untimed struct{}

func (untimed) Run(at int64) (Status, int64) { return Going, at }

// structural: Solve's hand presses four times a second.
const pressMs = 250

// presses is a log pressed at Solve's pace.
type presses []Move

func (p *presses) add(a, b, c int64) {
	*p = append(*p, Move{At: int64(len(*p)) * pressMs, A: a, B: b, C: c})
}

func in(x, n int64) bool { return x >= 0 && x < n }

// until is Done once a solve is complete, Going before.
func until(done bool) Status {
	if done {
		return Done
	}
	return Going
}
