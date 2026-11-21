// Package puzzle is the machine puzzle, headless: a layout generated from
// a keyed draw over where the machine is, the beat and the family; the
// countdown; and a move log replayed against both into one result
// (GDD 7.11). The client plays the puzzle for smoothness; the server's
// replay is what counts.
//
// A family is one file: a layout generator and a replay rule that
// registers itself with the kit (kit.go).
package puzzle

import (
	"maps"
	"math"
	"slices"

	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tags"
)

// structural: milliseconds in a second; a square grid has four sides,
// and a half turn is two of them.
const (
	msPerSecond = 1000
	sides       = 4
	halfTurn    = 2
)

// Puzzles holds the Puzzles sheets and the generation key.
type Puzzles struct {
	families map[string]*sheets.PuzzleFamily
	layouts  map[string]*sheets.PuzzleLayout
	haywires map[string]*sheets.Haywire
	tuning   map[tuneKey]*sheets.PuzzleTuning
	gifts    []sheets.PracticeGift
	params   []sheets.Param
	intro    string
	lockdown int64
	gen      *draw.Drawer
}

type tuneKey struct{ family, key string }

func New(b *sheets.Book, genKey draw.Key) *Puzzles {
	p := &Puzzles{families: sheets.Lookup(b.PuzzleFamilies), haywires: sheets.Lookup(b.Haywires),
		gifts: b.PuzzlePractice, params: b.PuzzleParams, layouts: map[string]*sheets.PuzzleLayout{},
		tuning: map[tuneKey]*sheets.PuzzleTuning{}, gen: draw.NewDrawer(genKey)}
	for i := range b.PuzzleLayouts {
		p.layouts[b.PuzzleLayouts[i].Family] = &b.PuzzleLayouts[i]
	}
	for i := range b.PuzzleTuning {
		t := &b.PuzzleTuning[i]
		p.tuning[tuneKey{t.Family, t.Key}] = t
	}
	for _, h := range b.Haywires {
		if h.Intro {
			p.intro = h.ID
		}
		if h.Effect == EffectLockdown && p.lockdown == 0 {
			p.lockdown = h.Magnitude
		}
	}
	return p
}

func (p *Puzzles) Param(id string) int64 { return sheets.IntParam(p.params, id) }

func (p *Puzzles) Family(id string) *sheets.PuzzleFamily { return p.families[id] }

// All lists every family the sheets hold, in id order.
func (p *Puzzles) All() []string { return slices.Sorted(maps.Keys(p.families)) }

// Known reports whether a family can be laid out and played.
func (p *Puzzles) Known(family string) bool {
	return p.families[family] != nil && p.layouts[family] != nil && registry[family] != nil
}

// Where identifies a machine: the tile or dungeon floor, and the beat.
type Where struct {
	Place string // "tile:q,r" or "floor:<dungeon>/<n>"
	Beat  int64
}

func (w Where) parts(family string) []draw.Part {
	return []draw.Part{draw.Str(w.Place), draw.Int(w.Beat), draw.Str(family)}
}

// Spec names one machine. Attempt and Compact are zero for a machine met
// for the first time on a full screen.
type Spec struct {
	Family  string `json:"family"`
	Level   int64  `json:"level"`
	Tier    int64  `json:"tier"`
	Place   string `json:"place"`
	Beat    int64  `json:"beat"`
	Attempt int64  `json:"attempt,omitempty"`
	Compact bool   `json:"compact,omitempty"`
}

func (s Spec) Where() Where { return Where{Place: s.Place, Beat: s.Beat} }

// band is a tier's levels: the lowest, and how many more it spans.
func (p *Puzzles) band(tier int64) (lo, span int64) {
	return p.Param("level-per-tier")*tier - 1, p.Param("level-span")
}

// Level is a machine's family level: within its tier's band, keyed, and
// one more per so many dungeon floors.
func (p *Puzzles) Level(family string, tier, floor int64, w Where) int64 {
	lo, span := p.band(tier)
	lvl := lo + int64(p.gen.Below(uint64(span+1), "puzzle.level", w.parts(family)...))
	return lvl + floor/p.Param("floors-per-level")
}

// TopLevel is the highest level Level gives at a tier: the top of its
// band, on the deepest floor.
func (p *Puzzles) TopLevel(tier int64) int64 {
	lo, span := p.band(tier)
	return lo + span + p.Param("floors")/p.Param("floors-per-level")
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

// structural: the units a countdown's parts are stated in.
const (
	UnitSeconds = "s"
	UnitPercent = "percent"
)

// Part is one thing a countdown is made of.
type Part struct {
	Label string
	Value int64
	Unit  string
}

// timing is a countdown's parts: the family's seconds, the level's, the
// tier's percent and practice's.
type timing struct{ family, level, tier, practice int64 }

func (p *Puzzles) timing(family string, level, tier, practice int64) timing {
	f := p.families[family]
	return timing{family: f.Countdown, level: f.PerLevel * (level - 1), tier: p.Param("countdown-per-tier") * (tier - 1),
		practice: p.Gifts(practice).Countdown}
}

// Countdown in milliseconds: the family's time at level 1, more per
// level, less per tier, more with practice.
func (p *Puzzles) Countdown(family string, level, tier, practice int64) int64 {
	t := p.timing(family, level, tier, practice)
	pct := fixed.PercentPlus(fixed.Hundredths+t.tier, t.practice)
	return fixed.PercentOf((t.family+t.level)*msPerSecond, pct)
}

// CountdownParts is what Countdown is made of, the parts that are nothing
// left out.
func (p *Puzzles) CountdownParts(family string, level, tier, practice int64) []Part {
	t := p.timing(family, level, tier, practice)
	out := []Part{{"family", t.family, UnitSeconds}}
	for _, x := range []Part{{"level", t.level, UnitSeconds}, {"tier", t.tier, UnitPercent}, {"practice", t.practice, UnitPercent}} {
		if x.Value != 0 {
			out = append(out, x)
		}
	}
	return out
}

// Layout is one machine, as the client draws it. The reward roll and the
// generation key never reach it.
type Layout struct {
	Family string `json:"family"`
	Level  int64  `json:"level"`
	Tier   int64  `json:"tier"`
	Size   int64  `json:"size"`
	Decoys int64  `json:"decoys"`
	// Family data; each family's file says what it keeps where.
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
	// Step is the model's step in milliseconds for a family that runs on
	// the clock; Par its fixed numbers, Init its state at rest and Track
	// the schedule drawn for it.
	Step  int64   `json:"step,omitempty"`
	Par   []int64 `json:"par,omitempty"`
	Init  []int64 `json:"init,omitempty"`
	Track []int64 `json:"track,omitempty"`
}

// Clue says one fuse is pulled before another.
type Clue struct {
	Before int64 `json:"before"`
	After  int64 `json:"after"`
}

// size is a family's size and decoys at a level; a phone's cap holds the
// size where the family has one.
func (p *Puzzles) size(family string, level int64, compact bool) (int64, int64) {
	l := p.layouts[family]
	n := min(l.Max, l.Base+l.PerLevel.MulInt(level-1).Floor())
	if compact && l.PhoneMax > 0 {
		n = min(l.PhoneMax, n)
	}
	dec := l.DecoyBase + l.DecoyPerLevel.MulInt(level-1).Floor()
	return n, dec
}

// tune reads a family's tuning cell at a level. A missing cell is a sheet
// error the Check run reports; inside the sim it panics.
func (p *Puzzles) tune(family, key string, level int64) int64 {
	t := p.tuning[tuneKey{family, key}]
	if t == nil {
		panic("puzzle: no tuning cell " + family + "-" + key)
	}
	v := max(t.Min, 0, t.Base+t.PerLevel.MulInt(level-1).Floor())
	if t.Max > 0 {
		v = min(t.Max, v)
	}
	return v
}

// Generate lays out a machine. The same place, beat, family, level and
// tier always give the same machine.
func (p *Puzzles) Generate(family string, level, tier int64, w Where) Layout {
	return p.Make(Spec{Family: family, Level: level, Tier: tier, Place: w.Place, Beat: w.Beat})
}

// Make lays out the machine a spec names. A second try at the same
// machine is drawn afresh, so it is not the first one over again.
func (p *Puzzles) Make(s Spec) Layout {
	if s.Attempt > 0 {
		return p.lay(s, "puzzle.again", draw.Int(s.Attempt))
	}
	return p.lay(s, "puzzle.layout")
}

// Inner is the panel a master finds behind a solved machine: the same
// family, one level up.
func (p *Puzzles) Inner(s Spec) Layout {
	s.Level++
	return p.lay(s, "puzzle.inner", draw.Int(s.Attempt))
}

func (p *Puzzles) lay(s Spec, label draw.Purpose, more ...draw.Part) Layout {
	n, dec := p.size(s.Family, s.Level, s.Compact)
	l := Layout{Family: s.Family, Level: s.Level, Tier: s.Tier, Size: n, Decoys: dec, Range: p.layouts[s.Family].Range}
	f := registry[s.Family]
	if _, ok := f.(Timed); ok {
		l.Step = stepMs
	}
	parts := append(s.Where().parts(s.Family), draw.Int(s.Level), draw.Int(s.Tier))
	f.Lay(&l, Kit{
		S:     p.gen.Stream(label, append(parts, more...)...),
		Tune:  func(key string) int64 { return p.tune(s.Family, key, s.Level) },
		Steps: p.Countdown(s.Family, s.Level, s.Tier, 0) / stepMs,
	})
	return l
}

// Move is one input, in milliseconds since the first touch armed the
// countdown. A, B and C are the family's own.
type Move struct {
	At int64 `json:"at"`
	A  int64 `json:"a"`
	B  int64 `json:"b,omitempty"`
	C  int64 `json:"c,omitempty"`
}

// Log is a move log: inputs in order, and the millisecond the player
// stopped at (0: the last move's).
type Log struct {
	Moves []Move `json:"moves"`
	End   int64  `json:"end,omitempty"`
}

// Limits are what a replay is held to. Elapsed is the server's
// milliseconds since arming, or -1 where no clock is kept. A bench machine
// has no countdown and no haywire: only the longest play ends it.
type Limits struct {
	Countdown int64
	Elapsed   int64
	Master    bool
	Bench     bool
}

// Stop is the millisecond a log's player stopped at.
func (l Log) Stop() int64 {
	at := l.End
	if n := len(l.Moves); n > 0 {
		at = max(at, l.Moves[n-1].At)
	}
	return at
}

// Result is the one fact a move log becomes.
type Result struct {
	Solved  bool   `json:"solved"`
	Clean   bool   `json:"clean"`
	Master  bool   `json:"master,omitempty"` // the inner panel too
	Late    bool   `json:"late,omitempty"`   // sent after the countdown had run out
	At      int64  `json:"at"`               // ms of the solve
	Haywire string `json:"haywire,omitempty"`
}

func (p *Puzzles) grace() int64 { return p.Param("network-grace") * msPerSecond }

// MaxPlay is the longest a play may run, in milliseconds: all that ends a
// bench machine.
func (p *Puzzles) MaxPlay() int64 { return p.Param("max-play-seconds") * msPerSecond }

// Play replays a move log against the machine a spec names. A log that
// does not solve the machine in time, or breaks it, haywires. Walking
// away after arming is an empty or unfinished log.
func (p *Puzzles) Play(s Spec, log Log, lim Limits) Result {
	var fail Result
	limit := p.MaxPlay()
	if !lim.Bench {
		fail.Haywire = p.Haywire(s.Family, s.Where())
		limit = lim.Countdown + p.grace()
	}
	if lim.Elapsed >= 0 && lim.Elapsed > limit {
		fail.Late = true
		return fail
	}
	if int64(len(log.Moves)) > p.Param("max-moves") {
		return fail
	}
	horizon := limit
	if lim.Elapsed >= 0 {
		horizon = min(limit, lim.Elapsed+p.grace())
	}
	l := p.Make(s)
	var inner *Layout
	if lim.Master {
		in := p.Inner(s)
		inner = &in
	}
	return p.judge(RunLog(l, inner, log, horizon, nil), fail, lim.Countdown, lim.Elapsed)
}

// judge reads a replay's outcome against a countdown: fail unless the
// machine was solved, and clean when enough of the countdown was left. A
// client's stamps are only trusted to be late, so with a server clock the
// solve counts from no earlier than the grace before the log arrived.
func (p *Puzzles) judge(out Outcome, fail Result, countdown, elapsed int64) Result {
	if out.Status != Done {
		return fail
	}
	seen := out.At
	if elapsed >= 0 {
		seen = max(seen, elapsed-p.grace())
	}
	clean := countdown > 0 && fixed.AtPercent(countdown-seen, countdown, p.Param("clean-solve-left"))
	return Result{Solved: true, Clean: clean, Master: out.Master, At: out.At}
}

// Replay plays a move log against a layout and a countdown, with no
// server clock and no inner panel.
func (p *Puzzles) Replay(l Layout, moves []Move, countdown int64, w Where) Result {
	out := RunLog(l, nil, Log{Moves: moves}, countdown+p.grace(), nil)
	return p.judge(out, Result{Haywire: p.Haywire(l.Family, w)}, countdown, -1)
}

// Solve is a log that solves a layout and stops at the solve: what the
// bench player presses and what a guide line is drawn from.
func (p *Puzzles) Solve(l Layout) Log {
	f := registry[l.Family]
	log := f.Solve(&l)
	_, at, used := feed(f.Start(&l), log.Moves, log.End, math.MaxInt64, 0, nil)
	out := Log{Moves: log.Moves[:used]}
	if at > out.Stop() {
		out.End = at
	}
	return out
}

// Hints are the moves a hint may show for a layout, most telling first.
func (p *Puzzles) Hints(l Layout) []Move { return registry[l.Family].Hints(&l) }

// Haywire draws one effect from the family's row.
func (p *Puzzles) Haywire(family string, w Where) string {
	hs := p.families[family].Haywires
	return hs[p.gen.Below(uint64(len(hs)), "puzzle.haywire", w.parts(family)...)]
}

// structural: what a haywire row does.
const (
	EffectShock    = "shock"
	EffectAlarm    = "alarm"
	EffectShort    = "short"
	EffectLockdown = "lockdown"
)

// HaywireRow is what a haywire does.
func (p *Puzzles) HaywireRow(id string) *sheets.Haywire { return p.haywires[id] }

// Intro is the haywire of a character's first machine.
func (p *Puzzles) Intro() string { return p.intro }

// LockdownDays is how many world days the sheet's lockdown lasts.
func (p *Puzzles) LockdownDays() int64 { return p.lockdown }

// structural: the machine a character meets first, and the families that
// lock a pouch.
const introLevel = 1

var pouchLocks = []string{Pins, Maze}

// IntroMachine is the family and level of a character's first machine.
func (p *Puzzles) IntroMachine() (family string, level int64) { return Rewire, introLevel }

// PouchLocks are the families a pouch may be locked with.
func (p *Puzzles) PouchLocks() []string { return pouchLocks }

// HaulPercent is the haul a result earns, as a share of the beat's.
func (p *Puzzles) HaulPercent(r Result) int64 {
	switch {
	case r.Clean, r.Master:
		return fixed.Hundredths + p.Param("clean-solve-haul")
	case r.Solved:
		return fixed.Hundredths
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
	return fixed.Max(lo, fixed.Min(hi, pct)).AsFraction()
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
