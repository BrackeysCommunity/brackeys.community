package puzzle

// Tension and pick: one seat holds the tension lever while another lifts
// the next pin inside the window; every pin set passes both roles on.
const TensionAndPick = "tension-and-pick"

func init() { registerParty(TensionAndPick, Pins, tensionPick{}) }

// structural: the roles, and a pin move's kinds.
const (
	pickRole    = 0
	tensionRole = 1
	pinSet      = 0
	tensionOn   = 1
	tensionOff  = 2
	noTension   = -1
)

type tensionPick struct{}

func (tensionPick) Lay(*Layout, Kit) {}

type tensionPickPlay struct {
	untimed
	l   *Layout
	k   int64 // pins set
	ten int64 // ms the tension went on
}

func (tensionPick) Start(l *Layout) Play { return &tensionPickPlay{l: l, ten: noTension} }

func (p *tensionPickPlay) role(r int64) int64 { return holder(r, passTurn(p.l, p.k), p.l.Seats) }

func (p *tensionPickPlay) drop() { p.k, p.ten = 0, noTension }

func (p *tensionPickPlay) Apply(m Move) Status {
	l := p.l
	if !seated(l, m) || !in(m.A, l.Size+int64(len(l.False))) {
		return Broke
	}
	switch m.C {
	case tensionOn, tensionOff:
		if m.Seat != p.role(tensionRole) {
			return Going
		}
		if m.C == tensionOn {
			p.ten = m.At
		} else {
			p.drop()
		}
		return Going
	case pinSet:
		if m.Seat != p.role(pickRole) {
			return Going
		}
		if p.ten == noTension || m.At-p.ten > l.Window || m.A != l.Order[p.k] || m.B != l.Target[m.A] {
			p.drop()
			return Going
		}
		p.k++
		p.ten = noTension
		return until(p.k == l.Size)
	}
	return Broke
}

func (p *tensionPickPlay) Snapshot() []int64 { return []int64{p.k, p.ten} }

// Solve puts the tension on, then lifts the pin a press later, pin by pin.
func (tensionPick) Solve(l *Layout) Log {
	var ms []Move
	for k, pin := range l.Order {
		t, turn := int64(k)*partyStepMs, passTurn(l, int64(k))
		ms = append(ms, Move{At: t, C: tensionOn, Seat: holder(tensionRole, turn, l.Seats)},
			Move{At: t + pressMs, A: pin, B: l.Target[pin], C: pinSet, Seat: holder(pickRole, turn, l.Seats)})
	}
	return Log{Moves: ms}
}

func (tensionPick) Deal(l *Layout) []Layout { return dealWhole(l) }
