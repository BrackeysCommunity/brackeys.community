package game

import (
	"iter"
	"slices"
	"strconv"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/puzzle"
)

// Bench is a tinker's bench as one character finds it today (GDD 7.11):
// its uses, the lessons it took and left against their caps, and the
// lessons others left here.
type Bench struct {
	Settlement      int
	Uses, UsesCap   int64
	Taken, TakenCap int64
	Given, GivenCap int64
	Lessons         int64
}

// BenchRig is one family at a bench for a character: the highest level the
// bench offers it, and the lessons waiting.
type BenchRig struct {
	Family   string
	MaxLevel int64
	Lessons  int64
	Master   bool
}

// Daily is a count kept for one world day.
type Daily struct {
	N   int64 `json:"n"`
	Day int64 `json:"day"`
}

// On is the count on a day: nothing once the day has turned.
func (d Daily) On(day int64) int64 {
	if d.Day != day {
		return 0
	}
	return d.N
}

// Add counts n more on a day.
func (d *Daily) Add(day, n int64) { *d = Daily{N: d.On(day) + n, Day: day} }

// lessonsAt are the lessons a learner may take at a settlement, oldest
// first: those others left, in one family or ("") in any.
func (g *Game) lessonsAt(settlement int, family, learner string) iter.Seq2[int, Lesson] {
	return func(yield func(int, Lesson) bool) {
		for i, l := range g.Lessons {
			if l.Settlement == settlement && (family == "" || l.Family == family) && l.Teacher != learner && !yield(i, l) {
				return
			}
		}
	}
}

// BenchAt is the bench where a character stands, if one stands open.
func (g *Game) BenchAt(c *Char) (Bench, bool) {
	n, ok := g.SettlementAt(c.C.At)
	if !ok || !g.Places[n].Open(structureTinker) {
		return Bench{}, false
	}
	p, day := g.Puzzles(), g.World.Day
	b := Bench{Settlement: n, Uses: c.Bench.On(day), UsesCap: p.Param("bench-uses-per-day"),
		Taken: c.Learned.On(day), TakenCap: p.Param("lesson-take-per-day"),
		Given: c.Taught.On(day), GivenCap: p.Param("lesson-give-per-day")}
	for range g.lessonsAt(n, "", c.C.ID) {
		b.Lessons++
	}
	return b, true
}

// BenchFor is the bench a character may use now: one stands open where it
// is, and it is free, not banned and has no machine armed.
func (g *Game) BenchFor(c *Char) (Bench, bool) {
	if idle(c) != nil {
		return Bench{}, false
	}
	return g.BenchAt(c)
}

// BenchRigs are every family a bench offers a character, in id order.
func (g *Game) BenchRigs(c *Char, b Bench) []BenchRig {
	p := g.Puzzles()
	waiting := map[string]int64{}
	for _, l := range g.lessonsAt(b.Settlement, "", c.C.ID) {
		waiting[l.Family]++
	}
	var out []BenchRig
	for _, family := range p.All() {
		if p.Known(family) {
			out = append(out, BenchRig{Family: family, MaxLevel: g.benchTop(c, family), Lessons: waiting[family], Master: g.Master(c, family)})
		}
	}
	return out
}

// benchTop is the highest level a bench offers a character in a family:
// more with practice.
func (g *Game) benchTop(c *Char, family string) int64 {
	p := g.Puzzles()
	return p.Param("bench-base-levels") + c.C.Level(family)/p.Param("bench-practice-per-level")
}

func (g *Game) benchSpec(c *Char, settlement int, family string, level int64, compact bool) puzzle.Spec {
	return puzzle.Spec{Family: family, Level: level, Tier: g.r.firstTier(), Place: "bench:" + strconv.Itoa(settlement),
		Attempt: c.BenchRuns, Compact: compact}
}

// atBench is the bench a free character stands at and the family a bench
// command names, or a refusal.
func (g *Game) atBench(c *Char, m *MachineCmd) (Bench, error) {
	if m == nil {
		return Bench{}, refuse(BadArgs, "a bench command names a family")
	}
	if err := idle(c); err != nil {
		return Bench{}, err
	}
	b, ok := g.BenchAt(c)
	if !ok {
		return Bench{}, refuse(NotHere, "no tinker's bench stands open here")
	}
	if !g.Puzzles().Known(m.Family) {
		return Bench{}, refuse(BadArgs, "the bench has no machine called %q", m.Family)
	}
	return b, nil
}

// benchSolve plays a move log against a bench machine. There is no
// countdown and no damage: a solve is practice, up to the day's cap, and
// anything else is a new machine. A master may leave the solve as a
// lesson.
func (g *Game) benchSolve(c *Char, cmd Command) (*puzzle.Result, error) {
	m := cmd.Machine
	b, err := g.atBench(c, m)
	if err != nil {
		return nil, err
	}
	if top := g.benchTop(c, m.Family); m.Level < 1 || m.Level > top {
		return nil, refuse(BadArgs, "the bench offers %s at levels 1 to %d", m.Family, top)
	}
	p := g.Puzzles()
	res := p.Play(g.benchSpec(c, b.Settlement, m.Family, m.Level, m.Compact), m.log(), puzzle.Limits{Elapsed: -1, Bench: true})
	c.BenchRuns++
	if !res.Solved {
		return &res, nil
	}
	tick := g.Tick()
	uses := min(p.Param("bench-solve-uses"), max(0, b.UsesCap-b.Uses))
	taught := m.Teach && g.Master(c, m.Family) && b.Given < b.GivenCap
	if _, err := g.fact(c, "bench.solved", tick, fact.S("family", m.Family), fact.N("level", m.Level), fact.N("uses", uses),
		fact.N("settlement", int64(b.Settlement)), fact.B("taught", taught)); err != nil {
		return nil, err
	}
	if uses > 0 {
		c.Bench.Add(g.World.Day, uses)
		if err := g.practise(c, m.Family, uses, tick); err != nil {
			return nil, err
		}
	}
	if taught {
		c.Taught.Add(g.World.Day, 1)
		g.leaveLesson(Lesson{Settlement: b.Settlement, Family: m.Family, Teacher: c.C.ID, Tick: tick})
	}
	return &res, nil
}

// leaveLesson keeps a lesson at its bench; a bench keeps so many a
// family, and the oldest goes first.
func (g *Game) leaveLesson(l Lesson) {
	g.Lessons = append(g.Lessons, l)
	var kept []int
	for i := range g.lessonsAt(l.Settlement, l.Family, "") {
		kept = append(kept, i)
	}
	// The oldest go, last first so the indexes before them stand.
	for over := len(kept) - int(g.Puzzles().Param("lessons-kept")); over > 0; over-- {
		g.Lessons = slices.Delete(g.Lessons, kept[over-1], kept[over-1]+1)
	}
}

// benchLesson takes the oldest lesson another left here for a family: the
// learner practises, and the teacher gains standing with the guild that
// runs the settlement.
func (g *Game) benchLesson(c *Char, cmd Command) error {
	m := cmd.Machine
	b, err := g.atBench(c, m)
	if err != nil {
		return err
	}
	if b.Taken >= b.TakenCap {
		return refuse(NoLesson, "%s has taken %d lessons today, the most a day gives", c.C.ID, b.Taken)
	}
	i := -1
	for at := range g.lessonsAt(b.Settlement, m.Family, c.C.ID) {
		i = at
		break
	}
	if i < 0 {
		return refuse(NoLesson, "nobody has left a lesson in %s here", m.Family)
	}
	l := g.Lessons[i]
	g.Lessons = slices.Delete(g.Lessons, i, i+1)
	p := g.Puzzles()
	tick := g.Tick()
	uses := p.Param("lesson-uses")
	c.Learned.Add(g.World.Day, 1)
	data := []fact.Datum{fact.S("family", m.Family), fact.N("uses", uses), fact.N("settlement", int64(b.Settlement))}
	if gd, teacher := g.GuildOf(g.Places[b.Settlement].Guild), g.Char(l.Teacher); gd != nil && teacher != nil {
		standing := p.Param("lesson-standing")
		teacher.C.GuildStanding.Bump(gd.G.ID, standing)
		g.touch(teacher)
		data = append(data, fact.N("standing", standing), fact.S("guild", gd.G.ID))
	}
	if _, err := g.factWith(c, []fact.Ref{char.Ref(l.Teacher)}, "lesson.taken", tick, data...); err != nil {
		return err
	}
	return g.practise(c, m.Family, uses, tick)
}
