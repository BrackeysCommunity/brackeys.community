package puzzle

import "slices"

// Panel array: Scrub's plate cut into bands of rows, one a seat. Every
// Pass rubs on a panel blow a layer of grit onto the next seat's reading.
const PanelArray = "panel-array"

func init() { registerParty(PanelArray, Scrub, panelArray{}) }

type panelArray struct{}

func (panelArray) Lay(*Layout, Kit) {}

// panelOf is the panel, and the seat, a cell is in.
func panelOf(cell, side, seats int64) int64 { return cell / side * seats / side }

type panelPlay struct {
	*scrubPlay
	rubs []int64 // rubs on each panel
}

func (panelArray) Start(l *Layout) Play {
	return &panelPlay{scrubPlay: scrub{}.Start(l).(*scrubPlay), rubs: make([]int64, l.Seats)}
}

// Apply is Scrub's rub by the panel's seat; every Pass-th rub on a panel
// dirties the first clean cell of the next panel's reading.
func (p *panelPlay) Apply(m Move) Status {
	l := p.l
	if !seated(l, m) || !in(m.A, int64(len(p.grit))) {
		return Broke
	}
	panel := panelOf(m.A, l.Size, l.Seats)
	if m.Seat != panel {
		return Going
	}
	if p.scrubPlay.Apply(m) == Broke {
		return Broke
	}
	p.rubs[panel]++
	if l.Pass > 0 && p.rubs[panel]%l.Pass == 0 {
		next := (panel + 1) % l.Seats
		for _, c := range l.Target {
			if panelOf(c, l.Size, l.Seats) == next && p.grit[c] == 0 {
				p.grit[c] = min(l.Init[c], p.grit[c]+1)
				break
			}
		}
	}
	return until(!slices.ContainsFunc(l.Target, func(c int64) bool { return p.grit[c] > 0 }))
}

// Snapshot is every cell's grit, then each panel's rubs.
func (p *panelPlay) Snapshot() []int64 { return slices.Concat(p.grit, p.rubs) }

// Solve has every seat rub the first dirty cell of its panel's reading,
// together, at Scrub's pace.
func (panelArray) Solve(l *Layout) Log {
	play := panelArray{}.Start(l).(*panelPlay)
	var log Log
	for k := int64(scrubEvery); k < solveCap; k += scrubEvery {
		at := k * l.Step
		play.Run(at)
		rubbed := false
		for s := range l.Seats {
			i := slices.IndexFunc(l.Target, func(c int64) bool {
				return panelOf(c, l.Size, l.Seats) == s && play.grit[c] > 0
			})
			if i < 0 {
				continue
			}
			rubbed = true
			m := Move{At: at, A: l.Target[i], Seat: s}
			log.Moves = append(log.Moves, m)
			if play.Apply(m) != Going {
				return log
			}
		}
		if !rubbed {
			break
		}
	}
	return log
}

func (panelArray) Deal(l *Layout) []Layout { return dealWhole(l) }
