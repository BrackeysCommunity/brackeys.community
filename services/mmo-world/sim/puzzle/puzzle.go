// Package puzzle is the machine puzzle, headless: a layout generated from
// a keyed draw over where the machine is, the beat and the family; the
// countdown; and a move log replayed against both into one result
// (GDD 7.11). The client plays the puzzle for smoothness; the server's
// replay is what counts.
package puzzle

import (
	"maps"
	"slices"

	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tags"
)

// structural: milliseconds in a second; a percentage is hundredths; a
// square grid has four sides.
const (
	msPerSecond = 1000
	percent     = fixed.Hundredths
	sides       = 4
	halfTurn    = 2
)

// Family ids, as puzzles.families names them.
const (
	Rewire   = "rewire"
	Pins     = "lock-pins"
	Dial     = "lock-dial"
	Maze     = "lock-maze"
	Circuit  = "circuit"
	Signal   = "signal"
	Fuse     = "fuse"
	Override = "override"
)

// Puzzles holds the Puzzles sheets and the generation key.
type Puzzles struct {
	families map[string]*sheets.PuzzleFamily
	layouts  map[string]*sheets.PuzzleLayout
	haywires map[string]*sheets.Haywire
	gifts    []sheets.PracticeGift
	params   []sheets.Param
	gen      *draw.Drawer
}

func New(b *sheets.Book, genKey draw.Key) *Puzzles {
	p := &Puzzles{families: sheets.Lookup(b.PuzzleFamilies), haywires: sheets.Lookup(b.Haywires),
		gifts: b.PuzzlePractice, params: b.PuzzleParams, layouts: map[string]*sheets.PuzzleLayout{}, gen: draw.NewDrawer(genKey)}
	for i := range b.PuzzleLayouts {
		p.layouts[b.PuzzleLayouts[i].Family] = &b.PuzzleLayouts[i]
	}
	return p
}

func (p *Puzzles) Param(id string) int64 { return sheets.IntParam(p.params, id) }

func (p *Puzzles) Family(id string) *sheets.PuzzleFamily { return p.families[id] }

// Where identifies a machine: the tile or dungeon floor, and the beat.
type Where struct {
	Place string // "tile:q,r" or "floor:<dungeon>/<n>"
	Beat  int64
}

func (w Where) parts(family string) []draw.Part {
	return []draw.Part{draw.Str(w.Place), draw.Int(w.Beat), draw.Str(family)}
}

// Level is a machine's family level: within its tier's band, keyed, and
// one more per so many dungeon floors.
func (p *Puzzles) Level(family string, tier, floor int64, w Where) int64 {
	lo := p.Param("level-per-tier")*tier - 1
	span := p.Param("level-span")
	lvl := lo + int64(p.gen.Below(uint64(span+1), "puzzle.level", w.parts(family)...))
	return lvl + floor/p.Param("floors-per-level")
}

// Gifts sums what a practice level buys: extra countdown and hints.
type Gifts struct {
	Preview, GuideLine, Glimpse, Mastery bool
	Countdown                            int64 // percent
	Hints                                int64
}

func (p *Puzzles) Gifts(practice int64) Gifts {
	var g Gifts
	for _, x := range p.gifts {
		if practice < x.Practice {
			continue
		}
		switch x.Gives {
		case "preview":
			g.Preview = true
		case "countdown":
			g.Countdown += x.Percent
		case "hint":
			g.Hints++
		case "guide-line":
			g.GuideLine = true
		case "partner-glimpse":
			g.Glimpse = true
		case "mastery":
			g.Mastery = true
		}
	}
	return g
}

// Countdown in milliseconds: the family's time at level 1, more per
// level, less per tier, more with practice.
func (p *Puzzles) Countdown(family string, level, tier, practice int64) int64 {
	f := p.families[family]
	secs := f.Countdown + f.PerLevel*(level-1)
	pct := percent + p.Param("countdown-per-tier")*(tier-1)
	pct = fixed.Ratio(pct*(percent+p.Gifts(practice).Countdown), percent).Int()
	return fixed.Ratio(secs*msPerSecond*pct, percent).Int()
}

// Layout is one machine, as the client draws it. The reward roll and the
// generation key never reach it.
type Layout struct {
	Family string `json:"family"`
	Level  int64  `json:"level"`
	Tier   int64  `json:"tier"`
	Size   int64  `json:"size"`
	Decoys int64  `json:"decoys"`
	// Family data. Rewire: Target[w] is wire w's port, Glyph[p] port p's
	// glyph. Pins: Order, Target heights, False pins. Dial: Target
	// numbers, Turn directions. Maze: Walls per cell, Start, Goal. Circuit:
	// Tiles, Turn (rotation), Start (source), Goal (load), False (traps).
	// Signal: Target per knob. Fuse: Order, Clues. Override: Order.
	Target []int64 `json:"target,omitempty"`
	Glyph  []int64 `json:"glyph,omitempty"`
	Order  []int64 `json:"order,omitempty"`
	False  []int64 `json:"false,omitempty"`
	Turn   []int64 `json:"turn,omitempty"`
	Walls  []int64 `json:"walls,omitempty"`
	Tiles  []int64 `json:"tiles,omitempty"`
	Clues  []Clue  `json:"clues,omitempty"`
	Start  int64   `json:"start"`
	Goal   int64   `json:"goal"`
	Range  int64   `json:"range,omitempty"`
}

func (p *Puzzles) size(family string, level int64) (int64, int64) {
	l := p.layouts[family]
	n := min(l.Max, l.Base+l.PerLevel.MulInt(level-1).Floor())
	dec := l.DecoyBase + l.DecoyPerLevel.MulInt(level-1).Floor()
	return n, dec
}

// Generate lays out a machine. The same place, beat, family, level and
// tier always give the same machine.
func (p *Puzzles) Generate(family string, level, tier int64, w Where) Layout {
	n, dec := p.size(family, level)
	l := Layout{Family: family, Level: level, Tier: tier, Size: n, Decoys: dec, Range: p.layouts[family].Range}
	s := p.gen.Stream("puzzle.layout", append(w.parts(family), draw.Int(level), draw.Int(tier))...)
	perm := func(n int64) []int64 {
		out := make([]int64, n)
		for i, x := range s.Perm(int(n)) {
			out[i] = int64(x)
		}
		return out
	}
	switch family {
	case Rewire:
		l.Target = derange(perm(n), s)
		l.Glyph = make([]int64, n)
		for i := range l.Glyph {
			l.Glyph[i] = int64(i)
		}
		// Look-alike ports share a glyph with another port.
		for _, i := range perm(n)[:min(dec, n-1)] {
			l.Glyph[i] = (i + 1) % n
		}
	case Pins:
		l.Order = perm(n)
		l.Target = make([]int64, n)
		for i := range l.Target {
			l.Target[i] = 1 + int64(s.Below(uint64(sides)))
		}
		// False pins sit after the real ones.
		for i := range dec {
			l.False = append(l.False, n+i)
		}
	case Dial:
		l.Target = make([]int64, n)
		l.Turn = make([]int64, n)
		for i := range l.Target {
			l.Target[i] = int64(s.Below(uint64(l.Range)))
			l.Turn[i] = 1
		}
		for _, i := range perm(n)[:min(dec, n)] {
			l.Turn[i] = -1
		}
	case Maze:
		l.Walls = maze(n, dec, s)
		l.Start, l.Goal = 0, n*n-1
	case Circuit:
		l.Tiles, l.Turn, l.False = circuit(n, dec, s)
		l.Start, l.Goal = 0, n*n-1
	case Signal:
		l.Target = make([]int64, n)
		for i := range l.Target {
			l.Target[i] = int64(s.Below(uint64(l.Range)))
		}
	case Fuse:
		l.Order = perm(n)
		for i := int64(1); i < n; i++ {
			l.Clues = append(l.Clues, Clue{l.Order[i-1], l.Order[i]})
		}
		for range dec {
			a := int64(s.Below(uint64(n - 1)))
			b := a + 1 + int64(s.Below(uint64(n-a-1)))
			l.Clues = append(l.Clues, Clue{l.Order[a], l.Order[b]})
		}
		c := l.Clues
		s.Shuffle(len(c), func(i, j int) { c[i], c[j] = c[j], c[i] })
	case Override:
		l.Order = make([]int64, n)
		for i := range l.Order {
			l.Order[i] = int64(s.Below(uint64(l.Range)))
		}
	}
	return l
}

// derange makes sure no wire starts at its own port.
func derange(t []int64, s *draw.Stream) []int64 {
	n := int64(len(t))
	for i := range t {
		if t[i] == int64(i) {
			j := (int64(i) + 1 + int64(s.Below(uint64(n-1)))) % n
			t[i], t[j] = t[j], t[i]
		}
	}
	return t
}

// Move is one input, in milliseconds since the first touch armed the
// countdown. A, B and C are the family's: a wire and a port; a pin and a
// height; a dial, a number and a direction; a tilt; a tile; a knob and a
// value; a fuse; a symbol.
type Move struct {
	At int64 `json:"at"`
	A  int64 `json:"a"`
	B  int64 `json:"b,omitempty"`
	C  int64 `json:"c,omitempty"`
}

// Result is the one fact a move log becomes.
type Result struct {
	Solved  bool   `json:"solved"`
	Clean   bool   `json:"clean"`
	At      int64  `json:"at"` // ms of the solving move
	Haywire string `json:"haywire,omitempty"`
}

// Replay plays a move log against a layout and a countdown. A log that
// does not solve the machine in time, or breaks it, haywires. Walking
// away after arming is an empty or unfinished log.
func (p *Puzzles) Replay(l Layout, moves []Move, countdown int64, w Where) Result {
	limit := countdown + p.Param("network-grace")*msPerSecond
	var last int64
	solvedAt := int64(-1)
	st := newState(l)
	for _, m := range moves {
		if m.At < last || m.At > limit {
			break
		}
		last = m.At
		ok, done := st.apply(l, m)
		if !ok {
			break
		}
		if done {
			solvedAt = m.At
			break
		}
	}
	if solvedAt < 0 {
		return Result{Haywire: p.Haywire(l.Family, w)}
	}
	clean := (countdown-solvedAt)*percent >= countdown*p.Param("clean-solve-left")
	return Result{Solved: true, Clean: clean, At: solvedAt}
}

// Haywire draws one effect from the family's row.
func (p *Puzzles) Haywire(family string, w Where) string {
	hs := p.families[family].Haywires
	return hs[p.gen.Below(uint64(len(hs)), "puzzle.haywire", w.parts(family)...)]
}

// HaywireRow is what a haywire does.
func (p *Puzzles) HaywireRow(id string) *sheets.Haywire { return p.haywires[id] }

// HaulPercent is the haul a result earns, as a share of the beat's.
func (p *Puzzles) HaulPercent(r Result) int64 {
	switch {
	case r.Clean:
		return percent + p.Param("clean-solve-haul")
	case r.Solved:
		return percent
	}
	return 0
}

// SolveRate is the harness's model of a puzzle: a solve rate per family,
// practice, level and tier, with help from a party, kept inside bounds.
// Practice buys time and information in play; the model is what that is
// worth on average.
func (p *Puzzles) SolveRate(family string, practice, level, tier, party int64) fixed.F {
	f := p.families[family]
	pct := f.SoloRate.Add(fixed.FromInt(p.Param("solve-per-practice")*practice +
		p.Param("solve-per-level")*(level-1) + p.Param("solve-per-tier")*(tier-1) + p.Param("party-help")*(party-1)))
	lo, hi := fixed.FromInt(p.Param("solve-min")), fixed.FromInt(p.Param("solve-max"))
	return fixed.Max(lo, fixed.Min(hi, pct)).Div(fixed.FromInt(percent))
}

// Families lists the families that a set of tags makes the world pick,
// in id order.
func (p *Puzzles) Families(ts []tags.Tag, lockpick bool) []string {
	var out []string
	for _, id := range slices.Sorted(maps.Keys(p.families)) {
		f := p.families[id]
		if f.Lockpick != lockpick {
			continue
		}
		for _, t := range f.AppearsOn {
			if slices.Contains(ts, tags.Tag(t)) {
				out = append(out, id)
				break
			}
		}
	}
	return out
}

// Clue says one fuse is pulled before another.
type Clue struct {
	Before int64 `json:"before"`
	After  int64 `json:"after"`
}
