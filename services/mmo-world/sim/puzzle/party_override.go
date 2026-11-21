package puzzle

// Call and answer: one seat holds the keypad and presses Override's
// growing sequence; every symbol of it is dealt to one seat, who calls it
// to the others. The keypad passes on each round.
const CallAndAnswer = "call-and-answer"

func init() { registerParty(CallAndAnswer, Override, callAndAnswer{}) }

// Move codes: a press on the keypad, and a call of a symbol to the others.
const (
	overridePress = iota
	overrideCall
)

// structural: the keypad is role 0.
const keypadRole = 0

type callAndAnswer struct{}

func (callAndAnswer) Lay(*Layout, Kit) {}

type callPlay struct {
	*overridePlay
	l      *Layout
	rounds int64 // rounds pressed in full
	ends   int64 // the presses that end the round under way
}

func (callAndAnswer) Start(l *Layout) Play {
	return &callPlay{overridePlay: override{}.Start(l).(*overridePlay), l: l, ends: 1}
}

// Apply is a press by the keypad's seat, as solo, or a call, which only
// shows the others a symbol and so changes nothing here.
func (p *callPlay) Apply(m Move) Status {
	if !seated(p.l, m) || !in(m.A, p.l.Range) {
		return Broke
	}
	switch m.C {
	case overrideCall:
		return Going
	case overridePress:
	default:
		return Broke
	}
	if m.Seat != holder(keypadRole, passTurn(p.l, p.rounds), p.l.Seats) {
		return Going
	}
	st := p.overridePlay.Apply(m)
	if st == Going && p.k == p.ends {
		p.rounds++
		p.ends += p.rounds + 1
	}
	return st
}

// Solve calls each symbol from the seat dealt it, and presses it from the
// keypad at the same moment.
func (callAndAnswer) Solve(l *Layout) Log {
	var log Log
	var at int64
	for r := range l.Size {
		keypad := holder(keypadRole, passTurn(l, r), l.Seats)
		for j, x := range l.Order[:r+1] {
			log.Moves = append(log.Moves,
				Move{At: at, A: x, C: overrideCall, Seat: int64(j) % l.Seats},
				Move{At: at, A: x, C: overridePress, Seat: keypad})
			at += pressMs
		}
	}
	return log
}

// Deal shows each seat the symbols dealt to it.
func (callAndAnswer) Deal(l *Layout) []Layout {
	out := dealWhole(l)
	for s := range out {
		out[s].Order = hideBut(l.Order, func(i int64) bool { return i%l.Seats == int64(s) })
	}
	return out
}
