package puzzle

// Bomb squad: every seat holds some of the clues and nobody holds the
// order; one seat at a time holds the cutters, passing them on every few
// fuses, and pulls while the others read their clues out.
const BombSquad = "bomb-squad"

func init() { registerParty(BombSquad, Fuse, bombSquad{}) }

// structural: the one role, the cutters.
const cutterRole = 0

type bombSquad struct{}

func (bombSquad) Lay(*Layout, Kit) {}

type bombSquadPlay struct {
	untimed
	l    *Layout
	fuse Play
	k    int64 // fuses pulled
}

func (bombSquad) Start(l *Layout) Play { return &bombSquadPlay{l: l, fuse: registry[Fuse].Start(l)} }

func cutter(l *Layout, pulled int64) int64 { return holder(cutterRole, passTurn(l, pulled), l.Seats) }

// Apply is solo's pull of fuse A, by the seat holding the cutters.
func (p *bombSquadPlay) Apply(m Move) Status {
	if !seated(p.l, m) || !in(m.A, p.l.Size) {
		return Broke
	}
	if m.Seat != cutter(p.l, p.k) {
		return Going
	}
	st := p.fuse.Apply(m)
	if st != Broke {
		p.k++
	}
	return st
}

func (p *bombSquadPlay) Snapshot() []int64 { return p.fuse.Snapshot() }

// Solve pulls the order, each fuse by the cutter of the moment.
func (bombSquad) Solve(l *Layout) Log {
	var ms []Move
	for k, f := range l.Order {
		ms = append(ms, Move{At: int64(k) * pressMs, A: f, Seat: cutter(l, int64(k))})
	}
	return Log{Moves: ms}
}

// Deal gives clue i to seat i mod seats; nobody is dealt the order.
func (bombSquad) Deal(l *Layout) []Layout {
	out := dealWhole(l)
	for s := range out {
		out[s].Order = nil
		for i := range out[s].Clues {
			if int64(i)%l.Seats != int64(s) {
				out[s].Clues[i] = Clue{Before: Unseen, After: Unseen}
			}
		}
	}
	return out
}
