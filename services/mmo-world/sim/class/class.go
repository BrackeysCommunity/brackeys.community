// Package class is classes that emerge (GDD 5.8, 5.9): a class unlocks
// when what a character has practised crosses its thresholds, its level
// follows that practice and opens the tiers of its tree, and each ability
// is a tag the tags rules read. Abilities taken are kept when a class
// goes inactive.
package class

import (
	"fmt"
	"slices"

	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tags"
)

// Reader is what a class's thresholds read from a character.
type Reader interface {
	Level(skill string) int64
	Deed(id string) int64
	Crafts(process string) int64
}

// Earned is a class a character has unlocked.
type Earned struct {
	ID   string `json:"id"`
	Tick int64  `json:"tick"`
	// First is set on the first character in the world to earn it.
	First bool `json:"first,omitempty"`
}

// State is a character's classes: earned, active and the abilities taken.
type State struct {
	Earned    []Earned `json:"earned,omitempty"`
	Active    []string `json:"active,omitempty"`
	Abilities []string `json:"abilities,omitempty"`
}

// Has reports whether a class is earned.
func (s *State) Has(id string) bool {
	return slices.ContainsFunc(s.Earned, func(e Earned) bool { return e.ID == id })
}

// structural: a tree has four tiers, so three practice levels past the
// unlock raise the class level.
const levelSteps = 3

// Params are the classes sheet's cells.
type Params struct {
	Active, TierLevels int64
	Practice           [levelSteps]int64 // the skill levels that bring class levels 5, 10, 15
}

// ParamsOf reads them.
func ParamsOf(p []sheets.Param) Params {
	i := func(id string) int64 { return sheets.IntParam(p, id) }
	return Params{Active: i("active-classes"), TierLevels: i("tier-levels"),
		Practice: [levelSteps]int64{i("level-5-practice"), i("level-10-practice"), i("level-15-practice")}}
}

// Unlocked reports whether a character meets every threshold of a class.
func Unlocked(c *sheets.Class, r Reader) bool {
	for _, q := range c.Unlock {
		if Progress(q, r) < q.At {
			return false
		}
	}
	return true
}

// Progress is how far a character is along one threshold.
func Progress(q sheets.Requirement, r Reader) int64 {
	switch q.Kind {
	case "practice":
		return r.Level(q.ID)
	case "deed":
		return r.Deed(q.ID)
	case "crafts":
		return r.Crafts(q.ID)
	}
	return 0
}

// Level is an earned class's level: 1 at the unlock, then rising with the
// class's skill evenly between the practice levels that bring 5, 10 and
// 15.
func Level(c *sheets.Class, r Reader, p Params) int64 {
	at := r.Level(c.Skill)
	from, lv := unlockPractice(c), int64(1)
	for i, to := range p.Practice {
		next := p.TierLevels * int64(i+1)
		if at >= to {
			from, lv = to, next
			continue
		}
		if to > from {
			lv += (next - lv) * max(0, at-from) / (to - from)
		}
		return lv
	}
	return lv
}

// unlockPractice is the class skill's level its unlock asks for, if any.
func unlockPractice(c *sheets.Class) int64 {
	for _, q := range c.Unlock {
		if q.Kind == "practice" && q.ID == c.Skill {
			return q.At
		}
	}
	return 0
}

// Tiers are the tree tiers open at a class level: 1, then every
// TierLevels.
func Tiers(level int64, p Params) []int64 {
	out := []int64{}
	if level >= 1 {
		out = append(out, 1)
	}
	for t := p.TierLevels; t <= level; t += p.TierLevels {
		out = append(out, t)
	}
	return out
}

// Choose makes a class active, keeping at most Active; the oldest active
// gives way.
func (s *State) Choose(id string, p Params) error {
	if !s.Has(id) {
		return fmt.Errorf("class %s is not earned", id)
	}
	if slices.Contains(s.Active, id) {
		return nil
	}
	s.Active = append(s.Active, id)
	if over := int64(len(s.Active)) - p.Active; over > 0 {
		s.Active = s.Active[over:]
	}
	return nil
}

// Take takes an ability from an active class's open tier, one per tier.
func (s *State) Take(a *sheets.Ability, level int64, all []sheets.Ability, p Params) error {
	switch {
	case !slices.Contains(s.Active, a.Class):
		return fmt.Errorf("class %s is not active", a.Class)
	case !slices.Contains(Tiers(level, p), a.Tier):
		return fmt.Errorf("tier %d of %s is not open at class level %d", a.Tier, a.Class, level)
	case slices.Contains(s.Abilities, a.ID):
		return fmt.Errorf("%s is already taken", a.ID)
	}
	for _, id := range s.Abilities {
		if o := find(all, id); o != nil && o.Class == a.Class && o.Tier == a.Tier {
			return fmt.Errorf("tier %d of %s is already taken: %s", a.Tier, a.Class, o.ID)
		}
	}
	s.Abilities = append(s.Abilities, a.ID)
	return nil
}

func find(all []sheets.Ability, id string) *sheets.Ability {
	for i := range all {
		if all[i].ID == id {
			return &all[i]
		}
	}
	return nil
}

// Tags are what the rules see of a character's classes: each active
// class's tag and the abilities taken from it.
// Situation is what a fight's circumstances add to what the abilities'
// rules read of a character: the opening beat, an ambush, marked prey
// and a wall to stand on.
type Situation struct{ Opening, Ambushed, Preyed, Walled bool }

// structural: the situation's tags, as tags.rules names them.
const (
	TagOpening  tags.Tag = "opening"
	TagAmbushed tags.Tag = "ambushed"
	TagPreyed   tags.Tag = "preyed"
	TagWalled   tags.Tag = "walled"
)

// FightTags are what a character's kit carries into a beat besides its
// gear: its classes and abilities, and the situation.
func (s *State) FightTags(classes []sheets.Class, all []sheets.Ability, sit Situation) []tags.Tag {
	out := s.Tags(classes, all)
	for _, t := range []struct {
		on  bool
		tag tags.Tag
	}{{sit.Opening, TagOpening}, {sit.Ambushed, TagAmbushed}, {sit.Preyed, TagPreyed}, {sit.Walled, TagWalled}} {
		if t.on {
			out = append(out, t.tag)
		}
	}
	return out
}

func (s *State) Tags(classes []sheets.Class, all []sheets.Ability) []tags.Tag {
	var out []tags.Tag
	for _, c := range classes {
		if slices.Contains(s.Active, c.ID) {
			out = append(out, tags.Tag(c.Tag))
		}
	}
	for _, id := range s.Abilities {
		if a := find(all, id); a != nil && slices.Contains(s.Active, a.Class) {
			out = append(out, tags.Tag(a.ID))
		}
	}
	return out
}
