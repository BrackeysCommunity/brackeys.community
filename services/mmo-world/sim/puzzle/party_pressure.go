package puzzle

import "slices"

// Boiler room: Pressure with every needle coupled to every valve, and each
// valve in one seat's hands. No seat can settle its own needle without
// pushing everyone else's, on either shape.
const BoilerRoom = "boiler-room"

func init() { registerParty(BoilerRoom, Pressure, boilerRoom{}) }

type boilerRoom struct{}

// coupleAll turns valve a: its own needle moves by nudge, and every other
// needle by couple the other way.
func coupleAll(v []int64, a, dir, nudge, couple int64) {
	for b := range v {
		if int64(b) == a {
			v[b] += dir * nudge
		} else {
			v[b] -= dir * couple
		}
	}
}

// valveSeat is the seat that holds a valve.
func valveSeat(a, seats int64) int64 { return a % seats }

// Lay scrambles the machine again from the middle of the band, as
// Pressure's Lay does, with every needle coupled.
func (boilerRoom) Lay(l *Layout, k Kit) {
	n, par := l.Size, l.Par
	lo, hi, nudge, couple := par[prLo], par[prHi], par[prNudge], par[prCouple]
	x := make([]int64, n)
	for i := range x {
		x[i] = (lo + hi) / halves
	}
	if par[prLeak] > 0 {
		x[l.Goal] = hi - 1
	}
	l.Order, l.Turn = nil, nil
	turn := func(a, dir int64) bool {
		y := slices.Clone(x)
		coupleAll(y, a, dir, nudge, couple)
		if slices.Min(y) < 1 || slices.Max(y) > l.Range-1 {
			return false
		}
		x = y
		l.Order, l.Turn = append(l.Order, a), append(l.Turn, dir)
		return true
	}
	for range l.Decoys {
		a, dir := k.below(n), k.sign()
		if !turn(a, dir) {
			turn(a, -dir)
		}
	}
	w, dir := int64(0), int64(1)
	if l.Goal == w {
		w++
	}
	for range l.Range {
		if !settles(x, l) {
			break
		}
		if !turn(w, dir) {
			dir = -dir
			if !turn(w, dir) {
				break
			}
		}
	}
	l.Init = x
}

type boilerPlay struct{ *pressurePlay }

func (boilerRoom) Start(l *Layout) Play {
	return &boilerPlay{pressure{}.Start(l).(*pressurePlay)}
}

// Apply is Pressure's turn with every needle coupled, by the valve's seat.
func (p *boilerPlay) Apply(m Move) Status {
	l := p.l
	if !seated(l, m) || !in(m.A, l.Size) || (m.B != 1 && m.B != -1) {
		return Broke
	}
	if m.Seat != valveSeat(m.A, l.Seats) {
		return Going
	}
	coupleAll(p.v, m.A, m.B, l.Par[prNudge], l.Par[prCouple])
	for i, x := range p.v {
		p.v[i] = max(0, x)
		if x >= l.Range {
			return Broke
		}
	}
	return Going
}

// Solve is Pressure's, each turn by the valve's seat: the turns undo
// exactly, whatever couples them.
func (boilerRoom) Solve(l *Layout) Log {
	log := pressure{}.Solve(l)
	for i := range log.Moves {
		log.Moves[i].Seat = valveSeat(log.Moves[i].A, l.Seats)
	}
	return log
}

func (boilerRoom) Deal(l *Layout) []Layout { return dealWhole(l) }
