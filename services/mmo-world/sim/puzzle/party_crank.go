package puzzle

// Tandem winch: two of Crank's dynamos, wound by two seats, that charge
// only while both run in the band together. The cranks change hands every
// Pass milliseconds.
const TandemWinch = "tandem-winch"

func init() { registerParty(TandemWinch, Crank, tandemWinch{}) }

// structural: a tandem winch has two cranks.
const winchCranks = 2

type tandemWinch struct{}

func (tandemWinch) Lay(*Layout, Kit) {}

type winchPlay struct {
	clock
	l      *Layout
	cr     [winchCranks]*crankPlay
	charge int64 // steps both cranks spent in the band together
}

func (tandemWinch) Start(l *Layout) Play {
	p := &winchPlay{clock: newClock(l), l: l}
	for c := range p.cr {
		p.cr[c] = crank{}.Start(l).(*crankPlay)
	}
	return p
}

func (p *winchPlay) Run(at int64) (Status, int64) { return p.run(at, p.tick) }

// tick drags each crank as Crank's tick does; the charge is the pair's.
func (p *winchPlay) tick(k int64) Status {
	par := p.l.Par
	lo, hi := par[crLo], par[crHi]
	both := true
	for _, c := range p.cr {
		c.tick(k)
		both = both && c.speed >= lo && c.speed <= hi
	}
	if gap := p.cr[0].speed - p.cr[1].speed; both && max(gap, -gap) <= hi-lo {
		p.charge++
	}
	return until(p.charge >= par[crNeed])
}

// crankSeat is the seat winding a crank at a moment.
func (p *winchPlay) crankSeat(c, at int64) int64 {
	return holder(c, passTurn(p.l, at), p.l.Seats)
}

// Apply is Crank's quarter turn on crank B, by the seat winding it.
func (p *winchPlay) Apply(m Move) Status {
	if !seated(p.l, m) || !in(m.B, winchCranks) || m.A != crankTurn {
		return Broke
	}
	if m.Seat != p.crankSeat(m.B, m.At) {
		return Going
	}
	return p.cr[m.B].Apply(m)
}

// Snapshot is each crank's speed, then the charge.
func (p *winchPlay) Snapshot() []int64 {
	return []int64{p.cr[0].speed, p.cr[1].speed, p.charge}
}

// Solve is Crank's for each crank: a turn whenever its speed has dropped
// under the middle of the band, by the seat winding it then.
func (tandemWinch) Solve(l *Layout) Log {
	play := tandemWinch{}.Start(l).(*winchPlay)
	var log Log
	for k := range int64(solveCap) {
		at := k * l.Step
		if st, _ := play.Run(at); st != Going {
			log.End = at
			break
		}
		for c := range int64(winchCranks) {
			if play.cr[c].speed < l.Range/halves {
				m := Move{At: at, A: crankTurn, B: c, Seat: play.crankSeat(c, at)}
				play.Apply(m)
				log.Moves = append(log.Moves, m)
			}
		}
	}
	return log
}

func (tandemWinch) Deal(l *Layout) []Layout { return dealWhole(l) }
