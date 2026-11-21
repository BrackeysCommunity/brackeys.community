package puzzle

// Relay solder: Splice's trace cut into segments of Pass positions, each
// a seat's. At the end of a segment the iron lifts and passes, and the
// next seat sets it down at the joint.
const RelaySolder = "relay-solder"

func init() { registerParty(RelaySolder, Splice, relaySolder{}) }

type relaySolder struct{}

func (relaySolder) Lay(*Layout, Kit) {}

type solderPlay struct{ *splicePlay }

func (relaySolder) Start(l *Layout) Play {
	return &solderPlay{splice{}.Start(l).(*splicePlay)}
}

// structural: the iron is the one role.
const ironRole = 0

// ironAt is the seat that solders a position.
func (p *solderPlay) ironAt(i int64) int64 { return holder(ironRole, passTurn(p.l, i), p.l.Seats) }

// seatFor is the seat a move must come from: a drag solders the next
// position only, and a lift or set-down works on the next position past
// any gap.
func (p *solderPlay) seatFor(c int64) int64 {
	if c == spliceDrag {
		return p.ironAt(p.k)
	}
	return p.ironAt(p.across())
}

// Apply is Splice's, by the seat holding the iron; a solder that ends a
// segment lifts the iron for the next seat.
func (p *solderPlay) Apply(m Move) Status {
	if !seated(p.l, m) || !in(m.A, p.l.Size*p.l.Range) || !in(m.C, spliceDown+1) {
		return Broke
	}
	if m.Seat != p.seatFor(m.C) {
		return Going
	}
	before := p.k
	st := p.splicePlay.Apply(m)
	if st == Going && p.k > before && passTurn(p.l, p.k) != passTurn(p.l, p.k-1) {
		p.on = false
	}
	return st
}

// Snapshot is Splice's, then the seat holding the iron.
func (p *solderPlay) Snapshot() []int64 {
	return append(p.splicePlay.Snapshot(), p.ironAt(p.across()))
}

// Solve is Splice's, each move by the seat holding the iron; at every
// joint the iron is lifted, so the next seat sets it down.
func (relaySolder) Solve(l *Layout) Log {
	play := relaySolder{}.Start(l).(*solderPlay)
	var log Log
	add := func(m Move) Status {
		m.Seat = play.seatFor(m.C)
		log.Moves = append(log.Moves, m)
		return play.Apply(m)
	}
	var off int64
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

func (relaySolder) Deal(l *Layout) []Layout { return dealWhole(l) }
