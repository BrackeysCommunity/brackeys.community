// Package tags is the rule engine. Everything carries tags; a rule names
// tags that must meet and the effects that follow, never a named thing.
// Apply returns the effects and the why chain behind each one: which rule,
// which tags it matched, and where each tag came from, back to a fact.
package tags

import (
	"fmt"
	"slices"

	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/sheets"
)

// Tag is an id in the tags.vocabulary sheet.
type Tag string

// Source says where a held tag came from: a fact, an earlier step of the
// same Apply, or a note naming its origin ("material:bog-iron").
type Source struct {
	Fact fact.ID `json:"fact,omitempty"`
	Step int     `json:"step"` // 1-based step index in the Why; 0 when not from a rule
	Note string  `json:"note,omitempty"`
}

// Held is a tag and where it came from.
type Held struct {
	Tag  Tag    `json:"tag"`
	From Source `json:"from"`
}

// TagSet is a set of held tags, kept sorted by tag.
type TagSet struct{ held []Held }

func NewSet(h ...Held) TagSet {
	var s TagSet
	for _, x := range h {
		s.Add(x)
	}
	return s
}

// Plain makes a set of tags with one shared source.
func Plain(from Source, ts ...Tag) TagSet {
	var s TagSet
	for _, t := range ts {
		s.Add(Held{Tag: t, From: from})
	}
	return s
}

func (s TagSet) find(t Tag) (int, bool) {
	return slices.BinarySearchFunc(s.held, t, func(h Held, t Tag) int {
		switch {
		case h.Tag < t:
			return -1
		case h.Tag > t:
			return 1
		}
		return 0
	})
}

func (s TagSet) Has(t Tag) bool { _, ok := s.find(t); return ok }

func (s TagSet) Get(t Tag) (Held, bool) {
	i, ok := s.find(t)
	if !ok {
		return Held{}, false
	}
	return s.held[i], true
}

// Add inserts h; a tag already held keeps its first source.
func (s *TagSet) Add(h Held) bool {
	i, ok := s.find(h.Tag)
	if ok {
		return false
	}
	s.held = slices.Insert(s.held, i, h)
	return true
}

func (s *TagSet) Remove(t Tag) bool {
	i, ok := s.find(t)
	if ok {
		s.held = slices.Delete(s.held, i, i+1)
	}
	return ok
}

func (s TagSet) Tags() []Tag {
	out := make([]Tag, len(s.held))
	for i, h := range s.held {
		out[i] = h.Tag
	}
	return out
}

func (s TagSet) Clone() TagSet { return TagSet{held: slices.Clone(s.held)} }

// Role is which party to a meeting a tag is looked for on.
type Role int

const (
	Subject Role = iota // the thing the rule is about
	Other               // what it is against or beside
	Place               // the tile, its weather, its region
	Yield               // what comes out of it (a node's yield); effects only
)

func (r Role) String() string {
	switch r {
	case Subject:
		return "subject"
	case Other:
		return "other"
	case Place:
		return "place"
	case Yield:
		return "yield"
	}
	return "?"
}

// Measure is a number a rule may test, with the fact behind its value.
type Measure struct {
	ID    string
	Value int64
	From  Source
}

// Context is everything Apply reads besides the subject.
type Context struct {
	Other    TagSet
	Place    TagSet
	Measures []Measure
}

func (c Context) measure(id string) (Measure, bool) {
	for _, m := range c.Measures {
		if m.ID == id {
			return m, true
		}
	}
	return Measure{}, false
}

// Pattern is what must meet for a rule to fire.
type Pattern struct {
	Subject  []Tag
	Other    []Tag
	Place    []Tag
	Anywhere []Tag
	// Lacks are tags Other must not hold.
	Lacks   []Tag
	Measure string
	AtLeast int64
}

// Rule is a compiled tags.rules row.
type Rule struct {
	ID   string
	When Pattern
	Then []Effect
}

// Effect is one consequence of a rule. Its magnitude came from a sheet cell.
//
//sumtype:decl
type Effect interface {
	effect()
	// Step is the 1-based index of the Why step that produced it.
	Step() int
}

type base struct{ step int }

func (b base) Step() int { return b.step }

type AddTag struct {
	base
	Target Role
	Tag    Tag
}

type RemoveTag struct {
	base
	Target Role
	Tag    Tag
}

// Band shifts an option's odds band by Steps (positive is better).
type Band struct {
	base
	Steps int64
}

// Scale changes a measure by a percentage.
type Scale struct {
	base
	Measure string
	Percent int64
}

// Score adds points to an option's score.
type Score struct {
	base
	Points int64
}

// Join adds creatures to an encounter at a beat.
type Join struct {
	base
	Count int64
	Beat  int64
}

// End ends an encounter at a beat.
type End struct {
	base
	Beat int64
}

func (AddTag) effect()    {}
func (RemoveTag) effect() {}
func (Band) effect()      {}
func (Scale) effect()     {}
func (Join) effect()      {}
func (Score) effect()     {}
func (End) effect()       {}

// Match is one thing a rule matched on.
type Match struct {
	Role    Role   `json:"role"`
	Tag     Tag    `json:"tag,omitempty"`
	Measure string `json:"measure,omitempty"`
	Value   int64  `json:"value,omitempty"`
	AtLeast int64  `json:"atLeast,omitempty"`
	From    Source `json:"from"`
}

// Step is one rule firing.
type Step struct {
	Rule    string  `json:"rule"`
	Matched []Match `json:"matched"`
	// Because lists the earlier steps whose effects this step matched on.
	Because []int `json:"because"`
}

// Why is the chain behind a set of effects (GDD 8.4).
type Why struct {
	Steps []Step `json:"steps"`
}

// Chain returns the steps behind step, earliest first, ending with step.
func (w Why) Chain(step int) []int {
	seen := map[int]bool{}
	var out []int
	var walk func(int)
	walk = func(s int) {
		if s < 1 || seen[s] {
			return
		}
		seen[s] = true
		for _, b := range w.Steps[s-1].Because {
			walk(b)
		}
		out = append(out, s)
	}
	walk(step)
	slices.Sort(out)
	return out
}

// Facts returns every fact the chain behind step rests on, sorted.
func (w Why) Facts(step int) []fact.ID {
	var out []fact.ID
	for _, s := range w.Chain(step) {
		for _, m := range w.Steps[s-1].Matched {
			if m.From.Fact != 0 && !slices.Contains(out, m.From.Fact) {
				out = append(out, m.From.Fact)
			}
		}
	}
	slices.Sort(out)
	return out
}

// Apply tries every rule against the subject and context, in sheet order,
// and again while a pass still fires something new, since one rule's tag
// can complete another's pattern. Each rule fires at most once. Effects
// that add or remove a tag on the subject, other or place change what
// later rules see.
func Apply(rules []Rule, subject TagSet, ctx Context) ([]Effect, Why) {
	sets := [...]TagSet{Subject: subject.Clone(), Other: ctx.Other.Clone(), Place: ctx.Place.Clone()}
	fired := make([]bool, len(rules))
	var effects []Effect
	var why Why
	for progress := true; progress; {
		progress = false
		for i, r := range rules {
			if fired[i] {
				continue
			}
			matched, ok := match(r.When, &sets, ctx)
			if !ok {
				continue
			}
			fired[i] = true
			progress = true
			step := Step{Rule: r.ID, Matched: matched, Because: []int{}}
			for _, m := range matched {
				if m.From.Step != 0 && !slices.Contains(step.Because, m.From.Step) {
					step.Because = append(step.Because, m.From.Step)
				}
			}
			slices.Sort(step.Because)
			why.Steps = append(why.Steps, step)
			n := len(why.Steps)
			for _, e := range r.Then {
				e = stamp(e, n)
				effects = append(effects, e)
				switch e := e.(type) {
				case AddTag:
					if e.Target != Yield {
						sets[e.Target].Add(Held{Tag: e.Tag, From: Source{Step: n}})
					}
				case RemoveTag:
					if e.Target != Yield {
						sets[e.Target].Remove(e.Tag)
					}
				case Band, Scale, Join, End, Score:
				}
			}
		}
	}
	return effects, why
}

func stamp(e Effect, step int) Effect {
	b := base{step: step}
	switch e := e.(type) {
	case AddTag:
		e.base = b
		return e
	case RemoveTag:
		e.base = b
		return e
	case Band:
		e.base = b
		return e
	case Scale:
		e.base = b
		return e
	case Join:
		e.base = b
		return e
	case End:
		e.base = b
		return e
	case Score:
		e.base = b
		return e
	}
	panic("tags: unknown effect")
}

func match(p Pattern, sets *[Yield]TagSet, ctx Context) ([]Match, bool) {
	var out []Match
	for _, need := range []struct {
		role Role
		tags []Tag
	}{{Subject, p.Subject}, {Other, p.Other}, {Place, p.Place}} {
		for _, t := range need.tags {
			h, ok := sets[need.role].Get(t)
			if !ok {
				return nil, false
			}
			out = append(out, Match{Role: need.role, Tag: t, From: h.From})
		}
	}
	for _, t := range p.Lacks {
		if sets[Other].Has(t) {
			return nil, false
		}
	}
	for _, t := range p.Anywhere {
		found := false
		for _, r := range []Role{Subject, Other, Place} {
			if h, ok := sets[r].Get(t); ok {
				out = append(out, Match{Role: r, Tag: t, From: h.From})
				found = true
				break
			}
		}
		if !found {
			return nil, false
		}
	}
	if p.Measure != "" {
		m, ok := ctx.measure(p.Measure)
		if !ok || m.Value < p.AtLeast {
			return nil, false
		}
		out = append(out, Match{Role: Place, Measure: m.ID, Value: m.Value, AtLeast: p.AtLeast, From: m.From})
	}
	return out, true
}

// Compile turns the tags.rules sheet into rules.
func Compile(rows []sheets.RuleRow) ([]Rule, error) {
	out := make([]Rule, 0, len(rows))
	for _, r := range rows {
		rule := Rule{ID: r.ID, When: Pattern{
			Subject:  toTags(r.Subject),
			Other:    toTags(r.Other),
			Place:    toTags(r.Place),
			Anywhere: toTags(r.Anywhere),
			Lacks:    toTags(r.Lacks),
			Measure:  r.Measure,
			AtLeast:  r.AtLeast,
		}}
		if len(rule.When.Subject) == 0 {
			return nil, fmt.Errorf("rule %s: no subject tags", r.ID)
		}
		if len(r.Then) == 0 {
			return nil, fmt.Errorf("rule %s: no effects", r.ID)
		}
		for i, e := range r.Then {
			eff, err := compileEffect(e)
			if err != nil {
				return nil, fmt.Errorf("rule %s effect %d: %w", r.ID, i, err)
			}
			rule.Then = append(rule.Then, eff)
		}
		out = append(out, rule)
	}
	return out, nil
}

func compileEffect(e sheets.EffectRow) (Effect, error) {
	target, err := roleOf(e.Target)
	switch e.Kind {
	case "add-tag", "remove-tag":
		if err != nil {
			return nil, err
		}
		if e.Tag == "" {
			return nil, fmt.Errorf("%s needs a tag", e.Kind)
		}
		if e.Kind == "add-tag" {
			return AddTag{Target: target, Tag: Tag(e.Tag)}, nil
		}
		if target == Yield {
			return nil, fmt.Errorf("remove-tag cannot target the yield")
		}
		return RemoveTag{Target: target, Tag: Tag(e.Tag)}, nil
	case "band":
		if e.Steps == 0 {
			return nil, fmt.Errorf("band needs steps")
		}
		return Band{Steps: e.Steps}, nil
	case "scale":
		if e.Measure == "" || e.Percent == 0 {
			return nil, fmt.Errorf("scale needs a measure and a percent")
		}
		return Scale{Measure: e.Measure, Percent: e.Percent}, nil
	case "join":
		if e.Count == 0 || e.Beat == 0 {
			return nil, fmt.Errorf("join needs a count and a beat")
		}
		return Join{Count: e.Count, Beat: e.Beat}, nil
	case "score":
		if e.Score == 0 {
			return nil, fmt.Errorf("score needs points")
		}
		return Score{Points: e.Score}, nil
	case "end":
		if e.Beat == 0 {
			return nil, fmt.Errorf("end needs a beat")
		}
		return End{Beat: e.Beat}, nil
	}
	return nil, fmt.Errorf("unknown effect kind %q", e.Kind)
}

func roleOf(s string) (Role, error) {
	switch s {
	case "subject":
		return Subject, nil
	case "other":
		return Other, nil
	case "place":
		return Place, nil
	case "yield":
		return Yield, nil
	}
	return 0, fmt.Errorf("unknown target %q", s)
}

func toTags(ss []string) []Tag {
	out := make([]Tag, len(ss))
	for i, s := range ss {
		out[i] = Tag(s)
	}
	return out
}
