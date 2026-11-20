package fight

import (
	"maps"
	"slices"

	"jams.team/mmo-world/sim/tags"
)

// Creature is one generated from its archetype: a body, a tier, tags and
// drops (GDD 4.15). The pack names it.
type Creature struct {
	Archetype string     `json:"archetype"`
	Tier      int64      `json:"tier"`
	Tags      []tags.Tag `json:"tags"`
	Drops     []string   `json:"drops"`
	Health    int64      `json:"health"` // a hunt's or a guardian's pool
}

// Spawn makes a creature from its archetype, with a variant's tags and
// whatever the weather over it adds, then lets the rules add what the
// place does to it (a storm charges what is born of the marsh).
func (r *Rules) Spawn(archetype string, extra []tags.Tag, place []tags.Tag, measures []tags.Measure) Creature {
	a := r.creatures[archetype]
	c := Creature{Archetype: archetype, Tier: a.Tier, Drops: slices.Clone(a.Drops)}
	ts := append(tags.Of(a.Tags), extra...)
	subject := set("archetype:"+archetype, ts)
	effects, _ := tags.Apply(r.rules, subject, tags.Context{Place: set("place", place), Measures: measures})
	for _, e := range effects {
		switch e := e.(type) {
		case tags.AddTag:
			if e.Target == tags.Subject && !slices.Contains(ts, e.Tag) {
				ts = append(ts, e.Tag)
			}
		case tags.RemoveTag:
			if e.Target == tags.Subject {
				ts = slices.DeleteFunc(ts, func(t tags.Tag) bool { return t == e.Tag })
			}
		case tags.Band, tags.Scale, tags.Add, tags.Join, tags.End, tags.Score:
		}
	}
	slices.Sort(ts)
	c.Tags = slices.Compact(ts)
	c.Health = r.tiers[c.Tier].HuntHealth
	return c
}

// Behaviour is what a creature's tags make it do in an encounter: join
// more of its kind at a beat, or end it early.
type Behaviour struct {
	Joins   int64 // creatures that join
	JoinAt  int64 // at this beat, 1-based
	EndsAt  int64 // flees at this beat, 1-based; 0 never
	Because []string
}

// Behave reads a creature's behaviour rules against the place's measures
// (threat, party size).
func (r *Rules) Behave(c Creature, place []tags.Tag, measures []tags.Measure) Behaviour {
	var b Behaviour
	effects, why := tags.Apply(r.rules, set("creature", c.Tags), tags.Context{Place: set("place", place), Measures: measures})
	for _, e := range effects {
		switch e := e.(type) {
		case tags.Join:
			b.Joins += e.Count
			b.JoinAt = e.Beat
			b.Because = append(b.Because, why.Steps[e.Step()-1].Rule)
		case tags.End:
			b.EndsAt = e.Beat
			b.Because = append(b.Because, why.Steps[e.Step()-1].Rule)
		case tags.AddTag, tags.RemoveTag, tags.Band, tags.Scale, tags.Add, tags.Score:
		}
	}
	return b
}

// Archetypes lists the archetype ids, in sheet order.
func (r *Rules) Archetypes() []string {
	return slices.Sorted(maps.Keys(r.creatures))
}
