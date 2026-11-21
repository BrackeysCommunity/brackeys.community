package puzzle

import (
	"maps"
	"math"
	"slices"

	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/sheets"
)

// structural: how a puzzles.party row sizes its machine other than at the
// family's size.
const (
	sizeByFixed = "fixed"
	sizeBySeats = "seats"
	// partyMinSeats is the fewest hands a party machine is laid out for;
	// sizes grow per seat past it.
	partyMinSeats = 2
	// partyStepMs is a Solve's step when each step is two presses.
	partyStepMs = 2 * pressMs
)

// partyRow is a party version's puzzles.party row. An unknown version is
// a caller's mistake, as an unknown family is.
func (p *Puzzles) partyRow(id string) (*sheets.PartyVersion, PartyRule) {
	row, rule := p.party[id], partyRule(id)
	if row == nil || rule == nil {
		panic("puzzle: no party version " + id)
	}
	return row, rule
}

// partySize is a party machine's size and decoys: the row's, grown per
// seat past two.
func (p *Puzzles) partySize(row *sheets.PartyVersion, s Spec) (int64, int64) {
	n, dec := p.size(s.Family, s.Level, s.Shape, false)
	switch row.SizeBy {
	case sizeByFixed:
		n = row.Size
	case sizeBySeats:
		n *= s.Seats
	}
	more := s.Seats - partyMinSeats
	return n + row.Extra*more, dec + row.Decoys*more
}

func init() { layParty = (*Puzzles).makeParty }

// makeParty lays out a party machine at the row's size. The family lays
// its part on the version's own stream, then the version adds its own on
// a second one, so a change to either moves only its own draws. The step
// count is the party countdown's.
func (p *Puzzles) makeParty(s Spec) Layout {
	row, rule := p.partyRow(s.Party)
	if s.Seats < partyMinSeats {
		panic("puzzle: party version " + s.Party + " needs two seats or more")
	}
	n, dec := p.partySize(row, s)
	l := Layout{Family: s.Family, Level: s.Level, Tier: s.Tier, Size: n, Decoys: dec, Range: p.layouts[s.Family].Range,
		Shape: s.Shape, Party: s.Party, Seats: s.Seats, Window: row.Window, Pass: row.Pass}
	if r := p.shapeRow(s.Family, s.Shape); r != nil && r.Range > 0 {
		l.Range = r.Range
	}
	f := registry[s.Family]
	if _, ok := f.(Timed); ok {
		l.Step = stepMs
	}
	parts := append(s.layParts(), draw.Str(s.Party), draw.Int(s.Seats), draw.Int(s.Shape), draw.Int(s.Attempt))
	k := Kit{
		S:     p.gen.Stream("puzzle.party", parts...),
		Tune:  func(key string) int64 { return p.tune(s.Family, key, s.Level) },
		Steps: p.PartyCountdown(s, 0) / stepMs,
	}
	f.Lay(&l, k)
	k.S = p.gen.Stream("puzzle.party", append(parts, draw.Str("rule"))...)
	rule.Lay(&l, k)
	return l
}

// PartyCountdown is a party machine's countdown in milliseconds: the row's
// percent of the solo countdown at the best practice among its seats.
func (p *Puzzles) PartyCountdown(s Spec, practice int64) int64 {
	row, _ := p.partyRow(s.Party)
	return fixed.PercentOf(p.Countdown(s.Family, s.Level, s.Tier, practice), row.Countdown)
}

// PartyVersion draws the party version a family's machine takes when
// several hands meet it, by the rows' weights; "" when it has none.
func (p *Puzzles) PartyVersion(family string, w Where) string {
	var ids []string
	var weights []int64
	for _, id := range slices.Sorted(maps.Keys(p.party)) {
		if r := p.party[id]; r.Family == family && r.Weight > 0 {
			ids, weights = append(ids, id), append(weights, r.Weight)
		}
	}
	switch len(ids) {
	case 0:
		return ""
	case 1:
		return ids[0]
	}
	return ids[p.gen.Pick(weights, "puzzle.party-version", w.parts(family)...)]
}

// Deal is each seat's view of the machine a spec names, in seat order. A
// solo machine has one seat, which sees all of it.
func (p *Puzzles) Deal(s Spec) []Layout {
	l := p.Make(s)
	if s.Party == "" {
		return []Layout{l}
	}
	return partyRule(s.Party).Deal(&l)
}

// Probe replays a log so far, with no countdown read against it: whether
// the machine is solved, broken or still going. A log past the most moves
// a play may hold is broken, as Play fails it.
func (p *Puzzles) Probe(s Spec, log Log) Status {
	if int64(len(log.Moves)) > p.Param("max-moves") {
		return Broke
	}
	return run(p.Make(s), nil, log, math.MaxInt64).Status
}

// run replays a log on a laid-out machine, by the party rule when it is
// a party's.
func run(l Layout, inner *Layout, log Log, horizon int64) Outcome {
	if l.Party != "" {
		return RunParty(l, log, horizon, nil)
	}
	return RunLog(l, inner, log, horizon, nil)
}

// RunParty plays a merged log against a party layout, as RunLog does a
// solo one.
func RunParty(l Layout, log Log, horizon int64, see func(at int64, state []int64)) Outcome {
	st, at, _ := feed(partyRule(l.Party).Start(&l), log.Moves, log.End, horizon, 0, see)
	return Outcome{Status: st, At: at}
}

// PartySolve is the version's merged log that solves a party layout,
// stopped at the solve.
func (p *Puzzles) PartySolve(l Layout) Log {
	r := partyRule(l.Party)
	log := r.Solve(&l)
	_, at, used := feed(r.Start(&l), log.Moves, log.End, math.MaxInt64, 0, nil)
	out := Log{Moves: log.Moves[:used]}
	if at > out.Stop() {
		out.End = at
	}
	return out
}

// holder is the seat holding role r once the roles have passed turn
// times.
func holder(r, turn, seats int64) int64 { return (r + turn) % seats }

// passTurn is how many times the roles have passed after progress.
func passTurn(l *Layout, progress int64) int64 {
	if l.Pass <= 0 {
		return 0
	}
	return progress / l.Pass
}

// seated reports whether a move names a seat the machine has.
func seated(l *Layout, m Move) bool { return in(m.Seat, l.Seats) }

// cloneLayout is a copy that shares no slice with l.
func cloneLayout(l *Layout) Layout {
	c := *l
	for _, xs := range []*[]int64{&c.Target, &c.Glyph, &c.Order, &c.False, &c.Turn, &c.Walls, &c.Tiles,
		&c.Par, &c.Init, &c.Track, &c.Key, &c.Code} {
		*xs = slices.Clone(*xs)
	}
	c.Clues = slices.Clone(c.Clues)
	return c
}

// dealWhole shows every seat the whole machine.
func dealWhole(l *Layout) []Layout {
	out := make([]Layout, l.Seats)
	for i := range out {
		out[i] = cloneLayout(l)
	}
	return out
}

// hideBut hides every element of xs but those keep picks.
func hideBut(xs []int64, keep func(i int64) bool) []int64 {
	out := slices.Clone(xs)
	for i := range out {
		if !keep(int64(i)) {
			out[i] = Unseen
		}
	}
	return out
}
